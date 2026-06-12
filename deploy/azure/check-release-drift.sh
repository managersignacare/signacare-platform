#!/usr/bin/env bash
#
# Verifies that a deployed Signacare Azure environment is still running the
# immutable release the API advertises at /version. This is the post-release
# drift audit for the Linux App Service lane.

set -euo pipefail

ENV_NAME="${ENV:-${1:-}}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: ENV=staging|prod $0" >&2
  exit 2
fi

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
  echo "Environment must be staging or prod, got '$ENV_NAME'" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 2
  fi
}

require_cmd az
require_cmd curl
require_cmd python3

NAME_PREFIX="${NAME_PREFIX:-signacare}"
RESOURCE_GROUP="${SMOKE_AZURE_RESOURCE_GROUP:-${NAME_PREFIX}-rg-${ENV_NAME}}"
API_APP_NAME="${SMOKE_AZURE_API_APP_NAME:-${NAME_PREFIX}-api-${ENV_NAME}}"
WEB_APP_NAME="${SMOKE_AZURE_WEB_APP_NAME:-${NAME_PREFIX}-web-${ENV_NAME}}"
API_SLOT="${SMOKE_AZURE_API_SLOT:-}"
WEB_SLOT="${SMOKE_AZURE_WEB_SLOT:-$API_SLOT}"
EXPECT_AI_RUNTIME="${EXPECT_AI_RUNTIME:-false}"
EXPECT_AZURE_OPENAI="${EXPECT_AZURE_OPENAI:-false}"

slot_url_suffix() {
  local slot="$1"
  if [[ -n "$slot" ]]; then
    printf -- "-%s" "$slot"
  fi
}

API_URL="${SMOKE_API_URL:-https://${API_APP_NAME}$(slot_url_suffix "$API_SLOT").azurewebsites.net}"
WEB_URL="${SMOKE_WEB_URL:-https://${WEB_APP_NAME}$(slot_url_suffix "$WEB_SLOT").azurewebsites.net}"
API_VERSION_URL="${API_URL}/version"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

status="$(
  curl --max-time 20 -sS \
    -o "$body_file" -w '%{http_code}' \
    "$API_VERSION_URL" || echo '000'
)"
if [[ "$status" != "200" ]]; then
  echo "API /version returned $status from $API_VERSION_URL (expected 200)." >&2
  exit 1
fi

slot_args=()
if [[ -n "$API_SLOT" ]]; then
  slot_args=(--slot "$API_SLOT")
fi
web_slot_args=()
if [[ -n "$WEB_SLOT" ]]; then
  web_slot_args=(--slot "$WEB_SLOT")
fi

api_linux_fx="$(az webapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP_NAME" \
  "${slot_args[@]}" \
  --query 'siteConfig.linuxFxVersion' \
  -o tsv)"
web_linux_fx="$(az webapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEB_APP_NAME" \
  "${web_slot_args[@]}" \
  --query 'siteConfig.linuxFxVersion' \
  -o tsv)"

api_settings_json="$(mktemp)"
trap 'rm -f "$body_file" "$api_settings_json"' EXIT
az webapp config appsettings list \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP_NAME" \
  "${slot_args[@]}" \
  -o json > "$api_settings_json"

ai_env_flags="$(python3 - <<'PY' "$api_settings_json"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    rows = json.load(fh)

lookup = {row["name"]: row.get("value", "") for row in rows}
print(lookup.get("AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED", ""))
print(lookup.get("AZURE_OPENAI_ENDPOINT", ""))
print(lookup.get("SIGNACARE_OLLAMA_IMAGE_DIGEST", ""))
print(lookup.get("SIGNACARE_WHISPER_IMAGE_DIGEST", ""))
PY
)"
azure_private_network_enforced="$(printf '%s\n' "$ai_env_flags" | sed -n '1p')"
azure_endpoint_setting="$(printf '%s\n' "$ai_env_flags" | sed -n '2p')"
expected_ollama_image="$(printf '%s\n' "$ai_env_flags" | sed -n '3p')"
expected_whisper_image="$(printf '%s\n' "$ai_env_flags" | sed -n '4p')"

