#!/usr/bin/env bash
#
# deploy/azure/preflight-linux.sh
#
# Predictive readiness checks for the Linux App Service stack.
# Purpose:
#   - fail fast on known blockers before we start a long `az deployment` run;
#   - provide deterministic triage data for recurring deployment issues.
#
# Usage:
#   bash deploy/azure/preflight-linux.sh staging
#   bash deploy/azure/preflight-linux.sh prod
#
# Expected parameter files:
#   deploy/azure/parameters.{staging,prod}.json

set -euo pipefail

ENV="${1:-}"
if [[ -z "$ENV" ]]; then
  echo "Usage: $0 {staging|prod}" >&2
  exit 2
fi

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Environment must be 'staging' or 'prod', got '$ENV'" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARAMS="$SCRIPT_DIR/parameters.$ENV.json"
if [[ ! -f "$PARAMS" ]]; then
  echo "Missing parameters file: $PARAMS" >&2
  exit 2
fi

log() {
  printf "• %s\n" "$1"
}

fail() {
  printf "✗ %s\n" "$1" >&2
  FAILED=1
}

warn() {
  printf "⚠ %s\n" "$1"
}

pass() {
  printf "✓ %s\n" "$1"
}

FAILED=0

log "Signacare Linux preflight for '$ENV'"
log "Parameters: $PARAMS"

if ! command -v az >/dev/null 2>&1; then
  fail "Azure CLI (az) is required."
elif ! command -v jq >/dev/null 2>&1; then
  fail "jq is required."
else
  pass "Local tooling available: az, jq"
fi

if ! command -v openssl >/dev/null 2>&1; then
  warn "openssl not found; falling back to shell random source for secrets."
else
  pass "openssl available"
fi

generate_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  else
    LC_ALL=C LC_COLLATE=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$bytes"
  fi
}

ACCOUNT_JSON="$(az account show --output json 2>/dev/null || true)"
if [[ -z "$ACCOUNT_JSON" ]]; then
  fail "Azure session missing: run az login and az account set --subscription ..."
else
  SUBSCRIPTION_NAME="$(echo "$ACCOUNT_JSON" | jq -r '.name // ""')"
  SUBSCRIPTION_ID="$(echo "$ACCOUNT_JSON" | jq -r '.id // ""')"
  TENANT_ID="$(echo "$ACCOUNT_JSON" | jq -r '.tenantId // ""')"
  if [[ -z "$SUBSCRIPTION_NAME" || -z "$SUBSCRIPTION_ID" || -z "$TENANT_ID" ]]; then
    fail "Failed to parse az account show output."
  else
    pass "Azure session active: ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID}) tenant=${TENANT_ID}"
  fi
fi

