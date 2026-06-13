#!/usr/bin/env bash
#
# deploy/azure/post-deploy-smoke.sh
#
# Sanity checks the freshly-deployed Signacare stack. Run after every
# deploy; run again after every slot swap. By default this touches only
# health endpoints and unauthenticated metadata surfaces. If
# SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD are provided, it also performs
# read-only authenticated checks for deployment-critical clinical config. Set
# SMOKE_REQUIRE_AUTHENTICATED_CHECKS=true to fail when those credentials are
# missing; production workflow steps set that flag by default.
# Production also requires App Service observability settings to be present:
# Application Insights, OTEL, and both security/ops Slack alert webhooks.
#
# Exit codes:
#   0  all probes green
#   1  one or more probes failed
#   2  misuse
#
# Usage:
#   ENV=staging deploy/azure/post-deploy-smoke.sh
#   ENV=prod    deploy/azure/post-deploy-smoke.sh
#
# Every failure prints the expected vs actual value so the operator
# can diagnose without re-running manually.

set -uo pipefail

ENV="${ENV:-}"
if [[ -z "$ENV" ]]; then
  echo "Usage: ENV=staging|prod $0" >&2
  exit 2
fi

NAME_PREFIX="${NAME_PREFIX:-signacare}"
API="${SMOKE_API_URL:-https://${NAME_PREFIX}-api-${ENV}.azurewebsites.net}"
WEB="${SMOKE_WEB_URL:-https://${NAME_PREFIX}-web-${ENV}.azurewebsites.net}"
AUTH_API="${SMOKE_AUTH_API_URL:-$WEB}"

fail=0
SMOKE_HTTP_RETRIES="${SMOKE_HTTP_RETRIES:-4}"
SMOKE_HTTP_RETRY_SLEEP_SECONDS="${SMOKE_HTTP_RETRY_SLEEP_SECONDS:-5}"

run_with_retries() {
  local attempts="$1"
  local sleep_seconds="$2"
  shift 2

  local attempt=1
  local output=""
  while true; do
    output="$("$@" 2>/dev/null)" && {
      printf '%s' "$output"
      return 0
    }
    if [[ "$attempt" -ge "$attempts" ]]; then
      printf '%s' "$output"
      return 1
    fi
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done
}

authenticated_smoke_required() {
  case "${SMOKE_REQUIRE_AUTHENTICATED_CHECKS:-false}" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

observability_smoke_required() {
  case "${SMOKE_REQUIRE_OBSERVABILITY:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
  esac

  [[ "$ENV" == "prod" ]]
}

scribe_parity_smoke_required() {
  case "${SMOKE_REQUIRE_AI_SCRIBE_PARITY:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
  esac

  [[ "$ENV" == "prod" ]]
}

ai_capabilities_smoke_required() {
  case "${SMOKE_REQUIRE_AI_CAPABILITIES:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
  esac

  [[ "$ENV" == "staging" || "$ENV" == "prod" ]]
}

prompt_cache_telemetry_required() {
  case "${SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
  esac

  [[ "${SMOKE_EXPECT_AI_LANE:-}" == "azure_fast" ]]
}

check() {
  local label="$1"
  local url="$2"
  local expect="$3"
  local actual
  actual="$(run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
    curl --max-time 20 -sS -o /dev/null -w '%{http_code}' "$url" || echo '000')"
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
  actual="$(run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
    curl --max-time 20 -L -sS -o /dev/null -w '%{http_code}' "$url" || echo '000')"
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
  body="$(run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
    curl --max-time 20 -sS "$url" || echo '')"
  if [[ "$body" == *"$needle"* ]]; then
    printf "  ✓ %-30s %s contains %q\n" "$label" "$url" "$needle"
  else
    printf "  ✗ %-30s %s missing %q\n" "$label" "$url" "$needle"
    fail=1
  fi
}

check_smart_config_contract() {
  local body status result expected_issuer
  body="$(mktemp)"
  expected_issuer="$API/api/v1/fhir"
  status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS \
        -o "$body" -w '%{http_code}' \
        "$API/api/v1/fhir/.well-known/smart-configuration" || echo '000'
  )"

  if [[ "$status" != "200" ]]; then
    printf "  ✗ %-30s /.well-known/smart-configuration → %s (expected 200)\n" "SMART config contract" "$status"
    fail=1
    rm -f "$body"
    return
  fi

  result="$(python3 - <<'PY' "$body" "$expected_issuer"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