export RESOURCE_GROUP API_APP_NAME WEB_APP_NAME API_SLOT WEB_SLOT API_URL WEB_URL API_VERSION_URL EXPECT_AI_RUNTIME EXPECT_AZURE_OPENAI
export ENV_NAME NAME_PREFIX
export API_LINUX_FX="$api_linux_fx"
export WEB_LINUX_FX="$web_linux_fx"
export AZURE_PRIVATE_NETWORK_ENFORCED="$azure_private_network_enforced"
export AZURE_ENDPOINT_SETTING="$azure_endpoint_setting"
export EXPECTED_OLLAMA_IMAGE="$expected_ollama_image"
export EXPECTED_WHISPER_IMAGE="$expected_whisper_image"

python3 - <<'PY' "$body_file" "$api_settings_json"
import json
import os
import subprocess
import sys


def app_setting(settings, key):
    for row in settings:
        if row.get("name") == key:
            return row.get("value", "")
    return ""


def webapp_linux_fx(resource_group, app_name, slot):
    cmd = [
        "az", "webapp", "show",
        "--resource-group", resource_group,
        "--name", app_name,
        "--query", "siteConfig.linuxFxVersion",
        "-o", "tsv",
    ]
    if slot:
        cmd.extend(["--slot", slot])
    return subprocess.check_output(cmd, text=True).strip()


with open(sys.argv[1], encoding="utf-8") as fh:
    version_payload = json.load(fh)
with open(sys.argv[2], encoding="utf-8") as fh:
    app_settings = json.load(fh)

errors = []

if version_payload.get("status") != "versioned":
    errors.append(f"status={version_payload.get('status')!r}")
if version_payload.get("deployment", {}).get("activePath") != "linux-app-service":
    errors.append(f"activePath={version_payload.get('deployment', {}).get('activePath')!r}")

api_image = version_payload.get("artifacts", {}).get("apiImage", "")
web_image = version_payload.get("artifacts", {}).get("webImage", "")
api_linux_fx = os.environ["API_LINUX_FX"]
web_linux_fx = os.environ["WEB_LINUX_FX"]
if api_linux_fx != f"DOCKER|{api_image}":
    errors.append(f"api linuxFxVersion={api_linux_fx!r} expected DOCKER|{api_image!r}")
if web_linux_fx != f"DOCKER|{web_image}":
    errors.append(f"web linuxFxVersion={web_linux_fx!r} expected DOCKER|{web_image!r}")

