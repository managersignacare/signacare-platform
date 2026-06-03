#!/usr/bin/env bash
# Phase 0b posture probes runner (v4 execution discipline)
#
# Runs 0b.1-0b.9 against a target database and repo snapshot, emitting
# reproducible evidence files plus a status summary.
#
# Usage examples:
#   npm run probe:phase-0b
#   PHASE0B_DSN="postgresql://user:pw@host:5432/signacaredb" npm run probe:phase-0b
#   PHASE0B_TARGET_LABEL="prod-clone" PHASE0B_RUN_K6=1 PHASE0B_K6_BASE_URL="http://localhost:4000" npm run probe:phase-0b

set -u -o pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Phase 0b probe runner

Environment variables:
  PHASE0B_DSN           Postgres DSN for probe target.
                        Default: postgresql://signacare_owner@localhost:5433/signacaredb
  PHASE0B_TARGET_LABEL  Human label for artifacts (default: local-dev)
  PHASE0B_OUT_DIR       Output directory (default: /tmp/phase-0b-probes-<timestamp>)
  PHASE0B_RUN_K6        1 to execute 0b.7 k6 baseline; otherwise skipped (default: 0)
  PHASE0B_K6_BASE_URL   Base URL for k6 (exported as STAGING_URL when PHASE0B_RUN_K6=1)
  PHASE0B_K6_DURATION   k6 duration override (default: 60s)

Outputs:
  <out-dir>/results.tsv               machine-readable probe statuses
  <out-dir>/phase-0b-summary.md       copy/paste summary for ledger updates
  <out-dir>/0b.*.txt / *.sha256       raw evidence files per probe
USAGE
  exit 0
fi

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_command psql
require_command pg_dump
require_command rg
require_command awk
require_command sed

HASH_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD="shasum -a 256"
else
  echo "Missing required hash command: sha256sum or shasum" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMESTAMP_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TIMESTAMP_ID="$(date -u +%Y%m%d-%H%M%S)"
TARGET_DSN="${PHASE0B_DSN:-postgresql://signacare_owner@localhost:5433/signacaredb}"
TARGET_LABEL="${PHASE0B_TARGET_LABEL:-local-dev}"
RUN_K6="${PHASE0B_RUN_K6:-0}"
K6_BASE_URL="${PHASE0B_K6_BASE_URL:-}"
K6_DURATION="${PHASE0B_K6_DURATION:-60s}"
OUT_DIR="${PHASE0B_OUT_DIR:-/tmp/phase-0b-probes-${TIMESTAMP_ID}}"

mkdir -p "$OUT_DIR"

RESULTS_TSV="$OUT_DIR/results.tsv"
SUMMARY_MD="$OUT_DIR/phase-0b-summary.md"
echo "probe_id|status|evidence_file|note" > "$RESULTS_TSV"

SCRIPT_ERRORS=0

record_result() {
  local probe_id="$1"
  local status="$2"
  local evidence_file="$3"
  local note="$4"
  printf '%s|%s|%s|%s\n' "$probe_id" "$status" "$evidence_file" "$note" >> "$RESULTS_TSV"
}

run_psql() {
  local out_file="$1"
  local sql="$2"
  if psql "$TARGET_DSN" -X -v ON_ERROR_STOP=1 -P pager=off -At -F '|' -c "$sql" >"$out_file" 2>&1; then
    return 0
  fi
  return 1
}

run_psql_meta() {
  local out_file="$1"
  local meta_cmd="$2"
  if psql "$TARGET_DSN" -X -v ON_ERROR_STOP=1 -P pager=off -c "$meta_cmd" >"$out_file" 2>&1; then
    return 0
  fi
  return 1
}

echo "Phase 0b probe run started: $TIMESTAMP_UTC"
echo "Target label: $TARGET_LABEL"
echo "Evidence directory: $OUT_DIR"

# 0b.1 role bypass posture
OUT_0B1="$OUT_DIR/0b.1-role-bypass.txt"
if run_psql "$OUT_0B1" "SELECT rolname, rolbypassrls, rolsuper, rolcreaterole FROM pg_roles ORDER BY rolname;"; then
  if awk -F'|' '$1=="signacare_owner" && ($2=="t" || $3=="t") { bad=1 } $1=="app_user" && ($2=="t" || $3=="t") { bad=1 } END { exit bad ? 0 : 1 }' "$OUT_0B1"; then
    record_result "0b.1" "RISK" "$(basename "$OUT_0B1")" "bypass/super posture detected for signacare_owner or app_user"
  else
    record_result "0b.1" "PASS" "$(basename "$OUT_0B1")" "owner/app role bypass posture clean"
  fi
else
  record_result "0b.1" "ERROR" "$(basename "$OUT_0B1")" "query failed"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi

