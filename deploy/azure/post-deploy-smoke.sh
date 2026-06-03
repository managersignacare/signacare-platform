#!/usr/bin/env bash
#
# deploy/azure/post-deploy-smoke.sh
#
# Sanity checks the freshly-deployed Signacare stack. Run after every
# deploy; run again after every slot swap. Zero clinical data touched
# — only health endpoints and unauthenticated metadata surfaces.
#
# Exit codes:
#   0  all probes green
#   1  one or more probes failed
#   2  misuse
#
# Usage:
#   ENV=dev     deploy/azure/post-deploy-smoke.sh
#   ENV=staging deploy/azure/post-deploy-smoke.sh
#   ENV=prod    deploy/azure/post-deploy-smoke.sh
#
# Every failure prints the expected vs actual value so the operator
# can diagnose without re-running manually.

set -uo pipefail

ENV="${ENV:-}"
if [[ -z "$ENV" ]]; then
  echo "Usage: ENV=dev|staging|prod $0" >&2
  exit 2
fi

NAME_PREFIX="${NAME_PREFIX:-signacare}"
API="https://${NAME_PREFIX}-api-${ENV}.azurewebsites.net"
WEB="https://${NAME_PREFIX}-web-${ENV}.azurewebsites.net"

fail=0

check() {
  local label="$1"
  local url="$2"
  local expect="$3"
  local actual
  actual="$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' "$url" || echo '000')"
  if [[ "$actual" == "$expect" ]]; then
    printf "  ✓ %-30s %s → %s\n" "$label" "$url" "$actual"
  else
    printf "  ✗ %-30s %s → %s (expected %s)\n" "$label" "$url" "$actual" "$expect"
    fail=1
  fi
}

check_allow_redirect() {
  local label="$1"
  local url="$2"
  local actual
  actual="$(curl --max-time 20 -L -sS -o /dev/null -w '%{http_code}' "$url" || echo '000')"
  if [[ "$actual" == "200" || "$actual" == "301" || "$actual" == "302" ]]; then
    printf "  ✓ %-30s %s → %s\n" "$label" "$url" "$actual"
  else
    printf "  ✗ %-30s %s → %s (expected 200/301/302)\n" "$label" "$url" "$actual"
    fail=1
  fi
}

check_contains() {
  local label="$1"
  local url="$2"
  local needle="$3"
  local body
  body="$(curl --max-time 20 -sS "$url" || echo '')"
  if [[ "$body" == *"$needle"* ]]; then
    printf "  ✓ %-30s %s contains %q\n" "$label" "$url" "$needle"
  else
    printf "  ✗ %-30s %s missing %q\n" "$label" "$url" "$needle"
    fail=1
  fi
}

echo "▶ Signacare EMR post-deploy smoke ($ENV)"
echo "  API: $API"
echo "  Web: $WEB"
echo ""

# ── API probes ──────────────────────────────────────────────────────────
check "API liveness"            "$API/health"                         200
check "API readiness"           "$API/ready"                          200
check_allow_redirect "API docs" "$API/api/docs"
check "FHIR metadata"           "$API/api/v1/fhir/metadata"           200
check "SMART config"            "$API/api/v1/fhir/.well-known/smart-configuration" 200

# ── Migration verification (Phase R3 dev/test deploy enhancement) ──────
# The /ready endpoint returns 200 only if postgres + redis are reachable
# AND the connection successfully runs `SELECT 1`. A 200 implies the DB
# accepts queries — i.e., the App Service migration startup hook ran
# `npm run migrate` successfully and the schema is in place. If
# migrations failed mid-run, /ready returns 503 and the check above
# fires.
#
# For stronger verification (asserting migration count >= 106), the
# post-deploy operator should run via az webapp ssh:
#   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM knex_migrations"
# This is documented in deploy/azure/README.md but cannot run from this
# script (no DB credentials; egress to public-network Postgres flexible
# server is restricted). The /ready check is the public-network-safe
# proxy.

# CORS preflight to the web origin — proves CORS_ORIGIN was set correctly.
actual_cors="$(
  curl --max-time 20 -sS -o /dev/null -w '%{http_code}' \
    -X OPTIONS "$API/api/v1/auth/login" \
    -H "Origin: $WEB" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type,x-csrf-token"
)"
if [[ "$actual_cors" == "204" || "$actual_cors" == "200" ]]; then
  printf "  ✓ %-30s preflight → %s\n" "CORS preflight" "$actual_cors"
else
  printf "  ✗ %-30s preflight → %s (expected 200/204)\n" "CORS preflight" "$actual_cors"
  fail=1
fi

# ── Web probes ─────────────────────────────────────────────────────────
check "Web index"               "$WEB/"                               200
check "Web manifest"            "$WEB/manifest.webmanifest"           200
check_contains "Web manifest scope"  "$WEB/manifest.webmanifest"      '/m/'

echo ""
if [[ $fail -eq 0 ]]; then
  echo "✓ Smoke test passed."
  exit 0
else
  echo "✗ Smoke test failed. See individual probe output above."
  exit 1
fi
