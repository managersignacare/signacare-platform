#!/usr/bin/env bash
# Phase 0.7.1 — CI guard: every .sql file in src/db/migrations/ must
# have a corresponding ledger-only .ts wrapper in migrations/.
# No NEW .sql files should be added — all DDL goes through Knex .ts
# files (CLAUDE.md §12).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SQL_DIR="apps/api/src/db/migrations"
TS_DIR="apps/api/migrations"

if [ ! -d "$SQL_DIR" ]; then
  echo "✓ No SQL migrations directory — nothing to check."
  exit 0
fi

sql_files=$(find "$SQL_DIR" -name "*.sql" -type f 2>/dev/null | sort)
if [ -z "$sql_files" ]; then
  echo "✓ No SQL files in $SQL_DIR."
  exit 0
fi

errors=0
for sql in $sql_files; do
  base=$(basename "$sql" .sql)
  # Check that at least one .ts wrapper references this SQL filename
  if ! grep -rl "$base" "$TS_DIR"/*.ts >/dev/null 2>&1 && \
     ! grep -rl "$(basename "$sql")" apps/api/scripts/migrate.ts >/dev/null 2>&1; then
    echo "ORPHAN: $sql has no .ts wrapper in $TS_DIR/ and is not referenced by migrate.ts"
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "FAIL: $errors orphaned SQL migration(s) found."
  echo "Every .sql file in $SQL_DIR must either:"
  echo "  1. Have a ledger-only .ts wrapper in $TS_DIR/, OR"
  echo "  2. Be referenced by apps/api/scripts/migrate.ts"
  echo "See CLAUDE.md §12 for the rule."
  exit 1
fi

echo "✓ All SQL migrations have corresponding wrappers or are referenced by migrate.ts."