expected_issuer = sys.argv[2]
expected_prefix = expected_issuer + "/auth/"
checks = [
    ("issuer", payload.get("issuer"), expected_issuer),
    ("authorization_endpoint", payload.get("authorization_endpoint"), expected_prefix + "authorize"),
    ("token_endpoint", payload.get("token_endpoint"), expected_prefix + "token"),
    ("introspection_endpoint", payload.get("introspection_endpoint"), expected_prefix + "introspect"),
    ("revocation_endpoint", payload.get("revocation_endpoint"), expected_prefix + "revoke"),
]

mismatches = [
    f"{name}: actual={actual!r} expected={expected!r}"
    for name, actual, expected in checks
    if actual != expected
]

if mismatches:
    print("; ".join(mismatches))
else:
    print("ok")
PY
)"

  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s discovery endpoints use live public base URL\n" "SMART config contract"
  else
    printf "  ✗ %-30s %s\n" "SMART config contract" "$result"
    fail=1
  fi

  rm -f "$body"
}

check_release_version() {
  if [[ -z "${EXPECTED_SIGNACARE_RELEASE_MANIFEST_SHA256:-}" ]]; then
    printf "  ○ %-30s skipped (no expected release manifest)\n" "Release version"
    return
  fi

  local body status result
  body="$(mktemp)"
  status="$(
    curl --max-time 20 -sS \
      -o "$body" -w '%{http_code}' \
      "$API/version" || echo '000'
  )"

  if [[ "$status" != "200" ]]; then
    printf "  ✗ %-30s /version → %s (expected 200)\n" "Release version" "$status"
    fail=1
    rm -f "$body"
    return
  fi

  result="$(python3 - <<'PY' "$body"
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

checks = [
    ("status", payload.get("status"), "versioned"),
    ("activePath", payload.get("deployment", {}).get("activePath"), "linux-app-service"),
    ("releaseManifestSha256", payload.get("contracts", {}).get("releaseManifestSha256"), os.environ["EXPECTED_SIGNACARE_RELEASE_MANIFEST_SHA256"]),
    ("commitSha", payload.get("source", {}).get("commitSha"), os.environ["EXPECTED_SIGNACARE_COMMIT_SHA"]),
    ("pipeline.workflow", payload.get("pipeline", {}).get("workflow"), os.environ["EXPECTED_SIGNACARE_PIPELINE_WORKFLOW"]),
    ("pipeline.origin", payload.get("pipeline", {}).get("origin"), os.environ["EXPECTED_SIGNACARE_PIPELINE_ORIGIN"]),
    ("pipeline.promotableToProd", str(payload.get("pipeline", {}).get("promotableToProd")).lower(), os.environ["EXPECTED_SIGNACARE_RELEASE_PROMOTABLE_TO_PROD"].lower()),
    ("apiImage", payload.get("artifacts", {}).get("apiImage"), os.environ["EXPECTED_SIGNACARE_API_IMAGE_DIGEST"]),
    ("webImage", payload.get("artifacts", {}).get("webImage"), os.environ["EXPECTED_SIGNACARE_WEB_IMAGE_DIGEST"]),
    ("openapiSha256", payload.get("contracts", {}).get("openapiSha256"), os.environ["EXPECTED_SIGNACARE_OPENAPI_SHA256"]),
    ("configContractSha256", payload.get("contracts", {}).get("configContractSha256"), os.environ["EXPECTED_SIGNACARE_CONFIG_CONTRACT_SHA256"]),
    ("migrationHead", payload.get("contracts", {}).get("migrationHead"), os.environ["EXPECTED_SIGNACARE_MIGRATION_HEAD"]),
]

expected_non_promotable_reason = os.environ.get("EXPECTED_SIGNACARE_RELEASE_NON_PROMOTABLE_REASON")
if expected_non_promotable_reason is not None:
    checks.append((
        "pipeline.nonPromotableReason",
        payload.get("pipeline", {}).get("nonPromotableReason", ""),
        expected_non_promotable_reason,
    ))