NAME_PREFIX="$(jq -r '.parameters.namePrefix.value' "$PARAMS")"
LOCATION="$(jq -r '.parameters.location.value' "$PARAMS")"
RGPREFIX="${NAME_PREFIX}-rg-${ENV}"
POSTGRES_SKU="$(jq -r '.parameters.postgresSku.value' "$PARAMS")"
POSTGRES_HA="$(jq -r '.parameters.postgresHaMode.value // "Disabled"' "$PARAMS")"
REDIS_SKU="$(jq -r '.parameters.redisSku.value // "Standard"' "$PARAMS")"
APP_PLAN_SKU="$(jq -r '.parameters.appServicePlanSku.value // "B1"' "$PARAMS")"
AI_RUNTIME_ENABLED="$(jq -r '.parameters.aiRuntimeEnabled.value // false' "$PARAMS")"
AI_RUNTIME_PLAN_SKU="$(jq -r '.parameters.aiRuntimePlanSku.value // "P1v3"' "$PARAMS")"
ENABLE_PRIVATE_NETWORK="$(jq -r '.parameters.enablePrivateNetwork.value // false' "$PARAMS")"
ENABLE_AZURE_OPENAI="$(jq -r '.parameters.enableAzureOpenAi.value // false' "$PARAMS")"
AZURE_OPENAI_FAST_MODEL_NAME="$(jq -r '.parameters.azureOpenAiFastClinicalModelName.value // "gpt-4o-mini"' "$PARAMS")"
AZURE_OPENAI_FAST_MODEL_VERSION="$(jq -r '.parameters.azureOpenAiFastClinicalModelVersion.value // "2024-07-18"' "$PARAMS")"
AZURE_OPENAI_FAST_SKU="$(jq -r '.parameters.azureOpenAiFastClinicalDeploymentSku.value // "GlobalStandard"' "$PARAMS")"
AZURE_OPENAI_FAST_CAPACITY="$(jq -r '.parameters.azureOpenAiFastClinicalCapacity.value // 100' "$PARAMS")"
AZURE_OPENAI_BEST_MODEL_NAME="$(jq -r '.parameters.azureOpenAiBestClinicalModelName.value // "gpt-4o"' "$PARAMS")"
AZURE_OPENAI_BEST_MODEL_VERSION="$(jq -r '.parameters.azureOpenAiBestClinicalModelVersion.value // "2024-11-20"' "$PARAMS")"
AZURE_OPENAI_BEST_SKU="$(jq -r '.parameters.azureOpenAiBestClinicalDeploymentSku.value // "GlobalStandard"' "$PARAMS")"
AZURE_OPENAI_BEST_CAPACITY="$(jq -r '.parameters.azureOpenAiBestClinicalCapacity.value // 50' "$PARAMS")"
KV_ADMIN_OBJ_ID="${KEYVAULT_ADMIN_OBJECT_ID:-$(jq -r '.parameters.keyVaultAdminObjectId.value // ""' "$PARAMS")}"
if [[ "${KEYVAULT_ADMIN_OBJECT_ID+x}" != "" ]]; then
  log "Using keyVaultAdminObjectId from KEYVAULT_ADMIN_OBJECT_ID override."
fi

if [[ -z "$NAME_PREFIX" || "$NAME_PREFIX" == "null" ]]; then
  fail "namePrefix missing in parameters."
elif [[ -z "$LOCATION" || "$LOCATION" == "null" ]]; then
  fail "location missing in parameters."
else
  pass "namePrefix=${NAME_PREFIX}, location=${LOCATION}, resourceGroup=${RGPREFIX}"
fi

if [[ "$KV_ADMIN_OBJ_ID" == "null" || -z "$KV_ADMIN_OBJ_ID" || "$KV_ADMIN_OBJ_ID" == "00000000-0000-0000-0000-000000000000" ]]; then
  fail "keyVaultAdminObjectId is missing or placeholder."
else
  if az ad group show --group "$KV_ADMIN_OBJ_ID" >/dev/null 2>&1; then
    pass "keyVaultAdminObjectId resolves as AAD group: $KV_ADMIN_OBJ_ID"
  else
    fail "keyVaultAdminObjectId '$KV_ADMIN_OBJ_ID' not resolvable in this tenant (PrincipalNotFound risk)."
  fi
fi

if [[ "$LOCATION" != "australiaeast" && "$LOCATION" != "australiasoutheast" ]]; then
  fail "location '$LOCATION' violates AU residency policy."
else
  pass "Residency policy location check passed."
fi

SUB_DEPLOYS="$(az deployment sub list --query "[?properties.provisioningState=='Running' || properties.provisioningState=='Accepted' || properties.provisioningState=='Creating']" --output tsv 2>/dev/null || true)"
if [[ -n "$SUB_DEPLOYS" ]]; then
  warn "subscription has in-progress deployments. IDs:"
  echo "$SUB_DEPLOYS" | sed 's/^/  /'
else
  pass "No in-progress subscription deployments detected."
fi

if az group show --name "$RGPREFIX" >/dev/null 2>&1; then
  RG_STATE="$(az group show --name "$RGPREFIX" --query "properties.provisioningState" -o tsv)"
  if [[ "$RG_STATE" == "Deleting" ]]; then
    fail "Resource group $RGPREFIX is Deleting; recreate target or wait for deletion."
  else
    pass "Resource group exists and state=$RG_STATE"
    RG_DEPLOYS="$(az deployment group list --resource-group "$RGPREFIX" --query "[?properties.provisioningState=='Running' || properties.provisioningState=='Accepted' || properties.provisioningState=='Creating']" --output tsv 2>/dev/null || true)"
    if [[ -n "$RG_DEPLOYS" ]]; then
      warn "resource-group deployment(s) in-flight for $RGPREFIX:"
      echo "$RG_DEPLOYS" | sed 's/^/  /'
    else
      pass "No in-progress group deployments for $RGPREFIX."
    fi
  fi