# 0b.2 audit_log RLS posture
OUT_0B2="$OUT_DIR/0b.2-audit-log-rls.txt"
if run_psql "$OUT_0B2" "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='audit_log';"; then
  if awk -F'|' '$1=="audit_log" && $3!="t" { bad=1 } END { exit bad ? 0 : 1 }' "$OUT_0B2"; then
    record_result "0b.2" "RISK" "$(basename "$OUT_0B2")" "audit_log FORCE RLS is not enabled"
  else
    record_result "0b.2" "PASS" "$(basename "$OUT_0B2")" "audit_log FORCE RLS enabled"
  fi
else
  record_result "0b.2" "ERROR" "$(basename "$OUT_0B2")" "query failed"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi

# 0b.3 audit_log trigger + mutability surface
OUT_0B3="$OUT_DIR/0b.3-audit-log-ddl.txt"
if run_psql_meta "$OUT_0B3" "\\d+ audit_log"; then
  if grep -q "audit_log_no_update" "$OUT_0B3" && grep -q "audit_log_no_delete" "$OUT_0B3"; then
    record_result "0b.3" "PASS" "$(basename "$OUT_0B3")" "no-update and no-delete triggers present"
  else
    record_result "0b.3" "RISK" "$(basename "$OUT_0B3")" "one or more immutability triggers missing"
  fi
else
  record_result "0b.3" "ERROR" "$(basename "$OUT_0B3")" "meta command failed"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi

# 0b.4 schema fingerprint parity baseline
OUT_0B4_SCHEMA="$OUT_DIR/0b.4-schema.sql"
OUT_0B4_HASH="$OUT_DIR/0b.4-schema.sha256"
if pg_dump "$TARGET_DSN" --schema-only --no-owner --no-acl >"$OUT_0B4_SCHEMA" 2>"$OUT_DIR/0b.4-schema.stderr.txt"; then
  LC_ALL=C sort "$OUT_0B4_SCHEMA" | eval "$HASH_CMD" | awk '{print $1}' >"$OUT_0B4_HASH"
  record_result "0b.4" "PASS" "$(basename "$OUT_0B4_HASH")" "schema fingerprint captured"
else
  record_result "0b.4" "ERROR" "$(basename "$OUT_0B4_SCHEMA")" "pg_dump schema capture failed"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi

# 0b.5 scheduler inventory
OUT_0B5_DB="$OUT_DIR/0b.5-scheduler-db-inventory.txt"
OUT_0B5_CODE="$OUT_DIR/0b.5-scheduler-code-inventory.txt"
if run_psql "$OUT_0B5_DB" "SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public' AND (tablename ILIKE '%queue%' OR tablename ILIKE '%outbox%' OR tablename ILIKE '%scheduler%' OR tablename ILIKE '%job%' OR tablename ILIKE '%dead_letter%' OR tablename ILIKE '%pending%') ORDER BY tablename;"; then
  :
else
  echo "DB inventory query failed" >"$OUT_0B5_DB"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi
if rg -n "BullMQ|node-cron|cron.schedule|setInterval|setTimeout|dead-letter|dead_letter|outbox" "$ROOT_DIR/apps/api/src/jobs" -S >"$OUT_0B5_CODE" 2>&1; then
  :
else
  echo "Code inventory grep failed" >"$OUT_0B5_CODE"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi
if [[ $SCRIPT_ERRORS -gt 0 && (! -s "$OUT_0B5_DB" || ! -s "$OUT_0B5_CODE") ]]; then
  record_result "0b.5" "ERROR" "$(basename "$OUT_0B5_DB"),$(basename "$OUT_0B5_CODE")" "scheduler inventory incomplete"
else
  record_result "0b.5" "PASS" "$(basename "$OUT_0B5_DB"),$(basename "$OUT_0B5_CODE")" "scheduler inventory captured"
fi

# 0b.6 outbox/inflight audit surface
OUT_0B6_DB="$OUT_DIR/0b.6-audit-table-inventory.txt"
OUT_0B6_CODE="$OUT_DIR/0b.6-audit-code-inventory.txt"
if run_psql_meta "$OUT_0B6_DB" "\\dt audit*"; then
  :
else
  echo "Audit table inventory failed" >"$OUT_0B6_DB"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi
if rg -n "auditOutbox|audit_outbox|pending_audit|auditOutboxDrainer|writeAuditLog" "$ROOT_DIR/apps/api/src" -S >"$OUT_0B6_CODE" 2>&1; then
  :
else
  echo "Audit code inventory grep failed" >"$OUT_0B6_CODE"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi
if [[ $SCRIPT_ERRORS -gt 0 && (! -s "$OUT_0B6_DB" || ! -s "$OUT_0B6_CODE") ]]; then
  record_result "0b.6" "ERROR" "$(basename "$OUT_0B6_DB"),$(basename "$OUT_0B6_CODE")" "outbox inventory incomplete"
else
  record_result "0b.6" "PASS" "$(basename "$OUT_0B6_DB"),$(basename "$OUT_0B6_CODE")" "outbox inventory captured"
fi

