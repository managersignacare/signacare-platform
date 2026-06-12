#!/bin/sh
set -eu

run_migrations="${SIGNACARE_RUN_MIGRATIONS_ON_STARTUP:-true}"

if [ "$run_migrations" = "true" ]; then
  echo "Running Signacare API migrations before startup..."
  node -r dotenv/config dist/scripts/migrate.js
fi

exec node -r dotenv/config dist/src/index.js
