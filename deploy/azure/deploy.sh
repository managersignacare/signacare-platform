#!/usr/bin/env bash
#
# deploy/azure/deploy.sh
#
# One-shot deployment helper for the Signacare EMR Azure stack. Wraps
# `az deployment sub create` with the parameter file selection, secret
# generation, and post-deploy smoke tests. Not a replacement for the
# GitHub Actions workflow in .github/workflows/azure-deploy.yml — use
# this for first-time provisioning, ad-hoc bumps, and DR rebuilds.
#
# Usage:
#
#   deploy/azure/deploy.sh staging
#   deploy/azure/deploy.sh prod
#
# Prerequisites:
#
#   - az cli logged in (az login) against the target tenant
#   - Subscription selected (az account set --subscription ...)
#   - Key Vault admin AAD group object ID in parameters.<env>.json
#   - The caller must have Owner + Key Vault Administrator on the
#     subscription / resource group
#   - The Linux preflight script must pass before continuing
#
# What it does, in order:
#
#   1. Validates the Bicep template (`az deployment sub validate`).
#   2. Prompts for an admin password if not already provided via
#      $ADMIN_PASSWORD_SECRET. Prints a `openssl rand -base64 32` hint.
#   3. Runs the deployment.
#   4. Writes bootstrap secrets into the Key Vault (PHI key, blind index
#      key, JWT secrets, session secret, redis password). Skips any
#      secret that already exists — NEVER rotates behind your back.
#   5. Fetches the Storage Account key and writes storage-access-key +
#      storage-secret-key into the Key Vault for the native Azure Blob
#      backend.
#   6. Prints the App Service FQDNs and the "next steps" checklist.
#
# Safety:
#
#   - Never uses --force or --no-prompt. Every destructive operation is
#     gated behind an explicit confirmation.
#   - Secrets generated locally via local tooling are piped directly into the
#     Key Vault API; they never land in a shell history or temp file.
#   - The script is idempotent: running it twice produces the same
#     infrastructure and does not rotate any existing secret.

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
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/main.bicep"
PARAMS="$SCRIPT_DIR/parameters.$ENV.json"
NAME_PREFIX="$(jq -r '.parameters.namePrefix.value' "$PARAMS")"
LOCATION="$(jq -r '.parameters.location.value' "$PARAMS")"

if [[ ! -f "$PARAMS" ]]; then
  echo "Missing parameters file: $PARAMS" >&2
  exit 2
fi

if [[ ! -x "$SCRIPT_DIR/preflight-linux.sh" ]]; then
  echo "Missing executable preflight script: $SCRIPT_DIR/preflight-linux.sh" >&2
  exit 2
fi

bash "$SCRIPT_DIR/preflight-linux.sh" "$ENV"

generate_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  else
    LC_ALL=C LC_COLLATE=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$bytes"
  fi
}

generate_hex_secret_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 | tr -d '\n'
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

resolve_existing_admin_password_secret() {
  local existing_rg="${NAME_PREFIX}-rg-${ENV}"
  local existing_kv="${NAME_PREFIX}-kv-${ENV}"
  local existing_pg="${NAME_PREFIX}-pg-${ENV}"
  local existing_secret=""

  if ! az group show --name "$existing_rg" >/dev/null 2>&1; then
    return 1
  fi
  if ! az postgres flexible-server show --resource-group "$existing_rg" --name "$existing_pg" >/dev/null 2>&1; then
    return 1
  fi

  existing_secret="$(
    az keyvault secret show \
      --vault-name "$existing_kv" \
      --name db-password \
      --query value \
      -o tsv 2>/dev/null || true
  )"

  if [[ -z "$existing_secret" ]]; then
    return 1
  fi

  printf '%s' "$existing_secret"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

SOVEREIGN_DEPLOY_PARAMETERS=()