checks = {
    "SIGNACARE_RELEASE_ENV": version_payload.get("deployment", {}).get("environment", ""),
    "SIGNACARE_COMMIT_SHA": version_payload.get("source", {}).get("commitSha", ""),
    "SIGNACARE_PIPELINE_WORKFLOW": version_payload.get("pipeline", {}).get("workflow", ""),
    "SIGNACARE_PIPELINE_RUN_ID": version_payload.get("pipeline", {}).get("runId", ""),
    "SIGNACARE_PIPELINE_RUN_ATTEMPT": version_payload.get("pipeline", {}).get("runAttempt", ""),
    "SIGNACARE_PIPELINE_ORIGIN": version_payload.get("pipeline", {}).get("origin", ""),
    "SIGNACARE_RELEASE_PROMOTABLE_TO_PROD": str(version_payload.get("pipeline", {}).get("promotableToProd", "")).lower(),
    "SIGNACARE_RELEASE_NON_PROMOTABLE_REASON": version_payload.get("pipeline", {}).get("nonPromotableReason", ""),
    "SIGNACARE_IMAGE_TAG": version_payload.get("build", {}).get("imageTag", ""),
    "SIGNACARE_BUILD_TIME": version_payload.get("build", {}).get("builtAt", ""),
    "SIGNACARE_API_IMAGE_DIGEST": api_image,
    "SIGNACARE_WEB_IMAGE_DIGEST": web_image,
    "SIGNACARE_OLLAMA_IMAGE_DIGEST": version_payload.get("artifacts", {}).get("ollamaImage", ""),
    "SIGNACARE_WHISPER_IMAGE_DIGEST": version_payload.get("artifacts", {}).get("whisperImage", ""),
    "SIGNACARE_RELEASE_MANIFEST_SHA256": version_payload.get("contracts", {}).get("releaseManifestSha256", ""),
    "SIGNACARE_OPENAPI_SHA256": version_payload.get("contracts", {}).get("openapiSha256", ""),
    "SIGNACARE_CONFIG_CONTRACT_SHA256": version_payload.get("contracts", {}).get("configContractSha256", ""),
    "SIGNACARE_MIGRATION_HEAD": version_payload.get("contracts", {}).get("migrationHead", ""),
    "SIGNACARE_PROMOTION_SOURCE_ENV": version_payload.get("promotion", {}).get("sourceEnvironment", ""),
    "SIGNACARE_PROMOTION_SOURCE_ACR_NAME": version_payload.get("promotion", {}).get("sourceAcrName", ""),
    "SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256": version_payload.get("promotion", {}).get("sourceReleaseManifestSha256", ""),
    "SIGNACARE_PROMOTION_SOURCE_PIPELINE_RUN_ID": version_payload.get("promotion", {}).get("sourcePipelineRunId", ""),
    "SIGNACARE_PROMOTED_AT": version_payload.get("promotion", {}).get("promotedAt", ""),
}
for key, expected in checks.items():
    actual = app_setting(app_settings, key)
    if actual != expected:
        errors.append(f"{key}={actual!r} expected {expected!r}")

expect_azure = os.environ.get("EXPECT_AZURE_OPENAI", "").lower() == "true"
if expect_azure:
    if os.environ.get("AZURE_PRIVATE_NETWORK_ENFORCED") != "true":
        errors.append("AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED != 'true'")
    endpoint = os.environ.get("AZURE_ENDPOINT_SETTING", "")
    if not endpoint.startswith("@Microsoft.KeyVault("):
        errors.append("AZURE_OPENAI_ENDPOINT is not a Key Vault reference")

expect_ai_runtime = os.environ.get("EXPECT_AI_RUNTIME", "").lower() == "true"
if expect_ai_runtime:
    resource_group = os.environ["RESOURCE_GROUP"]
    expected_ollama = os.environ.get("EXPECTED_OLLAMA_IMAGE", "")
    expected_whisper = os.environ.get("EXPECTED_WHISPER_IMAGE", "")
    if not expected_ollama or not expected_whisper:
        errors.append("AI runtime expected but SIGNACARE_OLLAMA/WHISPER_IMAGE_DIGEST settings are empty")
    else:
        name_prefix = os.environ["NAME_PREFIX"]
        env_name = os.environ["ENV_NAME"]
        ollama_linux_fx = webapp_linux_fx(resource_group, f"{name_prefix}-ollama-{env_name}", "")
        whisper_linux_fx = webapp_linux_fx(resource_group, f"{name_prefix}-whisper-{env_name}", "")
        if ollama_linux_fx != f"DOCKER|{expected_ollama}":
            errors.append(f"ollama linuxFxVersion={ollama_linux_fx!r} expected DOCKER|{expected_ollama!r}")
        if whisper_linux_fx != f"DOCKER|{expected_whisper}":
            errors.append(f"whisper linuxFxVersion={whisper_linux_fx!r} expected DOCKER|{expected_whisper!r}")

if errors:
    print("Release drift audit failed:")
    for err in errors:
        print(f" - {err}")
    raise SystemExit(1)

print("Release drift audit passed.")
PY

echo "✓ Drift audit passed for $ENV_NAME"