promotion_source = os.environ.get("EXPECTED_SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256")
if promotion_source:
    checks.append((
        "promotion.sourceReleaseManifestSha256",
        payload.get("promotion", {}).get("sourceReleaseManifestSha256"),
        promotion_source,
    ))

for name, key, expected_env in [
    ("aiRuntime.ollamaModel", "ollamaModel", "EXPECTED_SIGNACARE_OLLAMA_MODEL"),
    ("aiRuntime.ollamaModelManifestSha256", "ollamaModelManifestSha256", "EXPECTED_SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256"),
    ("aiRuntime.whisperModel", "whisperModel", "EXPECTED_SIGNACARE_WHISPER_MODEL"),
    ("aiRuntime.whisperModelSha256", "whisperModelSha256", "EXPECTED_SIGNACARE_WHISPER_MODEL_SHA256"),
]:
    expected = os.environ.get(expected_env)
    if expected:
        checks.append((name, payload.get("aiRuntime", {}).get(key), expected))

mismatches = [
    f"{name}: actual={actual!r} expected={expected!r}"
    for name, actual, expected in checks
    if actual != expected
]

if mismatches:
    print("\n".join(mismatches))
    raise SystemExit(1)

print("ok")
PY
)"

  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s /version matches manifest\n" "Release version"
  else
    printf "  ✗ %-30s /version mismatch: %s\n" "Release version" "$result"
    fail=1
  fi

  rm -f "$body"
}

check_rating_scale_seed() {
  if [[ -z "${SMOKE_LOGIN_EMAIL:-}" || -z "${SMOKE_LOGIN_PASSWORD:-}" ]]; then
    if authenticated_smoke_required; then
      printf "  ✗ %-30s missing SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD\n" "Rating scale seed"
      fail=1
      return
    fi
    printf "  ○ %-30s skipped (set SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD)\n" "Rating scale seed"
    return
  fi

  local cookie login_payload login_body templates_body login_status template_status result
  cookie="$(mktemp)"
  login_body="$(mktemp)"
  templates_body="$(mktemp)"
  login_payload="$(python3 - <<'PY'
import json
import os

print(json.dumps({
    "email": os.environ["SMOKE_LOGIN_EMAIL"],
    "password": os.environ["SMOKE_LOGIN_PASSWORD"],
}))
PY
)"

  login_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS -c "$cookie" -b "$cookie" \
      -o "$login_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      -H "Content-Type: application/json" \
      -d "$login_payload" \
      "$AUTH_API/api/v1/auth/login" || echo '000'
  )"

  if [[ "$login_status" != "200" ]]; then
    printf "  ✗ %-30s login → %s (expected 200)\n" "Rating scale seed" "$login_status"
    fail=1
    rm -f "$cookie" "$login_body" "$templates_body"
    return
  fi

  template_status="$(
    curl --max-time 20 -sS -b "$cookie" \
      -o "$templates_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/templates" || echo '000'
  )"

  if [[ "$template_status" != "200" ]]; then
    printf "  ✗ %-30s /templates → %s (expected 200)\n" "Rating scale seed" "$template_status"
    fail=1
    rm -f "$cookie" "$login_body" "$templates_body"
    return
  fi

  result="$(python3 - <<'PY' "$templates_body"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

items = payload if isinstance(payload, list) else payload.get("templates") or payload.get("data") or []
rating = [
    item for item in items
    if item.get("category") == "Rating Scales" or item.get("categoryName") == "Rating Scales"
]
has_bprs = any("BPRS" in str(item.get("name") or "") for item in rating)
print(f"{len(rating)} {'yes' if has_bprs else 'no'}")
PY
)"

  local count has_bprs
  count="${result%% *}"
  has_bprs="${result##* }"
  if [[ "$count" -gt 0 && "$has_bprs" == "yes" ]]; then
    printf "  ✓ %-30s %s templates; BPRS present\n" "Rating scale seed" "$count"
  else
    printf "  ✗ %-30s %s templates; BPRS present=%s\n" "Rating scale seed" "$count" "$has_bprs"
    fail=1
  fi

  rm -f "$cookie" "$login_body" "$templates_body"
}

