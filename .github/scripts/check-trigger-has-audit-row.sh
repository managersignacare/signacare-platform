#!/usr/bin/env bash
#
# check-trigger-has-audit-row.sh — BUG-358 invariant: every DB trigger
# function in apps/api/migrations/*.ts that MUTATES state must emit an
# audit trail (INSERT INTO audit_log) or be a fail-closed denial gate
# (RAISE EXCEPTION/NOTICE/WARNING).
#
# HIPAA §164.312(b) and OWASP ASVS v4 §7.1.3 require security-relevant
# state changes to be recorded. BUG-354 retroactive L4/L5 found that
# `clinics_access_admin_slot_integrity` silently NULLed admin-slot FK
# columns on `clinics` with zero audit record. BUG-357 extended the
# pattern requirement to every similar trigger; THIS GUARD (BUG-358)
# mechanically enforces it for new migrations.
#
# Semantics — latest-definition-wins
#   A trigger function may be redefined (CREATE OR REPLACE FUNCTION)
#   by a later migration. The guard checks only the LATEST migration
#   that defines each function name — earlier definitions are
#   superseded at runtime. Migration filename timestamp prefixes make
#   lexicographic sort equivalent to chronological order.
#
# `down()` exclusion — function bodies inside `export async function
# down(` are restoration-to-prior-state and not re-checked.
#
# Dollar-quote tag — PostgreSQL permits any `$<tag>$` delimiter
# (`$$`, `$fn$`, etc.). The guard captures the opening tag on the
# `AS $tag$` line and closes on the first matching reappearance.
#
# Allowlist (by function name):
#   audit_trigger_fn        — IS the canonical audit writer
#   set_updated_at          — BEFORE UPDATE timestamp helper
#   staff_can_see_specialty — SQL RLS helper, returns boolean
#
# Exit 0 pass; 1 fail.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

echo "→ check-trigger-has-audit-row (BUG-358 invariant)"

migrations_latest_first() {
  for f in apps/api/migrations/*.ts; do
    if grep -q "^// @migration-squashed-baseline" "$f" 2>/dev/null; then continue; fi
    echo "$f"
  done | sort -r
}

# Extract trigger-function bodies. For each CREATE FUNCTION, track:
#   - which up()/down() section we're in
#   - the dollar-quote tag (e.g. $$ or $fn$)
#   - whether the body contains INSERT INTO audit_log or RAISE
# Emit one tab-separated line per TRIGGER function found:
#   fn_name \t section \t file:line \t has_audit \t has_raise
extract_triggers() {
  local file="$1"
  awk -v file="$file" '
    /^export async function up\(/  { current_section = "up" }
    /^export async function down\(/ { current_section = "down" }
    /CREATE (OR REPLACE )?FUNCTION/ {
      # Reset function-scope tracking state
      in_fn = 1
      line_no = NR
      s = $0
      sub(/.*CREATE (OR REPLACE )?FUNCTION[[:space:]]+/, "", s)
      sub(/[^a-zA-Z0-9_].*/, "", s)
      fn_name = s
      is_trigger = 0
      has_audit = 0
      has_raise = 0
      open_tag = ""
    }
    in_fn {
      if ($0 ~ /RETURNS[[:space:]]+[Tt][Rr][Ii][Gg][Gg][Ee][Rr]/) is_trigger = 1
      if ($0 ~ /INSERT[[:space:]]+INTO[[:space:]]+audit_log/) has_audit = 1
      if ($0 ~ /RAISE[[:space:]]+(EXCEPTION|NOTICE|WARNING)/) has_raise = 1

      # If the opening dollar-quote tag has been captured, look for
      # its REAPPEARANCE on this line (and only if this line is AFTER
      # the opening-tag line). This avoids the trap where `$fn$`
      # appearing twice on the same line would self-close immediately.
      if (open_tag != "" && NR > open_tag_line) {
        if (index($0, open_tag) > 0) {
          if (is_trigger && fn_name != "") {
            printf "%s\t%s\t%s:%d\t%d\t%d\n", fn_name, current_section, file, line_no, has_audit, has_raise
          }
          in_fn = 0
          open_tag = ""
          open_tag_line = 0
          next
        }
      }

      # Detect opening dollar-quote tag on this line if we have not
      # already captured one.
      if (open_tag == "") {
        line = $0
        if (match(line, /\$[a-zA-Z0-9_]*\$/)) {
          open_tag = substr(line, RSTART, RLENGTH)
          open_tag_line = NR
        }
      }
    }
  ' "$file"
}

# Scan all migration files latest-first; capture into temp file.
scan_file=$(mktemp)
trap 'rm -f "$scan_file" "$latest_file"' EXIT

while IFS= read -r migration; do
  extract_triggers "$migration"
done < <(migrations_latest_first) > "$scan_file"

# Deduplicate by function name — keep only the first occurrence (latest-
# first sort ensures this is the latest definition). Skip down() rows.
latest_file=$(mktemp)
awk -F'\t' '
  $2 == "down" { next }
  !($1 in seen) { seen[$1] = 1; print }
' "$scan_file" > "$latest_file"

declare -i scanned=0
declare -i violations=0

while IFS=$'\t' read -r fn section location has_audit has_raise; do
  [ -z "$fn" ] && continue
  scanned=$((scanned + 1))

  case "$fn" in
    audit_trigger_fn|set_updated_at|staff_can_see_specialty) continue ;;
  esac

  if [ "$has_audit" = "1" ] || [ "$has_raise" = "1" ]; then
    continue
  fi

  echo "::error::trigger function '$fn' at $location mutates state without audit_log INSERT or RAISE"
  echo "    fix:  add 'INSERT INTO audit_log (...)' inside the function body (pattern at baseline.ts:96-120)"
  echo "    or:   add 'RAISE EXCEPTION ...' for fail-closed denial gates"
  echo "    or:   add '$fn' to the allowlist in this guard with inline rationale"
  violations=$((violations + 1))
done < "$latest_file"

echo "  triggers scanned: $scanned (latest up() definition per function name; squashed-baseline + allowlist skipped)"
echo "  violations:       $violations"

if [ "$violations" -gt 0 ]; then
  echo "::error::BUG-358 guard found $violations trigger function(s) mutating state without audit_log INSERT or RAISE."
  exit 1
fi

echo "✓ All trigger functions either emit audit_log or are fail-closed raises."
exit 0