else
  pass "Resource group $RGPREFIX not present; clean create path."
fi

for provider in \
  Microsoft.Web \
  Microsoft.DBforPostgreSQL \
  Microsoft.Cache \
  Microsoft.KeyVault \
  Microsoft.Storage \
  Microsoft.Insights \
  Microsoft.OperationalInsights \
  Microsoft.ContainerRegistry \
  Microsoft.Authorization
do
  REG_STATE="$(az provider show -n "$provider" --query registrationState -o tsv 2>/dev/null || echo "Unknown")"
  if [[ "$REG_STATE" != "Registered" ]]; then
    fail "Provider '$provider' is '$REG_STATE' (must be Registered)."
  else
    pass "Provider '$provider' registered."
  fi
done

PG_SKUS="$(az postgres flexible-server list-skus --location "$LOCATION" --output json | jq -r '.[0].supportedServerEditions[].supportedServerSkus[].name' | sort -u)"
if echo "$PG_SKUS" | grep -Fxq "$POSTGRES_SKU"; then
  pass "PostgreSQL SKU '$POSTGRES_SKU' is valid in $LOCATION."
else
  fail "PostgreSQL SKU '$POSTGRES_SKU' is not valid in $LOCATION. Fix params. "
fi

if [[ "$REDIS_SKU" == "Basic" ]]; then
  fail "Redis SKU 'Basic' is not safe for $ENV (single logical DB). Use Standard."
else
  pass "Redis SKU '$REDIS_SKU' is safe for $ENV."
fi

if [[ "$AI_RUNTIME_ENABLED" == "true" ]]; then
  case "$AI_RUNTIME_PLAN_SKU" in
    P1v3|P2v3|P3v3)
      pass "AI runtime plan SKU '$AI_RUNTIME_PLAN_SKU' meets the dedicated-runtime minimum."
      ;;
    *)
      fail "aiRuntimeEnabled=true requires aiRuntimePlanSku to be one of P1v3/P2v3/P3v3. Current value '$AI_RUNTIME_PLAN_SKU' is under-provisioned for Ollama/Whisper."
      ;;
  esac
fi

if [[ "$ENABLE_AZURE_OPENAI" == "true" && "$ENABLE_PRIVATE_NETWORK" != "true" ]]; then
  fail "enableAzureOpenAi=true requires enablePrivateNetwork=true."