require_smoke_credentials() {
  local label="$1"
  if [[ -n "${SMOKE_LOGIN_EMAIL:-}" && -n "${SMOKE_LOGIN_PASSWORD:-}" ]]; then
    return 0
  fi

  if authenticated_smoke_required; then
    printf "  ✗ %-30s missing SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD\n" "$label"
    fail=1
    return 1
  fi

  printf "  ○ %-30s skipped (set SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD)\n" "$label"
  return 1
}

build_login_payload() {
  python3 - <<'PY'
import json
import os

print(json.dumps({
    "email": os.environ["SMOKE_LOGIN_EMAIL"],
    "password": os.environ["SMOKE_LOGIN_PASSWORD"],
}))
PY
}

login_smoke_user() {
  local cookie="$1"
  local login_body="$2"
  local label="$3"
  local login_payload login_status
  login_payload="$(build_login_payload)"

  login_status="$(
    curl --max-time 20 -sS -c "$cookie" -b "$cookie" \
      -o "$login_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      -H "Content-Type: application/json" \
      -d "$login_payload" \
      "$AUTH_API/api/v1/auth/login" || echo '000'
  )"

  if [[ "$login_status" != "200" ]]; then
    printf "  ✗ %-30s login → %s (expected 200)\n" "$label" "$login_status"
    fail=1
    return 1
  fi

  return 0
}

fetch_csrf_token() {
  local cookie="$1"
  local csrf_body="$2"
  local label="$3"
  local csrf_status csrf_token

  csrf_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS -c "$cookie" -b "$cookie" \
      -o "$csrf_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/auth/csrf" || echo '000'
  )"

  if [[ "$csrf_status" != "200" ]]; then
    printf "  ✗ %-30s /auth/csrf → %s (expected 200)\n" "$label" "$csrf_status"
    fail=1
    return 1
  fi

  csrf_token="$(python3 - <<'PY' "$csrf_body"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

print(str(payload.get("csrfToken") or ""))
PY
)"

  if [[ -z "$csrf_token" ]]; then
    printf "  ✗ %-30s /auth/csrf returned no csrfToken\n" "$label"
    fail=1
    return 1
  fi

  SMOKE_CSRF_TOKEN="$csrf_token"
}

check_observability_config() {
  if ! observability_smoke_required; then
    printf "  ○ %-30s skipped (SMOKE_REQUIRE_OBSERVABILITY != true)\n" "Observability config"
    return
  fi

  if ! command -v az >/dev/null 2>&1; then
    printf "  ✗ %-30s Azure CLI unavailable; cannot prove App Service settings\n" "Observability config"
    fail=1
    return
  fi

  local rg app slot settings_body result
  rg="${SMOKE_AZURE_RESOURCE_GROUP:-${NAME_PREFIX}-rg-${ENV}}"
  app="${SMOKE_AZURE_API_APP_NAME:-${NAME_PREFIX}-api-${ENV}}"
  slot="${SMOKE_AZURE_API_SLOT:-}"
  settings_body="$(mktemp)"

  if [[ -n "$slot" ]]; then
    if ! az webapp config appsettings list \
      --resource-group "$rg" \
      --name "$app" \
      --slot "$slot" \
      --output json > "$settings_body"; then
      printf "  ✗ %-30s unable to read app settings for %s/%s slot=%s\n" "Observability config" "$rg" "$app" "$slot"
      fail=1
      rm -f "$settings_body"
      return
    fi
  elif ! az webapp config appsettings list \
    --resource-group "$rg" \
    --name "$app" \
    --output json > "$settings_body"; then
    printf "  ✗ %-30s unable to read app settings for %s/%s\n" "Observability config" "$rg" "$app"
    fail=1
    rm -f "$settings_body"
    return
  fi

  result="$(python3 - <<'PY' "$settings_body"
import json
import sys

required = [
    "APPLICATIONINSIGHTS_CONNECTION_STRING",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "SLACK_WEBHOOK_SECURITY",
    "SLACK_WEBHOOK_OPS",
]

with open(sys.argv[1], encoding="utf-8") as fh:
    items = json.load(fh)

settings = {
    str(item.get("name")): str(item.get("value") or "").strip()
    for item in items
    if isinstance(item, dict)
}
missing = [key for key in required if not settings.get(key)]
if missing:
    print("missing:" + ",".join(missing))
else:
    print("ok")
PY
)"

  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s App Insights, OTEL, and alert webhooks are configured\n" "Observability config"
  else
    printf "  ✗ %-30s %s\n" "Observability config" "$result"
    fail=1
  fi

  rm -f "$settings_body"
}

