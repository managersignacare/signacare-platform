#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:?DB_PORT is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_APP_USER:?DB_APP_USER is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"

export PGPASSWORD="$DB_PASSWORD"

sql_escape_literal() {
  printf '%s' "${1//\'/\'\'}"
}

runtime_role_escaped="$(sql_escape_literal "$DB_APP_USER")"
runtime_password_escaped="$(sql_escape_literal "$DB_APP_PASSWORD")"

psql \
  "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=disable" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtime_role_escaped}') THEN
    EXECUTE format(
      'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      '${runtime_role_escaped}',
      '${runtime_password_escaped}'
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN PASSWORD %L',
      '${runtime_role_escaped}',
      '${runtime_password_escaped}'
    );
  END IF;
END \$\$;
SQL