elif [[ "$ENABLE_AZURE_OPENAI" == "true" ]]; then
  pass "Azure OpenAI private lane requested with private-network support."
  MODEL_CATALOG_JSON="$(az cognitiveservices model list --location "$LOCATION" -o json)"
  USAGE_JSON="$(az cognitiveservices usage list --location "$LOCATION" -o json)"

  check_azure_openai_deployment() {
    local model_name="$1"
    local model_version="$2"
    local sku_name="$3"
    local capacity_required="$4"
    local alias_label="$5"

    local usage_name
    usage_name="$(
      jq -r \
        --arg name "$model_name" \
        --arg version "$model_version" \
        --arg sku "$sku_name" \
        '
          [
            .[]
            | select((.model.name // "") == $name and (.model.version // "") == $version)
            | .model.skus[]
            | select((.name // "") == $sku)
            | .usageName
          ][0] // ""
        ' <<<"$MODEL_CATALOG_JSON"
    )"
    if [[ -z "$usage_name" ]]; then
      fail "Azure OpenAI $alias_label deployment (${model_name} ${model_version} / ${sku_name}) is not supported in $LOCATION."
      return
    fi

    local quota_limit quota_current quota_available
    quota_limit="$(
      jq -r --arg usage "$usage_name" '[.[] | select((.name.value // "") == $usage)][0].limit // ""' <<<"$USAGE_JSON"
    )"
    quota_current="$(
      jq -r --arg usage "$usage_name" '[.[] | select((.name.value // "") == $usage)][0].currentValue // ""' <<<"$USAGE_JSON"
    )"
    if [[ -z "$quota_limit" || -z "$quota_current" ]]; then
      fail "Azure OpenAI quota entry missing for $usage_name ($alias_label)."
      return
    fi

    quota_available="$(python3 - <<'PY' "$quota_limit" "$quota_current" "$capacity_required"
import sys
limit = float(sys.argv[1])
current = float(sys.argv[2])
required = float(sys.argv[3])
print(int(limit - current))
if (limit - current) < required:
    raise SystemExit(1)
PY
    )" || {
      fail "Azure OpenAI quota insufficient for $alias_label (${model_name} ${model_version} / ${sku_name}): require $capacity_required, available ${quota_limit}-${quota_current}."
      return
    }

    pass "Azure OpenAI $alias_label deployment supported with quota headroom (${model_name} ${model_version} / ${sku_name}, require $capacity_required, available $quota_available)."
  }

  check_azure_openai_deployment \
    "$AZURE_OPENAI_FAST_MODEL_NAME" \
    "$AZURE_OPENAI_FAST_MODEL_VERSION" \
    "$AZURE_OPENAI_FAST_SKU" \
    "$AZURE_OPENAI_FAST_CAPACITY" \
    "fast_clinical"

  check_azure_openai_deployment \
    "$AZURE_OPENAI_BEST_MODEL_NAME" \
    "$AZURE_OPENAI_BEST_MODEL_VERSION" \
    "$AZURE_OPENAI_BEST_SKU" \
    "$AZURE_OPENAI_BEST_CAPACITY" \
    "best_clinical"
elif [[ "$ENABLE_PRIVATE_NETWORK" == "true" ]]; then
  pass "Private network enabled without Azure OpenAI lane."
fi

if ! az deployment sub validate \
  --location "$LOCATION" \
  --template-file "$SCRIPT_DIR/main.bicep" \
  --parameters @"$PARAMS" \
  --parameters adminPasswordSecret="$(generate_secret 32)" \
  >/tmp/signacare-${ENV}-validate.json 2>/tmp/signacare-${ENV}-validate.err
then
  fail "Deployment validation failed. Inspect /tmp/signacare-${ENV}-validate.err"
  sed 's/^/  /' /tmp/signacare-${ENV}-validate.err
else
  pass "Template validation passed."
fi

if [[ "$ENV" == "prod" && "$POSTGRES_HA" != "ZoneRedundant" ]]; then
  warn "prod is using postgresHaMode='$POSTGRES_HA'. Production target often requires ZoneRedundant."
fi

if [[ "$ENV" == "prod" && "$APP_PLAN_SKU" == "B1" ]]; then
  fail "App Service plan is B1 for prod; expected production-grade tier."
elif [[ "$ENV" == "prod" && ("$APP_PLAN_SKU" == "D1" || "$APP_PLAN_SKU" == "F1") ]]; then
  fail "App Service plan is '$APP_PLAN_SKU' for prod; slot-based deployment requires at least Standard/P1."
fi

if [[ "$POSTGRES_HA" == "ZoneRedundant" && "$LOCATION" == "australiasoutheast" ]]; then
  pass "ZoneRedundant requested in AU South East."
elif [[ "$POSTGRES_HA" == "ZoneRedundant" && "$LOCATION" == "australiaeast" ]]; then
  pass "ZoneRedundant requested in australiaeast."
fi

ACR_NAME="${NAME_PREFIX}cr${ENV}"
if az acr show --name "$ACR_NAME" --query "name" -o tsv >/tmp/signacare-acr-$ENV.txt 2>/tmp/signacare-acr-$ENV.err; then
  pass "ACR exists: $ACR_NAME"
else
  warn "ACR '$ACR_NAME' not found. Infra deploy can still proceed, but deploy pipeline will need image push target ready."
fi

pass "Preflight complete."

if [[ $FAILED -ne 0 ]]; then
  echo ""
  echo "RESULT: BLOCKED"
  exit 1
fi

if grep -q "in-progress" /tmp/signacare-${ENV}-validate.err 2>/dev/null; then
  echo ""
  echo "RESULT: PASS (with warnings)"
else
  echo ""
  echo "RESULT: PASS"
fi