check_ai_runtime_smoke() {
  if [[ "${AZURE_AI_RUNTIME_ENABLED:-false}" != "true" ]]; then
    printf "  ○ %-30s skipped (AZURE_AI_RUNTIME_ENABLED != true)\n" "AI runtime"
    return
  fi

  if ! require_smoke_credentials "AI runtime"; then
    return
  fi

  local cookie login_body csrf_body whisper_body models_body ai_body ai_payload
  local whisper_status models_status ai_status result
  cookie="$(mktemp)"
  login_body="$(mktemp)"
  csrf_body="$(mktemp)"
  whisper_body="$(mktemp)"
  models_body="$(mktemp)"
  ai_body="$(mktemp)"

  if ! login_smoke_user "$cookie" "$login_body" "AI runtime"; then
    rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
    return
  fi

  SMOKE_CSRF_TOKEN=""
  if ! fetch_csrf_token "$cookie" "$csrf_body" "AI runtime"; then
    rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
    return
  fi

  whisper_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS -b "$cookie" \
      -o "$whisper_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/llm/whisper/status" || echo '000'
  )"
  if [[ "$whisper_status" != "200" ]]; then
    printf "  ✗ %-30s /llm/whisper/status → %s (expected 200)\n" "AI runtime" "$whisper_status"
    fail=1
    rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
    return
  fi

  result="$(python3 - <<'PY' "$whisper_body"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

running = payload.get("running") is True
url = str(payload.get("url") or "")
print("ok" if running and "whisper" in url else "bad")
PY
)"
  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s Whisper sidecar healthy\n" "AI runtime"
  else
    printf "  ✗ %-30s Whisper sidecar unhealthy: %s\n" "AI runtime" "$(tr -d '\n' < "$whisper_body")"
    fail=1
  fi

  models_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 30 -sS -b "$cookie" \
      -o "$models_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/llm/models" || echo '000'
  )"
  if [[ "$models_status" != "200" ]]; then
    printf "  ✗ %-30s /llm/models → %s (expected 200)\n" "AI runtime" "$models_status"
    fail=1
    rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
    return
  fi

  result="$(python3 - <<'PY' "$models_body"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

models = payload.get("models") if isinstance(payload, dict) else []
available = [
    str(item.get("ollamaModel") or item.get("name") or item.get("id") or "")
    for item in models
    if isinstance(item, dict) and item.get("available") is True
]
print("ok" if any(model.startswith("llama3.2") for model in available) else "bad")
PY
)"
  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s Ollama model available\n" "AI runtime"
  else
    printf "  ✗ %-30s Ollama model unavailable: %s\n" "AI runtime" "$(tr -d '\n' < "$models_body")"
    fail=1
  fi

  ai_payload="$(python3 - <<'PY'
import json

print(json.dumps({
    "action": "isbar",
    "data": "Non-PHI smoke: stable outpatient review, no acute risk, continue current plan.",
    "conversationId": "00000000-0000-4000-8000-000000000001",
    "enhance": False,
}))
PY
)"
  ai_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 180 -sS -b "$cookie" \
      -o "$ai_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      -H "Content-Type: application/json" \
      -H "X-CSRF-Token: $SMOKE_CSRF_TOKEN" \
      -d "$ai_payload" \
      "$AUTH_API/api/v1/llm/clinical-ai" || echo '000'
  )"
  if [[ "$ai_status" != "200" ]]; then
    printf "  ✗ %-30s /llm/clinical-ai → %s (expected 200)\n" "AI runtime" "$ai_status"
    fail=1
    rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
    return
  fi

  result="$(python3 - <<'PY' "$ai_body"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

