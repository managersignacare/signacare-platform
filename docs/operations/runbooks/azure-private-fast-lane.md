# Runbook — Azure Private Fast Lane (Phase 4)

**Lane:** `azure_fast`
**Backend:** Azure OpenAI (Cognitive Services account, kind `OpenAI`)
**Provisioned by:** `deploy/azure/modules/azure-openai.bicep`
**Pre-requisites:** Private VNet + Private DNS zones from `deploy/azure/modules/network-private.bicep`.

## 1 — Provision

```bash
# Pre-flight: confirm the Azure subscription, location, and named region.
az account show --query '[name,id]' -o tsv
az group show --name "<prefix>-rg-staging" --query name -o tsv

# Deploy the stack with the private fast lane enabled.
az deployment sub create \
  --location australiaeast \
  --template-file deploy/azure/main.bicep \
  --parameters @deploy/azure/parameters.staging.json \
  --parameters \
    enablePrivateNetwork=true \
    enableAzureOpenAi=true \
    azureOpenAiFastClinicalModelVersion='2024-07-18' \
    azureOpenAiBestClinicalModelVersion='2024-11-20' \
    adminPasswordSecret="$(openssl rand -base64 32)"
```

Outputs to capture:

| Output | Used for |
|---|---|
| `azureOpenAiEndpoint` | runtime reference (NOT secret) |
| `azureOpenAiFastClinicalDeployment` | clinic AI runtime settings, smoke probe |
| `azureOpenAiBestClinicalDeployment` | clinic AI runtime settings, smoke probe |
| `azureOpenAiEndpointKvRef` | Key Vault reference automatically wired into App Service appsetting `AZURE_OPENAI_ENDPOINT` |

The App Service module sets `AZURE_OPENAI_AUTH_MODE=managed_identity` and
`AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED=true` plus deployment/version app
settings when `enableAzureOpenAi=true`. It also wires the API app + slot into
the delegated `app` subnet with `vnetRouteAllEnabled=true` so privatelink DNS
for `*.openai.azure.com` resolves over the VNet instead of public internet
egress. Do not paste an API key into app settings for the private lane;
`disableLocalAuth=true` means the API must acquire an Entra token using the API
site or slot managed identity. There is no `azureOpenAiApiKeyKvRef` output in
the active private-lane template.

## 2 — Verify private posture

```bash
# Account MUST report publicNetworkAccess=Disabled.
az cognitiveservices account show \
  --resource-group "<prefix>-rg-staging" \
  --name "<prefix>-openai-staging" \
  --query 'properties.publicNetworkAccess' -o tsv
# Expect: Disabled

# Private endpoint MUST exist + be in 'Succeeded' state.
az network private-endpoint show \
  --resource-group "<prefix>-rg-staging" \
  --name "<prefix>-openai-staging-pe" \
  --query 'provisioningState' -o tsv
# Expect: Succeeded

# Versioned model deployments MUST NOT auto-upgrade.
az cognitiveservices account deployment show \
  --resource-group "<prefix>-rg-staging" \
  --name "<prefix>-openai-staging" \
  --deployment-name "<prefix>-fast-clinical-staging" \
  --query '{model:properties.model,versionUpgradeOption:properties.versionUpgradeOption}'
# Expect: { "model": { "format": "OpenAI", "name": "gpt-4o-mini", "version": "2024-07-18" }, "versionUpgradeOption": "NoAutoUpgrade" }
```

## 3 — Promote lane for a clinic

```sql
-- Lane selection is per clinic. Flip the clinic's AI runtime backend.
-- The clinic UI surfaces this as "Azure (fast)" once enabled.
UPDATE staff_settings
SET setting_value = jsonb_set(setting_value, '{llmBackend}', '"azure_openai"', true)
WHERE setting_key = 'ai_runtime'
  AND staff_id IN (SELECT id FROM staff WHERE clinic_id = '<clinic_id>');
```

## 4 — Staging smoke

```bash
API_URL="https://$(az webapp show -g <prefix>-rg-staging -n <prefix>-api-staging --query defaultHostName -o tsv)"
TOKEN="$(./scripts/staging-smoke/login-as-admin.sh)"

curl -sf "$API_URL/health"

# /api/v1/ai/capabilities MUST report activeLane=azure_fast,
# deploymentRef contains the pinned model version, and
# privateNetworkEnforced + managedIdentityEnforced are true.
curl -sf -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v1/ai/capabilities" | jq '
    .activeLane.lane,
    .activeLane.deploymentRef,
    .activeLane.modelVersion,
    .activeLane.privateNetworkEnforced,
    .activeLane.managedIdentityEnforced,
    .activeLane.cachedTokensTelemetryEnabled,
    (.promptPrefixHashSample | length)
  '
# Expect:
#   "azure_fast"
#   "<prefix>-fast-clinical-staging@2024-07-18"
#   "2024-07-18"
#   true
#   true
#   true
#   64
```

## 5 — Failover (see `ai-lane-failover.md`)

If the Azure lane is unhealthy, the operator flips the clinic AI
runtime backend to `local_ollama` (or `sovereign_gpu` if Phase 5 is
provisioned). The model router routes new requests through the
selected lane without restarting the API service.

## 6 — Decommission

```bash
# Re-deploy with enableAzureOpenAi=false. The Cognitive Services
# account, deployments, and private endpoint are torn down; Key Vault
# secrets are kept (rotation hygiene) but the secret values become
# stale references. Wipe them manually if the lane will not return.
az deployment sub create --parameters enableAzureOpenAi=false ...
```

## 7 — Audit metadata visible to clinicians

Every clinical-AI completion that flows through the Azure lane carries
`activeLane.backend = "azure_openai"` + the pinned model version on the
`llm_interactions` row. Clinicians see this in the per-note "AI generated
by" disclosure surfaced by the existing scribe parity contract; the
addition for Phase 4 is the `deploymentRef` string with the pinned
version so a clinician can attest exactly which model produced the draft.