# 0b.7 login path timing baseline
OUT_0B7="$OUT_DIR/0b.7-k6-baseline.txt"
OUT_0B7_SUMMARY="$OUT_DIR/0b.7-k6-summary.json"
if [[ "$RUN_K6" == "1" ]]; then
  if command -v k6 >/dev/null 2>&1; then
    pushd "$ROOT_DIR" >/dev/null
    K6_ENV=()
    if [[ -n "$K6_BASE_URL" ]]; then
      K6_ENV+=("STAGING_URL=$K6_BASE_URL")
    fi
    if env "${K6_ENV[@]}" k6 run --vus 1 --duration "$K6_DURATION" --summary-export "$OUT_0B7_SUMMARY" scripts/k6/baseline.js >"$OUT_0B7" 2>&1; then
      record_result "0b.7" "PASS" "$(basename "$OUT_0B7"),$(basename "$OUT_0B7_SUMMARY")" "k6 baseline completed"
    else
      record_result "0b.7" "ERROR" "$(basename "$OUT_0B7")" "k6 baseline failed"
      SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
    fi
    popd >/dev/null
  else
    record_result "0b.7" "SKIPPED" "-" "k6 command not installed"
  fi
else
  record_result "0b.7" "SKIPPED" "-" "set PHASE0B_RUN_K6=1 to execute"
fi

# 0b.8 timeout posture
OUT_0B8_TIMEOUT="$OUT_DIR/0b.8-statement-timeout.txt"
OUT_0B8_DBLIST="$OUT_DIR/0b.8-db-list.txt"
if run_psql "$OUT_0B8_TIMEOUT" "SHOW statement_timeout;"; then
  if run_psql_meta "$OUT_0B8_DBLIST" "\\l"; then
    if awk '$0=="0" || $0=="0ms" { bad=1 } END { exit bad ? 0 : 1 }' "$OUT_0B8_TIMEOUT"; then
      record_result "0b.8" "RISK" "$(basename "$OUT_0B8_TIMEOUT"),$(basename "$OUT_0B8_DBLIST")" "statement_timeout is zero"
    else
      record_result "0b.8" "PASS" "$(basename "$OUT_0B8_TIMEOUT"),$(basename "$OUT_0B8_DBLIST")" "statement_timeout is bounded"
    fi
  else
    record_result "0b.8" "ERROR" "$(basename "$OUT_0B8_DBLIST")" "database list command failed"
    SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
  fi
else
  record_result "0b.8" "ERROR" "$(basename "$OUT_0B8_TIMEOUT")" "statement_timeout query failed"
  SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
fi

# 0b.9 production sourcemap posture
OUT_0B9="$OUT_DIR/0b.9-sourcemap-posture.txt"
{
  echo "vite.config.ts excerpt:"
  sed -n '1,220p' "$ROOT_DIR/apps/web/vite.config.ts"
  echo
  if [[ -d "$ROOT_DIR/apps/web/dist" ]]; then
    MAP_COUNT="$(find "$ROOT_DIR/apps/web/dist" -name '*.map' | wc -l | tr -d '[:space:]')"
    echo "dist map file count: $MAP_COUNT"
  else
    echo "dist map file count: NOT_BUILT"
  fi
} >"$OUT_0B9" 2>&1
if grep -Eq "sourcemap\\s*:\\s*'hidden'|sourcemap\\s*:\\s*false" "$ROOT_DIR/apps/web/vite.config.ts"; then
  record_result "0b.9" "PASS" "$(basename "$OUT_0B9")" "vite sourcemap posture explicitly configured"
else
  record_result "0b.9" "RISK" "$(basename "$OUT_0B9")" "vite sourcemap posture not explicitly configured"
fi

{
  echo "# Phase 0b Probe Summary"
  echo
  echo "- Generated (UTC): $TIMESTAMP_UTC"
  echo "- Target label: $TARGET_LABEL"
  echo "- Evidence directory: \`$OUT_DIR\`"
  echo
  echo "| Probe | Status | Evidence | Note |"
  echo "|---|---|---|---|"
  while IFS='|' read -r probe_id status evidence note; do
    if [[ "$probe_id" == "probe_id" ]]; then
      continue
    fi
    printf '| %s | %s | `%s` | %s |\n' "$probe_id" "$status" "$evidence" "$note"
  done <"$RESULTS_TSV"
  echo
  if [[ $SCRIPT_ERRORS -gt 0 ]]; then
    echo "**Execution result:** probe run completed with command errors (`SCRIPT_ERRORS=$SCRIPT_ERRORS`)."
  else
    echo "**Execution result:** probe run completed without command-level errors."
  fi
} >"$SUMMARY_MD"

echo
echo "Phase 0b probe run completed."
echo "Summary: $SUMMARY_MD"
echo "Raw results: $RESULTS_TSV"
echo "Evidence dir: $OUT_DIR"

if [[ $SCRIPT_ERRORS -gt 0 ]]; then
  exit 1
fi

exit 0