text = str(payload.get("result") or "")
bad_markers = ["[AI unavailable", "AI unavailable", "Ollama is not running"]
print("ok" if len(text.strip()) >= 20 and not any(marker in text for marker in bad_markers) else "bad")
PY
)"
  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s non-fallback clinical AI response\n" "AI runtime"
  else
    printf "  ✗ %-30s fallback/empty clinical AI response: %s\n" "AI runtime" "$(tr -d '\n' < "$ai_body")"
    fail=1
  fi

  rm -f "$cookie" "$login_body" "$csrf_body" "$whisper_body" "$models_body" "$ai_body"
}

check_ai_scribe_parity_smoke() {
  if [[ -z "${SMOKE_LOGIN_EMAIL:-}" || -z "${SMOKE_LOGIN_PASSWORD:-}" ]]; then
    if scribe_parity_smoke_required; then
      printf "  ✗ %-30s missing SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD\n" "AI scribe parity"
      fail=1
      return
    fi
    printf "  ○ %-30s skipped (set SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD)\n" "AI scribe parity"
    return
  fi

  local cookie login_body capabilities_body capabilities_status result require_prompt_cache
  cookie="$(mktemp)"
  login_body="$(mktemp)"
  capabilities_body="$(mktemp)"

  if ! login_smoke_user "$cookie" "$login_body" "AI scribe parity"; then
    rm -f "$cookie" "$login_body" "$capabilities_body"
    return
  fi

  capabilities_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS -b "$cookie" \
      -o "$capabilities_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/scribe/capabilities" || echo '000'
  )"
  if [[ "$capabilities_status" != "200" ]]; then
    printf "  ✗ %-30s /scribe/capabilities → %s (expected 200)\n" "AI scribe parity" "$capabilities_status"
    fail=1
    rm -f "$cookie" "$login_body" "$capabilities_body"
    return
  fi

  result="$(python3 - <<'PY' "$capabilities_body"
import json
import sys

required = {
    "realtime_in_visit_documentation",
    "au_document_generation",
    "per_clinician_style_learning",
    "structured_mse_citations",
    "shared_lineage_keying",
    "outcome_telemetry",
}
with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

capabilities = set(payload.get("capabilities") or [])
missing = sorted(required - capabilities)
active = payload.get("activePath")
prod_required = payload.get("productionSmokeRequired")
if not missing and active == "async-ai-scribe-v2" and prod_required is True:
    print("ok")
else:
    print("missing=" + ",".join(missing) + f" active={active!r} prodRequired={prod_required!r}")
PY
)"

  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s six parity capabilities advertised\n" "AI scribe parity"
  else
    printf "  ✗ %-30s capability contract failed: %s\n" "AI scribe parity" "$result"
    fail=1
  fi

  rm -f "$cookie" "$login_body" "$capabilities_body"
}

check_ai_capabilities_smoke() {
  if [[ -z "${SMOKE_LOGIN_EMAIL:-}" || -z "${SMOKE_LOGIN_PASSWORD:-}" ]]; then
    if ai_capabilities_smoke_required; then
      printf "  ✗ %-30s missing SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD\n" "AI capabilities"
      fail=1
      return
    fi
    printf "  ○ %-30s skipped (set SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD)\n" "AI capabilities"
    return
  fi

  local cookie login_body capabilities_body capabilities_status result
  cookie="$(mktemp)"
  login_body="$(mktemp)"
  capabilities_body="$(mktemp)"

  if ! login_smoke_user "$cookie" "$login_body" "AI capabilities"; then
    rm -f "$cookie" "$login_body" "$capabilities_body"
    return
  fi

  capabilities_status="$(
    run_with_retries "$SMOKE_HTTP_RETRIES" "$SMOKE_HTTP_RETRY_SLEEP_SECONDS" \
      curl --max-time 20 -sS -b "$cookie" \
      -o "$capabilities_body" -w '%{http_code}' \
      -H "Origin: $WEB" \
      "$AUTH_API/api/v1/ai/capabilities" || echo '000'
  )"
  if [[ "$capabilities_status" != "200" ]]; then
    printf "  ✗ %-30s /ai/capabilities → %s (expected 200)\n" "AI capabilities" "$capabilities_status"
    fail=1
    rm -f "$cookie" "$login_body" "$capabilities_body"
    return
  fi

  require_prompt_cache="false"
  if prompt_cache_telemetry_required; then
    require_prompt_cache="true"
  fi

  result="$(SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY_EFFECTIVE="$require_prompt_cache" python3 - <<'PY' "$capabilities_body"
