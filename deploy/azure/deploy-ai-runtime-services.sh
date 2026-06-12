#!/usr/bin/env bash
#
# Deploy digest-pinned Ollama and Whisper images to dedicated Linux App
# Services, wire the API to those services, and restrict AI service ingress to
# API App Service outbound IPs. This is the active staging AI runtime path.
#
# Production requires an explicit approval flag because CPU App Service is not
# the gold-standard production target for 60-minute psychiatric workflows; use
# private networking plus GPU-capable Container Apps/AKS/managed model endpoint.

set -euo pipefail

ENVIRONMENT="${1:-staging}"
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "prod" ]]; then
  echo "Usage: $0 staging|prod" >&2
  exit 2
fi

if [[ "$ENVIRONMENT" == "prod" && "${AI_RUNTIME_PROD_APPROVED:-false}" != "true" ]]; then
  echo "Production AI runtime deployment requires AI_RUNTIME_PROD_APPROVED=true and reviewed private/GPU topology evidence." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARAMS="$SCRIPT_DIR/parameters.$ENVIRONMENT.json"

if [[ ! -f "$PARAMS" ]]; then
  echo "Missing parameter file: $PARAMS" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 2
  fi
}

require_cmd az
require_cmd jq

require_digest_ref() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" || "$value" != *@sha256:* ]]; then
    echo "$name must be an immutable image digest ref (repo@sha256:...), got: ${value:-<empty>}" >&2
    exit 2
  fi
}

NAME_PREFIX="$(jq -r '.parameters.namePrefix.value' "$PARAMS")"
RESOURCE_GROUP="${NAME_PREFIX}-rg-${ENVIRONMENT}"
ACR_NAME="${NAME_PREFIX}cr${ENVIRONMENT}"
API_APP_NAME="${NAME_PREFIX}-api-${ENVIRONMENT}"
OLLAMA_APP_NAME="${NAME_PREFIX}-ollama-${ENVIRONMENT}"
WHISPER_APP_NAME="${NAME_PREFIX}-whisper-${ENVIRONMENT}"
OLLAMA_HOST="${OLLAMA_APP_NAME}.azurewebsites.net"
WHISPER_HOST="${WHISPER_APP_NAME}.azurewebsites.net"
ACR_SCOPE="$(az acr show --name "$ACR_NAME" --query id -o tsv)"

OLLAMA_IMAGE="${AI_OLLAMA_IMAGE:-}"
WHISPER_IMAGE="${AI_WHISPER_IMAGE:-}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:signacare-35f39aa1}"
OLLAMA_MODEL_MANIFEST_SHA256="${OLLAMA_MODEL_MANIFEST_SHA256:-sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58}"
OLLAMA_MODEL_VERSION="${OLLAMA_MODEL_VERSION:-${OLLAMA_MODEL}@${OLLAMA_MODEL_MANIFEST_SHA256}}"
WHISPER_MODEL="${WHISPER_MODEL:-small}"
WHISPER_MODEL_SHA256="${WHISPER_MODEL_SHA256:-9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794}"

require_digest_ref AI_OLLAMA_IMAGE "$OLLAMA_IMAGE"
require_digest_ref AI_WHISPER_IMAGE "$WHISPER_IMAGE"

echo "──────────────────────────────────────────────────────────────────────"
echo " Signacare Azure AI runtime services ($ENVIRONMENT)"
echo "──────────────────────────────────────────────────────────────────────"
echo " Resource group: $RESOURCE_GROUP"
echo " API app:        $API_APP_NAME"
echo " Ollama app:     $OLLAMA_APP_NAME"
echo " Whisper app:    $WHISPER_APP_NAME"
echo " Ollama image:   $OLLAMA_IMAGE"
echo " Whisper image:  $WHISPER_IMAGE"
echo ""

for app in "$API_APP_NAME" "$OLLAMA_APP_NAME" "$WHISPER_APP_NAME"; do
  if ! az webapp show --resource-group "$RESOURCE_GROUP" --name "$app" >/dev/null; then
    echo "Required App Service '$app' not found. Run deploy/azure/deploy.sh $ENVIRONMENT after enabling aiRuntimeEnabled." >&2
    exit 2
  fi
done

ensure_acr_pull_role() {
  local app="$1"
  local principal_id
  principal_id="$(az webapp show --resource-group "$RESOURCE_GROUP" --name "$app" --query 'identity.principalId' -o tsv)"
  if [[ -z "$principal_id" || "$principal_id" == "null" ]]; then
    echo "Unable to resolve system-assigned principal for '$app'." >&2
    exit 1
  fi

  local existing_count
  existing_count="$(az role assignment list \
    --scope "$ACR_SCOPE" \
    --query "[?principalId=='${principal_id}' && roleDefinitionName=='AcrPull'] | length(@)" \
    -o tsv)"
  if [[ "$existing_count" == "0" ]]; then
    az role assignment create \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal \
      --role AcrPull \
      --scope "$ACR_SCOPE" \
      >/dev/null
  fi
}

ensure_acr_pull_role "$OLLAMA_APP_NAME"
ensure_acr_pull_role "$WHISPER_APP_NAME"

echo "Deploying Ollama image by digest..."
az webapp config container set \
  --name "$OLLAMA_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --docker-custom-image-name "$OLLAMA_IMAGE" \
  --docker-registry-server-url "https://${ACR_NAME}.azurecr.io" \
  >/dev/null

