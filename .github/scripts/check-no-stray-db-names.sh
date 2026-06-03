#!/usr/bin/env bash
#
# check-no-stray-db-names.sh — enforce the Phase 0.5 database-naming
# normalization: the canonical Postgres identifiers in this repo are
#
#   owner role :  signacare_owner    (migrations / DDL / schema owner)
#   app role   :  app_user           (runtime RLS-scoped pool)
#   database   :  signacaredb
#
# These names come from docs/gold-standard-reports/08-deployment-guide.md
# §2 "Postgres role model" and they are also pinned in apps/api/.env.example.
#
# Background: on 2026-04-15 a local-dev login failure surfaced a three-way
# naming drift — .env.production pinned noususer / nousdev (the real
# historical names), apps/api/.env.example aspirationally claimed
# signacare / signacareemr (never existed anywhere), the working-tree
# apps/api/.env had nous / nousemr / app_user (a fourth set matching
# nothing), and apps/api/src/db/migrations/20260329_rls_app_user.sql
# hardcoded "GRANT ... ON DATABASE signacareemr" and "ALTER DEFAULT
# PRIVILEGES FOR ROLE signacare" — a ticking bomb that would have failed
# the next production migration run. Phase 0.5 rewrites the RLS migration
# to be name-agnostic via current_database() and
# current_setting('app.owner_role'), renames the database + owner role
# in a one-shot gated migration, and this guard stops the drift from
# silently recurring.
#
# Mode:
#   WARN (current, Phase 0.5 PR 1): log every hit, exit 0. Purpose: let
#     the prep PR merge without blocking on the existing drift that
#     Phase 0.5 PR 2 will fix.
#   FAIL (future, Phase 0.5 PR 2): on every hit, exit 1. Flipped by
#     setting NO_STRAY_DB_NAMES_MODE=fail at the top of this script (or
#     via the env var of the same name passed by CI).
#
# Allowed literals anywhere in the scanned paths:
#   signacare, signacaredb, signacare_owner, app_user
#
# Forbidden literals (case-sensitive whole-word match):
#   nous, nousdev, nousemr, noususer, signacareemr
#
# Whitelisted files (may contain the forbidden literals without being
# flagged — used by the rename migration, historical docs, and the
# dev-only bash permission allowlist):
#   apps/api/migrations/20260505000000_rename_db_and_role.ts
#   docs/fix-registry.md
#   docs/phase-0.5-rename-runbook.md
#   docs/archive/phase-0.5-rename-runbook.md  (BUG-361 2026-04-23 —
#       the runbook was moved to archive/ post-rename; the archived
#       copy legitimately retains the old names as historical record)
#   docs/audit-2026-04-19/EXECUTION-PLAN-v3-FULL.md  (BUG-361 —
#       bug-catalogue reference to the `nousdev stray in archive doc`
#       ticket itself, not a new occurrence of the drift)
#   docs/audit-2026-04-19/bug-catalogue.md  (BUG-361 — same reason)
#   .github/scripts/check-no-stray-db-names.sh  (this file — it must
#       mention the forbidden strings in its own documentation)
#   .claude/settings.json  (dev-only bash permission allowlist — contains
#       historical shell command strings with real staff email addresses
#       like admin@nous-emr.local and filesystem paths like ~/nous-emr/
#       that are NOT DB identifiers and cannot be rewritten by this
#       script without semantic understanding. DB-name patterns in this
#       file have already been updated by hand in Phase 0.5 PR 2. Not
#       shipped to production.)
#
# This guard runs in CI alongside the existing check-fix-registry.sh,
# check-naming-conventions.sh, check-no-telecom.sh, check-acs-callers.sh.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

MODE="${NO_STRAY_DB_NAMES_MODE:-warn}"

declare -i total_violations=0