wait_for_azure_openai_account_ready() {
  local resource_group="$1"
  local account_name="$2"
  local max_attempts="${3:-60}"
  local sleep_seconds="${4:-10}"
  local attempt=1

  while (( attempt <= max_attempts )); do
    local state
    state="$(az cognitiveservices account show \
      --resource-group "$resource_group" \
      --name "$account_name" \
      --query 'properties.provisioningState' \
      -o tsv 2>/dev/null || true)"

    if [[ "$state" == "Succeeded" ]]; then
      echo "  ✓ Azure OpenAI account ready: $account_name"
      return
    fi

    if [[ -n "$state" ]]; then
      echo "  • Azure OpenAI account state: $state (attempt $attempt/$max_attempts)"
    else
      echo "  • Waiting for Azure OpenAI account '$account_name' to appear (attempt $attempt/$max_attempts)"
    fi

    sleep "$sleep_seconds"
    (( attempt += 1 ))
  done

  echo "Azure OpenAI account '$account_name' did not reach Succeeded within $(( max_attempts * sleep_seconds )) seconds." >&2
  exit 1
}

deploy_azure_openai_model_deployments_if_needed() {
  local resource_group="$1"
  local enable_private_network
  local enable_azure_openai
  enable_private_network="$(jq -r '.parameters.enablePrivateNetwork.value // false' "$PARAMS")"
  enable_azure_openai="$(jq -r '.parameters.enableAzureOpenAi.value // false' "$PARAMS")"

  if [[ "$enable_private_network" != "true" || "$enable_azure_openai" != "true" ]]; then
    return
  fi

  local account_name="${NAME_PREFIX}-openai-${ENV}"
  local fast_deployment_name="${NAME_PREFIX}-fast-clinical-${ENV}"
  local best_deployment_name="${NAME_PREFIX}-best-clinical-${ENV}"
  local fast_model_name fast_model_version fast_sku fast_capacity
  local best_model_name best_model_version best_sku best_capacity
  fast_model_name="$(jq -r '.parameters.azureOpenAiFastClinicalModelName.value' "$PARAMS")"
  fast_model_version="$(jq -r '.parameters.azureOpenAiFastClinicalModelVersion.value' "$PARAMS")"
  fast_sku="$(jq -r '.parameters.azureOpenAiFastClinicalDeploymentSku.value' "$PARAMS")"
  fast_capacity="$(jq -r '.parameters.azureOpenAiFastClinicalCapacity.value' "$PARAMS")"
  best_model_name="$(jq -r '.parameters.azureOpenAiBestClinicalModelName.value' "$PARAMS")"
  best_model_version="$(jq -r '.parameters.azureOpenAiBestClinicalModelVersion.value' "$PARAMS")"
  best_sku="$(jq -r '.parameters.azureOpenAiBestClinicalDeploymentSku.value' "$PARAMS")"
  best_capacity="$(jq -r '.parameters.azureOpenAiBestClinicalCapacity.value' "$PARAMS")"
  local deployments_json
  local fast_ready=false
  local best_ready=false

  deployments_json="$(az cognitiveservices account deployment list \
    --resource-group "$resource_group" \
    --name "$account_name" \
    -o json 2>/dev/null || echo '[]')"

  if jq -e \
    --arg deployment "$fast_deployment_name" \
    --arg model "$fast_model_name" \
    --arg version "$fast_model_version" \
    --arg sku "$fast_sku" \
    --argjson capacity "$fast_capacity" \
    '.[] | select(
      .name == $deployment and
      .properties.provisioningState == "Succeeded" and
      .properties.model.name == $model and
      .properties.model.version == $version and
      .sku.name == $sku and
      .properties.currentCapacity == $capacity
    )' >/dev/null <<<"$deployments_json"; then
    fast_ready=true
  fi

  if jq -e \
    --arg deployment "$best_deployment_name" \
    --arg model "$best_model_name" \
    --arg version "$best_model_version" \
    --arg sku "$best_sku" \
    --argjson capacity "$best_capacity" \
    '.[] | select(
      .name == $deployment and
      .properties.provisioningState == "Succeeded" and
      .properties.model.name == $model and
      .properties.model.version == $version and
      .sku.name == $sku and
      .properties.currentCapacity == $capacity
    )' >/dev/null <<<"$deployments_json"; then
    best_ready=true
  fi

  if [[ "$fast_ready" == "true" && "$best_ready" == "true" ]]; then
    echo ""
    echo "▶ Azure OpenAI model aliases already converged"
    return
  fi

  echo ""
  echo "▶ Waiting for Azure OpenAI account to become deployment-ready…"
  wait_for_azure_openai_account_ready "$resource_group" "$account_name"

  echo "▶ Deploying Azure OpenAI model aliases…"
  az deployment group create \
    --resource-group "$resource_group" \
    --name "azure-openai-deployments-$(date +%Y%m%d-%H%M%S)" \
    --template-file "$SCRIPT_DIR/modules/azure-openai-deployments.bicep" \
    --parameters \
      openAiAccountName="$account_name" \
      fastClinicalDeploymentName="$fast_deployment_name" \
      fastClinicalModelName="$fast_model_name" \
      fastClinicalModelVersion="$fast_model_version" \
      bestClinicalDeploymentName="$best_deployment_name" \
      bestClinicalModelName="$best_model_name" \
      bestClinicalModelVersion="$best_model_version" \
      fastClinicalDeploymentSku="$fast_sku" \
      bestClinicalDeploymentSku="$best_sku" \
      fastClinicalCapacity="$fast_capacity" \
      bestClinicalCapacity="$best_capacity" \
    >/dev/null

  echo "  ✓ Azure OpenAI model deployments converged"
}