az webapp config appsettings set \
  --name "$OLLAMA_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBSITES_PORT=11434 \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MODELS=/opt/signacare/ollama/models \
    OLLAMA_REQUIRE_MODELS="$OLLAMA_MODEL" \
    OLLAMA_KEEP_ALIVE=-1 \
    OLLAMA_MODEL="$OLLAMA_MODEL" \
    OLLAMA_MODEL_VERSION="$OLLAMA_MODEL_VERSION" \
    OLLAMA_MODEL_MANIFEST_SHA256="$OLLAMA_MODEL_MANIFEST_SHA256" \
  >/dev/null

echo "Deploying Whisper image by digest..."
az webapp config container set \
  --name "$WHISPER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --docker-custom-image-name "$WHISPER_IMAGE" \
  --docker-registry-server-url "https://${ACR_NAME}.azurecr.io" \
  >/dev/null

az webapp config appsettings set \
  --name "$WHISPER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBSITES_PORT=8080 \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    PORT=8080 \
    WHISPER_HOST=0.0.0.0 \
    WHISPER_DEVICE=cpu \
    WHISPER_MODEL="$WHISPER_MODEL" \
    WHISPER_MODEL_SHA256="$WHISPER_MODEL_SHA256" \
    WHISPER_PRELOAD_MODEL=true \
    WHISPER_WORKERS=1 \
    WHISPER_THREADS=2 \
    WHISPER_TIMEOUT_SECONDS=900 \
    WHISPER_CACHE_DIR=/opt/signacare/whisper/cache \
  >/dev/null

echo "Restricting AI runtime ingress to API App Service outbound IPs..."
api_ips="$(az webapp show --resource-group "$RESOURCE_GROUP" --name "$API_APP_NAME" --query 'possibleOutboundIpAddresses' -o tsv)"
if [[ -z "$api_ips" ]]; then
  api_ips="$(az webapp show --resource-group "$RESOURCE_GROUP" --name "$API_APP_NAME" --query 'outboundIpAddresses' -o tsv)"
fi
api_subnet_id="$(az webapp show --resource-group "$RESOURCE_GROUP" --name "$API_APP_NAME" --query 'virtualNetworkSubnetId' -o tsv)"
if [[ -z "$api_ips" ]]; then
  echo "Unable to determine API outbound IPs for AI access restrictions." >&2
  exit 1
fi

apply_access_restrictions() {
  local app="$1"
  local priority=100

  stale_rules=()
  while IFS= read -r rule; do
    stale_rules+=("$rule")
  done < <(
    az webapp config access-restriction show \
      --resource-group "$RESOURCE_GROUP" \
      --name "$app" \
      --query "ipSecurityRestrictions[?starts_with(name, 'allow-api-outbound-') || name=='allow-api-subnet'].name" \
      -o tsv
  )
  for rule in "${stale_rules[@]}"; do
    [[ -z "$rule" ]] && continue
    az webapp config access-restriction remove \
      --resource-group "$RESOURCE_GROUP" \
      --name "$app" \
      --rule-name "$rule" \
      >/dev/null || true
  done

  if [[ -n "$api_subnet_id" && "$api_subnet_id" != "null" ]]; then
    az webapp config access-restriction add \
      --resource-group "$RESOURCE_GROUP" \
      --name "$app" \
      --rule-name "allow-api-subnet" \
      --action Allow \
      --priority 90 \
      --subnet "$api_subnet_id" \
      --ignore-missing-endpoint true \
      >/dev/null
  fi

  IFS=',' read -ra ips <<< "$api_ips"
  for ip in "${ips[@]}"; do
    ip="$(echo "$ip" | xargs)"
    [[ -z "$ip" ]] && continue
    az webapp config access-restriction add \
      --resource-group "$RESOURCE_GROUP" \
      --name "$app" \
      --rule-name "allow-api-outbound-${priority}" \
      --action Allow \
      --ip-address "${ip}/32" \
      --priority "$priority" \
      >/dev/null
    priority=$((priority + 1))
  done
  az webapp config access-restriction set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$app" \
    --default-action Deny \
    --scm-default-action Deny \
    --use-same-restrictions-for-scm-site true \
    >/dev/null
}

apply_access_restrictions "$OLLAMA_APP_NAME"
apply_access_restrictions "$WHISPER_APP_NAME"

echo "Wiring API to dedicated AI runtime services..."
az webapp config appsettings set \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    OLLAMA_URL="https://${OLLAMA_HOST}" \
    OLLAMA_BASE_URL="https://${OLLAMA_HOST}" \
    OLLAMA_MODEL="$OLLAMA_MODEL" \
    OLLAMA_MODEL_VERSION="$OLLAMA_MODEL_VERSION" \
    OLLAMA_MODEL_MANIFEST_SHA256="$OLLAMA_MODEL_MANIFEST_SHA256" \
    WHISPER_API_URL="https://${WHISPER_HOST}" \
    WHISPER_MODEL="$WHISPER_MODEL" \
    WHISPER_DISABLED=false \
    AI_EXTERNAL_HOSTS="${OLLAMA_HOST},${WHISPER_HOST}" \
    LLM_MAX_CONCURRENT=1 \
    WHISPER_MAX_CONCURRENT=1 \
    SIGNACARE_OLLAMA_MODEL="$OLLAMA_MODEL" \
    SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256="$OLLAMA_MODEL_MANIFEST_SHA256" \
    SIGNACARE_WHISPER_MODEL="$WHISPER_MODEL" \
    SIGNACARE_WHISPER_MODEL_SHA256="$WHISPER_MODEL_SHA256" \
  >/dev/null

az webapp restart --name "$OLLAMA_APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null
az webapp restart --name "$WHISPER_APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null
az webapp restart --name "$API_APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null

echo "AI runtime services deployed by digest and API wiring updated."