# ─── Rule 1: forbidden DB / role literals ──────────────────────────────────────
#
# The pattern is a whole-word match on the five forbidden strings. We scan
# every file type where a database or role name could be hiding: env files,
# migrations (ts + sql), docker compose, CI workflow, deploy scripts,
# .claude settings, scripts, docs. Case-sensitive: "nous" the literal role
# name, not the word "anonymous" or "synonymous".
#
# Why whole-word: without \b the pattern "nous" would match "enormous",
# "renowned", "unanimous", and every other word containing the substring.
# git grep -w uses the same word-boundary rule awk/grep use: surrounded
# by non-word characters (not letters, digits or underscore).
echo "→ Rule 1: forbidden DB / role literals (nous, nousdev, nousemr, noususer, signacareemr)"
#
# Pathspec note: `**/` in a git pathspec only matches ONE OR MORE
# intermediate directory components, so `apps/api/src/db/migrations/**/*.sql`
# matches nothing when files sit directly in that flat directory. We use
# two forms: `path/*.ext` for flat directories and `path/**/*.ext` for
# tree-recursive globs. Both are listed where ambiguous.
violations_literals=$(
  git grep -nwE "nous|nousdev|nousemr|noususer|signacareemr" -- \
    'apps/api/.env*' \
    'apps/web/.env*' \
    '.env*' \
    'apps/api/migrations/*.ts' \
    'apps/api/migrations/*.sql' \
    'apps/api/src/db/migrations/*.ts' \
    'apps/api/src/db/migrations/*.sql' \
    'docker-compose*.yml' \
    'docker-compose*.yaml' \
    'deploy/*.yml' 'deploy/*.yaml' 'deploy/*.sh' \
    'deploy/**/*.yml' 'deploy/**/*.yaml' 'deploy/**/*.sh' \
    '.github/workflows/*.yml' \
    '.claude/settings.json' \
    'scripts/*.ts' 'scripts/*.sh' \
    'scripts/**/*.ts' 'scripts/**/*.sh' \
    'docs/*.md' \
    'docs/**/*.md' \
    2>/dev/null \
  | grep -v "apps/api/migrations/20260505000000_rename_db_and_role.ts" \
  | grep -v "docs/quality/fix-registry.md" \
  | grep -v "docs/phase-0.5-rename-runbook.md" \
  | grep -v "docs/archive/phase-0.5-rename-runbook.md" \
  | grep -v "docs/archive/audit-2026-04-19/EXECUTION-PLAN-v3-FULL.md" \
  | grep -v "docs/archive/audit-2026-04-19/bug-catalogue.md" \
  | grep -v "docs/plans/bug-361-stray-db-name.md" \
  | grep -v ".github/scripts/check-no-stray-db-names.sh" \
  | grep -v ".claude/settings.json" \
  | grep -vE "^[^:]*:[0-9]+: *(#|--|//|/\*|\*)" \
  || true
)
if [ -n "$violations_literals" ]; then
  echo "::warning::Forbidden DB / role literals found outside the whitelisted files:"
  echo "$violations_literals" | sed 's/^/    /'
  total_violations+=1
fi

# ─── Rule 2: hardcoded DB name or owner role inside migration GRANT/REVOKE ────
#
# Migrations in apps/api/src/db/migrations/**/*.sql must use
# current_database() and current_setting('app.owner_role') instead of
# literal identifiers in GRANT / REVOKE / ALTER DEFAULT PRIVILEGES
# statements. Literal DB names / owner role names in DDL are the class
# of bug that broke apps/api/src/db/migrations/20260329_rls_app_user.sql
# before Phase 0.5 rewrote it. Bootstrap statements like CREATE ROLE
# and the one-time rename migration are exempt (whitelisted by file).
echo "→ Rule 2: hardcoded DB / role names inside migration GRANT / REVOKE / ALTER DEFAULT PRIVILEGES"
violations_migration_ddl=$(
  git grep -nEi "(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES).*(DATABASE|ROLE)[[:space:]]+[A-Za-z_][A-Za-z0-9_]+" -- \
    'apps/api/src/db/migrations/*.sql' \
    'apps/api/migrations/*.sql' \
    2>/dev/null \
  | grep -v "current_database()" \
  | grep -v "current_setting" \
  | grep -v "current_user" \
  | grep -v "apps/api/migrations/20260505000000_rename_db_and_role.ts" \
  || true
)
if [ -n "$violations_migration_ddl" ]; then
  echo "::warning::Migration SQL hardcodes a database name or owner role literal in a GRANT / REVOKE / ALTER DEFAULT PRIVILEGES statement. Use current_database() / current_setting('app.owner_role') / current_user instead — see CLAUDE.md §7.4 and docs/fix-registry.md §NO-STRAY-DB-NAMES for the rationale."
  echo "$violations_migration_ddl" | sed 's/^/    /'
  total_violations+=1
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
if [ "$total_violations" -gt 0 ]; then
  if [ "$MODE" = "fail" ]; then
    echo "::error::no-stray-db-names guard failed with $total_violations rule(s) violated."
    echo
    echo "Background: Phase 0.5 of the Signacare plan. The Postgres role +"
    echo "database names were renamed once (Phase 0.5 PR 2) and every literal"
    echo "reference to the old nous* names was removed in the same PR. This"
    echo "guard stops drift from silently recurring. See docs/fix-registry.md"
    echo "§NO-STRAY-DB-NAMES for the full rationale + allowlist."
    exit 1
  else
    echo "::warning::no-stray-db-names guard found $total_violations rule(s) violated — running in WARN mode, not failing the build."
    echo "Phase 0.5 PR 2 will flip this guard to FAIL mode by setting NO_STRAY_DB_NAMES_MODE=fail in CI."
    echo "Until then, this is informational: plan to fix the listed drift before PR 2 merges."
    exit 0
  fi
fi

echo "no-stray-db-names guard passed."