import json
import os
import re
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    payload = json.load(fh)

errors = []
active = payload.get("activeLane") or {}
lanes = payload.get("lanes") or []
expected_lane = os.environ.get("SMOKE_EXPECT_AI_LANE", "").strip()
require_cache = os.environ.get("SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY_EFFECTIVE", "").lower() == "true"

if payload.get("schemaVersion") != "1.0":
    errors.append(f"schemaVersion={payload.get('schemaVersion')!r}")
if not re.fullmatch(r"[a-f0-9]{64}", str(payload.get("promptPrefixHashSample") or "")):
    errors.append("promptPrefixHashSample missing/invalid")
if not isinstance(lanes, list) or len(lanes) < 1:
    errors.append("lanes missing/empty")
if active.get("health") not in {"healthy", "degraded"}:
    errors.append(f"activeLane.health={active.get('health')!r}")
if not isinstance(active.get("cachedTokensTelemetryEnabled"), bool):
    errors.append("activeLane.cachedTokensTelemetryEnabled not boolean")
if expected_lane and active.get("lane") != expected_lane:
    errors.append(f"activeLane.lane={active.get('lane')!r} expected={expected_lane!r}")
if expected_lane == "azure_fast":
    if active.get("privateNetworkEnforced") is not True:
        errors.append("azure_fast active lane is not private-network enforced")
    if active.get("managedIdentityEnforced") is not True:
        errors.append("azure_fast active lane is not managed-identity enforced")
if require_cache and active.get("cachedTokensTelemetryEnabled") is not True:
    errors.append("cached_tokens telemetry not enabled on active lane")
if payload.get("stagingSmokeRequired") is not True:
    errors.append("stagingSmokeRequired not true")
if payload.get("productionSmokeRequired") is not True:
    errors.append("productionSmokeRequired not true")

print("ok" if not errors else "; ".join(errors))
PY
)"

  if [[ "$result" == "ok" ]]; then
    printf "  ✓ %-30s prompt-prefix + cached-token telemetry contract\n" "AI capabilities"
  else
    printf "  ✗ %-30s capability contract failed: %s\n" "AI capabilities" "$result"
    fail=1
  fi

  rm -f "$cookie" "$login_body" "$capabilities_body"
}

echo "▶ Signacare EMR post-deploy smoke ($ENV)"
echo "  API: $API"
echo "  Web: $WEB"
echo ""

# ── API probes ──────────────────────────────────────────────────────────
check "API liveness"            "$API/health"                         200
check "API readiness"           "$API/ready"                          200
check_release_version
check_observability_config
check_allow_redirect "API docs" "$API/api/docs"
check "FHIR metadata"           "$API/api/v1/fhir/metadata"           200
check "SMART config"            "$API/api/v1/fhir/.well-known/smart-configuration" 200
check_smart_config_contract

# ── Migration verification ──────────────────────────────────────────────
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
  cors_headers="$(mktemp)"
  cors_status="$(curl --max-time 20 -sS -D "$cors_headers" -o /dev/null -w '%{http_code}' \
    -X OPTIONS "$API/api/v1/auth/login" \
    -H "Origin: $WEB" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type,x-csrf-token,x-request-id,idempotency-key"
  )"
  cors_allowed="$(grep -i '^Access-Control-Allow-Headers:' "$cors_headers" | tr '[:upper:]' '[:lower:]')"
  rm -f "$cors_headers"
  if [[ "$cors_allowed" == *"idempotency-key"* ]]; then
    printf '%s' "$cors_status"
  else
    printf '%s-missing-idempotency-key' "$cors_status"
  fi
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
check "Web API proxy"           "$WEB/api/v1/fhir/metadata"           200

# ── Optional authenticated config probes ───────────────────────────────
check_rating_scale_seed
check_ai_runtime_smoke
check_ai_capabilities_smoke
check_ai_scribe_parity_smoke

echo ""
if [[ $fail -eq 0 ]]; then
  echo "✓ Smoke test passed."
  exit 0
else
  echo "✗ Smoke test failed. See individual probe output above."
  exit 1
fi