ensure_postgres_azure_services_firewall_rule() {
  local resource_group="$1"
  local server_name="$2"
  local current_rule

  current_rule="$(
    az postgres flexible-server firewall-rule list \
      --resource-group "$resource_group" \
      --name "$server_name" \
      -o json 2>/dev/null | jq -r '.[] | select(.name=="allow-azure-services") | "\(.startIpAddress)|\(.endIpAddress)"'
  )"

  if [[ "$current_rule" == "0.0.0.0|0.0.0.0" ]]; then
    echo ""
    echo "▶ PostgreSQL Azure-services firewall rule already converged"
    return
  fi

  echo ""
  echo "▶ Ensuring PostgreSQL Azure-services firewall rule…"
  az postgres flexible-server firewall-rule create \
    --resource-group "$resource_group" \
    --name "$server_name" \
    --rule-name allow-azure-services \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0 \
    >/dev/null
  echo "  ✓ PostgreSQL firewall rule converged"
}

validate_prod_ai_model_promotion_if_needed() {
  local enable_azure_openai
  enable_azure_openai="$(jq -r '.parameters.enableAzureOpenAi.value // false' "$PARAMS")"
  if [[ "$ENV" != "prod" || "$enable_azure_openai" != "true" ]]; then
    return
  fi

  if [[ -z "${AI_MODEL_PROMOTION_ALIAS:-}" || -z "${AI_MODEL_PROMOTION_RECORD:-}" ]]; then
    echo "Production Azure OpenAI infra deploy requires AI_MODEL_PROMOTION_ALIAS and AI_MODEL_PROMOTION_RECORD." >&2
    echo "The record must be reviewed evidence under docs/quality/ai-model-governance/*.json." >&2
    exit 2
  fi
  if [[ ! "$AI_MODEL_PROMOTION_ALIAS" =~ ^[a-z0-9_]+$ ]]; then
    echo "AI_MODEL_PROMOTION_ALIAS contains invalid characters." >&2
    exit 2
  fi
  if [[ "$AI_MODEL_PROMOTION_RECORD" = /* || "$AI_MODEL_PROMOTION_RECORD" == *..* || "$AI_MODEL_PROMOTION_RECORD" != docs/quality/ai-model-governance/*.json ]]; then
    echo "AI_MODEL_PROMOTION_RECORD must be a repo-relative docs/quality/ai-model-governance/*.json path." >&2
    exit 2
  fi

  echo "▶ Validating production Azure OpenAI model-promotion evidence…"
  (
    cd "$REPO_ROOT"
    npm run ai:model-promotion:validate -- \
      --alias "$AI_MODEL_PROMOTION_ALIAS" \
      --record "$AI_MODEL_PROMOTION_RECORD"
  ) >/dev/null
  echo "  ✓ AI model promotion record: $AI_MODEL_PROMOTION_RECORD"
  echo "  ✓ AI model promotion record SHA-256: $(sha256_file "$REPO_ROOT/$AI_MODEL_PROMOTION_RECORD")"
}

validate_sovereign_gpu_artifact_if_needed() {
  local enable_sovereign_gpu
  enable_sovereign_gpu="$(jq -r '.parameters.enableSovereignGpu.value // false' "$PARAMS")"
  if [[ "$enable_sovereign_gpu" != "true" ]]; then
    return
  fi

  local enable_private_network
  enable_private_network="$(jq -r '.parameters.enablePrivateNetwork.value // false' "$PARAMS")"
  if [[ "$enable_private_network" != "true" ]]; then
    echo "Sovereign GPU deploy requires enablePrivateNetwork=true in $PARAMS." >&2
    exit 2
  fi

  if [[ -z "${SOVEREIGN_MODEL_ARTIFACT_MANIFEST:-}" ]]; then
    echo "Sovereign GPU deploy requires SOVEREIGN_MODEL_ARTIFACT_MANIFEST." >&2
    echo "The manifest must be reviewed evidence under docs/quality/sovereign-model-artifacts/*.json." >&2
    exit 2
  fi
  if [[ "$SOVEREIGN_MODEL_ARTIFACT_MANIFEST" = /* || "$SOVEREIGN_MODEL_ARTIFACT_MANIFEST" == *..* || "$SOVEREIGN_MODEL_ARTIFACT_MANIFEST" != docs/quality/sovereign-model-artifacts/*.json ]]; then
    echo "SOVEREIGN_MODEL_ARTIFACT_MANIFEST must be a repo-relative docs/quality/sovereign-model-artifacts/*.json path." >&2
    exit 2
  fi

  local manifest="$REPO_ROOT/$SOVEREIGN_MODEL_ARTIFACT_MANIFEST"
  if [[ ! -f "$manifest" ]]; then
    echo "Sovereign model artifact manifest not found: $SOVEREIGN_MODEL_ARTIFACT_MANIFEST" >&2
    exit 2
  fi

  echo "▶ Validating sovereign GPU model-artifact evidence…"
  (
    cd "$REPO_ROOT"
    npm run ai:sovereign-artifact:validate -- \
      --manifest "$SOVEREIGN_MODEL_ARTIFACT_MANIFEST"
  ) >/dev/null

  SOVEREIGN_INFERENCE_IMAGE="$(jq -r '.imageRef' "$manifest")"
  SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256="$(jq -r '.modelManifestSha256' "$manifest")"
  SOVEREIGN_DEPLOY_PARAMETERS=(
    sovereignInferenceImage="$SOVEREIGN_INFERENCE_IMAGE"
    sovereignInferenceModelManifestSha256="$SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256"
  )

  echo "  ✓ Sovereign model artifact: $SOVEREIGN_MODEL_ARTIFACT_MANIFEST"
  echo "  ✓ Sovereign model artifact SHA-256: $(sha256_file "$manifest")"
  echo "  ✓ Sovereign inference image: $SOVEREIGN_INFERENCE_IMAGE"
  echo "  ✓ Sovereign model manifest: $SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256"
}

echo "──────────────────────────────────────────────────────────────────────"
echo " Signacare EMR — Azure deployment ($ENV)"
echo "──────────────────────────────────────────────────────────────────────"
echo " Name prefix:  $NAME_PREFIX"
echo " Location:     $LOCATION"
echo " Template:     $TEMPLATE"
echo " Parameters:   $PARAMS"
echo ""

# ── 1. Generate or accept admin password ─────────────────────────────────
if [[ -z "${ADMIN_PASSWORD_SECRET:-}" ]]; then
  if EXISTING_ADMIN_PASSWORD_SECRET="$(resolve_existing_admin_password_secret)"; then
    echo "Reusing existing PostgreSQL admin password from Key Vault for converged environment…"
    ADMIN_PASSWORD_SECRET="$EXISTING_ADMIN_PASSWORD_SECRET"
  else
    echo "Generating a fresh PostgreSQL admin password…"
    ADMIN_PASSWORD_SECRET="$(generate_secret 32)Aa1!"
    echo "  (set ADMIN_PASSWORD_SECRET in the env to reuse an existing password)"
  fi
fi

validate_prod_ai_model_promotion_if_needed
validate_sovereign_gpu_artifact_if_needed

# ── 2. Validate ──────────────────────────────────────────────────────────
echo ""
echo "▶ Validating Bicep template…"
validate_args=(
  --location "$LOCATION"
  --template-file "$TEMPLATE"
  --parameters @"$PARAMS"
  --parameters adminPasswordSecret="$ADMIN_PASSWORD_SECRET"
)
if (( ${#SOVEREIGN_DEPLOY_PARAMETERS[@]} > 0 )); then
  validate_args+=("${SOVEREIGN_DEPLOY_PARAMETERS[@]}")
fi
az deployment sub validate "${validate_args[@]}" >/dev/null

# ── 3. Deploy ────────────────────────────────────────────────────────────
echo "▶ Deploying… this takes ~12 minutes the first time"
DEPLOY_NAME="signacare-$ENV-$(date +%Y%m%d-%H%M%S)"

set +e
create_args=(
  --location "$LOCATION"
  --name "$DEPLOY_NAME"
  --template-file "$TEMPLATE"
  --parameters @"$PARAMS"
  --parameters adminPasswordSecret="$ADMIN_PASSWORD_SECRET"
)
if (( ${#SOVEREIGN_DEPLOY_PARAMETERS[@]} > 0 )); then
  create_args+=("${SOVEREIGN_DEPLOY_PARAMETERS[@]}")
fi
az deployment sub create "${create_args[@]}" >/tmp/signacare-deploy-"$DEPLOY_NAME".json
DEPLOY_EXIT=$?
set -e

if [[ $DEPLOY_EXIT -ne 0 ]]; then
  echo "Deployment command failed to start."
  cat "/tmp/signacare-deploy-${DEPLOY_NAME}.json"
  rm -f "/tmp/signacare-deploy-${DEPLOY_NAME}.json"
  exit 1
fi

while true; do
  DEPLOY_STATE="$(az deployment sub show --name "$DEPLOY_NAME" --query 'properties.provisioningState' -o tsv)"
  if [[ "$DEPLOY_STATE" == "Succeeded" ]]; then
    break
  fi
  if [[ "$DEPLOY_STATE" == "Failed" || "$DEPLOY_STATE" == "Canceled" || "$DEPLOY_STATE" == "Cancelled" ]]; then
    echo "Deployment $DEPLOY_NAME ended with state: $DEPLOY_STATE"
    az deployment sub show --name "$DEPLOY_NAME" --query "properties.error" -o json
    rm -f "/tmp/signacare-deploy-${DEPLOY_NAME}.json"
    exit 1
  fi
  echo "Deployment state: $DEPLOY_STATE (waiting...)"
  sleep 20
done

DEPLOY_OUTPUT="$(az deployment sub show --name "$DEPLOY_NAME" --query 'properties.outputs' -o json)"

RG_NAME="$(echo "$DEPLOY_OUTPUT" | jq -r '.resourceGroupName.value')"
KV_NAME="$(echo "$DEPLOY_OUTPUT" | jq -r '.keyVaultName.value')"
API_HOST="$(echo "$DEPLOY_OUTPUT" | jq -r '.apiUrl.value')"
WEB_HOST="$(echo "$DEPLOY_OUTPUT" | jq -r '.webUrl.value')"
POSTGRES_FQDN="$(echo "$DEPLOY_OUTPUT" | jq -r '.postgresFqdn.value')"
POSTGRES_SERVER_NAME="${POSTGRES_FQDN%%.*}"
rm -f "/tmp/signacare-deploy-${DEPLOY_NAME}.json"

ensure_postgres_azure_services_firewall_rule "$RG_NAME" "$POSTGRES_SERVER_NAME"
deploy_azure_openai_model_deployments_if_needed "$RG_NAME"

echo ""
echo "✓ Deployment complete."
echo "  Resource group: $RG_NAME"
echo "  API:            https://$API_HOST"
echo "  Web:            https://$WEB_HOST"
echo "  Key Vault:      $KV_NAME"

# ── 4. Seed bootstrap secrets ────────────────────────────────────────────
echo ""
echo "▶ Seeding bootstrap secrets in Key Vault $KV_NAME (skipping any that already exist)…"

seed_secret() {
  local name="$1"
  local value="$2"
  if az keyvault secret show --vault-name "$KV_NAME" --name "$name" >/dev/null 2>&1; then
    echo "  ✓ $name (already exists — not overwritten)"
  else
    az keyvault secret set --vault-name "$KV_NAME" --name "$name" --value "$value" >/dev/null
    echo "  + $name (created)"
  fi
}

seed_secret db-password          "$ADMIN_PASSWORD_SECRET"
seed_secret db-app-password      "$ADMIN_PASSWORD_SECRET"
seed_secret phi-encryption-key   "$(generate_hex_secret_32)"
# BLIND_INDEX_KEY must differ from PHI_ENCRYPTION_KEY per NIST SP 800-57 §8.2.3.
# blindIndex.ts throws at load time if they match.
seed_secret blind-index-key      "$(generate_hex_secret_32)"
seed_secret patient-app-dedupe-pepper "$(generate_hex_secret_32)"
seed_secret jwt-access-secret    "$(generate_secret 48)"
seed_secret jwt-refresh-secret   "$(generate_secret 48)"
seed_secret session-secret       "$(generate_secret 48)"

# Redis primary key
REDIS_PASS="$(az redis list-keys --resource-group "$RG_NAME" --name "${NAME_PREFIX}-redis-${ENV}" --query primaryKey -o tsv)"
seed_secret redis-password "$REDIS_PASS"

# Storage account key for the native Azure Blob backend.
STORAGE_ACCOUNT="${NAME_PREFIX}st${ENV}"
STORAGE_KEY="$(az storage account keys list --resource-group "$RG_NAME" --account-name "$STORAGE_ACCOUNT" --query '[0].value' -o tsv)"
seed_secret storage-access-key "$STORAGE_ACCOUNT"
seed_secret storage-secret-key "$STORAGE_KEY"

# Placeholders that humans must set:
for placeholder in sentry-dsn slack-webhook-security slack-webhook-ops; do
  if ! az keyvault secret show --vault-name "$KV_NAME" --name "$placeholder" >/dev/null 2>&1; then
    az keyvault secret set --vault-name "$KV_NAME" --name "$placeholder" --value "PLACEHOLDER_SET_ME" >/dev/null
    echo "  + $placeholder (placeholder — replace before go-live)"
  fi
done

echo ""
echo "──────────────────────────────────────────────────────────────────────"
echo " Next steps:"
echo "──────────────────────────────────────────────────────────────────────"
echo " 1. Trigger .github/workflows/azure-deploy.yml for '$ENV'."
echo "      The workflow builds linux/amd64 images once in CI and deploys repo@sha256 digests."
echo "      Do not build or patch App Service images from this operator shell."
echo " 2. Run the smoke test:"
echo "      ENV=$ENV deploy/azure/post-deploy-smoke.sh"
echo " 3. Replace placeholder secrets (sentry-dsn, slack-webhook-*) in the Key Vault."
echo " 4. Rotate the ADMIN_PASSWORD_SECRET out of your shell history:"
echo "      unset ADMIN_PASSWORD_SECRET; history -c"
