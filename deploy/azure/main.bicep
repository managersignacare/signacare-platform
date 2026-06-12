// deploy/azure/main.bicep
//
// Signacare EMR — top-level Azure deployment (S8.1).
//
// Provisions the full Signacare stack in an Australian Azure region with
// every tenant-isolation and compliance control the app depends on:
//
//   Web tier       — App Service (Linux) running the nginx-served SPA
//   API tier       — App Service (Linux) running the compiled Node.js API
//   Database       — Azure Database for PostgreSQL Flexible Server (AU-East)
//                    with zone-redundant HA, geo-redundant backups, and
//                    pg_trgm + pgcrypto extensions allow-listed
//   Cache          — Azure Cache for Redis (Standard) for BullMQ, rate
//                    limit, session idle window, and webauthn challenges
//   Storage        — Storage Account + Blob container for BlobStorage
//                    facade attachments and scribe audio
//   Secrets        — Key Vault with App Service managed-identity access,
//                    App Service pulls secrets via native Key Vault
//                    references so the `env` backend of our pluggable
//                    secrets resolver just works
//   Observability  — Application Insights + Log Analytics workspace
//                    wired to the OpenTelemetry exporter the app ships
//   Front door     — Azure Front Door for TLS 1.3, WAF, and HTTPS-only
//                    routing. Custom domain + managed cert.
//
// Resource naming follows `<prefix>-<service>-<env>` so every resource
// in a subscription is grouped and filterable by environment.
//
// Parameters are split across parameters.prod.json and
// parameters.staging.json so the same template produces identical
// architecture in both environments, reducing "works in staging, breaks
// in prod" surprises.
//
// To deploy (see deploy/azure/README.md for the full runbook):
//
//   az deployment sub create \
//     --location australiaeast \
//     --template-file deploy/azure/main.bicep \
//     --parameters @deploy/azure/parameters.prod.json \
//     --parameters adminPasswordSecret=$(openssl rand -base64 32)
//
// Standards satisfied:
//   - Australian Data Residency (region locked to australiaeast / australiasoutheast)
//   - ISO 27001 A.8.31 (separation of environments)
//   - NIST SP 800-57 §8.2.3 (PHI encryption key + blind-index key both in Key Vault)
//   - SOC 2 A1 (availability) — zone-redundant HA Postgres + Redis
//
// Fix Registry: AZ1 (main.bicep present), AZ-NAMING (naming convention
// enforced via namePrefix parameter validation).

targetScope = 'subscription'

@description('Base name prefix for every resource (e.g. "signacare"). Lowercase, 3-12 chars.')
@minLength(3)
@maxLength(12)
param namePrefix string

@description('Deployment environment — used as a suffix and in tags.')
@allowed(['prod', 'staging'])
param environment string

@description('Primary Azure region. Must be an Australian region for data residency.')
@allowed(['australiaeast', 'australiasoutheast'])
param location string = 'australiaeast'

@description('PostgreSQL administrator password. Rotate via Key Vault — NEVER commit to git.')
@secure()
param adminPasswordSecret string

@description('Object ID of the AAD group that should own the Key Vault (superadmin ops team).')
param keyVaultAdminObjectId string

@description('Custom domain to bind to Front Door, e.g. emr.example.com. Leave empty for azurewebsites.net-only.')
param customDomain string = ''

@description('SKU tier for App Service (default P1v3 for prod, B1 for staging).')
param appServicePlanSku string = 'P1v3'

@description('PostgreSQL Flexible Server SKU (default Standard_D2ds_v4 — 2 vCPU, 8 GB RAM).')
param postgresSku string = 'Standard_D2ds_v4'

@description('Redis SKU — Standard C1 (1 GB) is the smallest production-safe option.')
@allowed(['Basic', 'Standard', 'Premium'])
param redisSku string = 'Standard'

@description('High-availability mode for Postgres. ZoneRedundant requires a region with >=3 zones.')
@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param postgresHaMode string = 'ZoneRedundant'

@description('Create dedicated Ollama + Whisper App Services. Default false so app infra can be prepared before AI images are available.')
param aiRuntimeEnabled bool = false

@description('SKU tier for the dedicated AI runtime App Service Plan.')
param aiRuntimePlanSku string = 'P1v3'

@description('Ollama model baked into the AI runtime image.')
param ollamaModel string = 'llama3.2:signacare-35f39aa1'

@description('Ollama model manifest digest baked into the AI runtime image.')
param ollamaModelManifestSha256 string = 'sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58'

@description('Whisper model baked into the AI runtime image.')
param whisperModel string = 'small'

@description('Whisper model SHA-256 baked into the AI runtime image.')
param whisperModelSha256 string = '9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794'

// ── Phase 4 / Phase 5 lane controls ────────────────────────────────────────

@description('Phase 4 — provision the private VNet + private endpoints + private DNS zones. Required for azure_fast lane.')
param enablePrivateNetwork bool = false

@description('Phase 4 — provision the Azure OpenAI account (azure_fast lane). Requires enablePrivateNetwork=true.')
param enableAzureOpenAi bool = false

@description('Phase 4 — model name for the fast clinical Azure OpenAI deployment.')
param azureOpenAiFastClinicalModelName string = 'gpt-4o-mini'

@description('Phase 4 — model version for the fast clinical Azure OpenAI deployment. Pinned date-stamp version, never "latest".')
param azureOpenAiFastClinicalModelVersion string = '2024-07-18'

@description('Phase 4 — model name for the best clinical Azure OpenAI deployment.')
param azureOpenAiBestClinicalModelName string = 'gpt-4o'

@description('Phase 4 — model version for the best clinical Azure OpenAI deployment. Pinned date-stamp version, never "latest".')
param azureOpenAiBestClinicalModelVersion string = '2024-11-20'

@description('Phase 4 — deployment SKU for the fast clinical Azure OpenAI alias.')
param azureOpenAiFastClinicalDeploymentSku string = 'GlobalStandard'

@description('Phase 4 — deployment SKU for the best clinical Azure OpenAI alias.')
param azureOpenAiBestClinicalDeploymentSku string = 'GlobalStandard'

@description('Phase 4 — TPM capacity for the fast clinical Azure OpenAI alias.')
param azureOpenAiFastClinicalCapacity int = 100

@description('Phase 4 — TPM capacity for the best clinical Azure OpenAI alias.')
param azureOpenAiBestClinicalCapacity int = 50

@description('Phase 5 — provision the sovereign GPU AKS cluster with separated inference / training node pools.')
param enableSovereignGpu bool = false

@description('Phase 5 — container image for sovereign-GPU inference (digest-pinned at deploy time).')
param sovereignInferenceImage string = ''

@description('Phase 5 — Ollama model manifest SHA-256 baked into the sovereign inference image. Phase 5 #2 — no runtime pulls.')
param sovereignInferenceModelManifestSha256 string = 'sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58'

// ── Derived names ─────────────────────────────────────────────────────────
var resourceGroupName = '${namePrefix}-rg-${environment}'
var tags = {
  application: 'signacare-emr'
  environment: environment
  managedBy: 'bicep'
  costCenter: 'clinical-platform'
  dataClassification: 'phi'
}

// ── Resource group ────────────────────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// ── Child modules ─────────────────────────────────────────────────────────
module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
  }
}

module keyVault 'modules/keyvault.bicep' = {
  scope: rg
  name: 'keyvault'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    adminObjectId: keyVaultAdminObjectId
  }
}

module storage 'modules/storage.bicep' = {
  scope: rg
  name: 'storage'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
  }
}

module database 'modules/database.bicep' = {
  scope: rg
  name: 'database'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    administratorLoginPassword: adminPasswordSecret
    skuName: postgresSku
    haMode: postgresHaMode
  }
}

module redis 'modules/redis.bicep' = {
  scope: rg
  name: 'redis'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    sku: redisSku
  }
}

module appService 'modules/appservice.bicep' = {
  scope: rg
  name: 'appservice'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    planSku: appServicePlanSku
    postgresFqdn: database.outputs.serverFqdn
    postgresDatabase: database.outputs.databaseName
    redisHost: redis.outputs.hostName
    redisPort: redis.outputs.sslPort
    storageAccountName: storage.outputs.accountName
    storageBlobContainer: storage.outputs.blobContainerName
    keyVaultUri: keyVault.outputs.vaultUri
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    customDomain: customDomain
    enablePrivateNetwork: enablePrivateNetwork
    appSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.appSubnetId : ''
    enableAzureOpenAi: enableAzureOpenAi && enablePrivateNetwork
    azureOpenAiFastClinicalDeployment: '${namePrefix}-fast-clinical-${environment}'
    azureOpenAiFastClinicalModelVersion: azureOpenAiFastClinicalModelVersion
    azureOpenAiBestClinicalDeployment: '${namePrefix}-best-clinical-${environment}'
    azureOpenAiBestClinicalModelVersion: azureOpenAiBestClinicalModelVersion
  }
}

module aiRuntime 'modules/ai-runtime-appservice.bicep' = if (aiRuntimeEnabled) {
  scope: rg
  name: 'ai-runtime'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    aiRuntimePlanSku: aiRuntimePlanSku
    ollamaModel: ollamaModel
    ollamaModelManifestSha256: ollamaModelManifestSha256
    whisperModel: whisperModel
    whisperModelSha256: whisperModelSha256
  }
}

// ── Phase 4 / Phase 5 lane modules ────────────────────────────────────────

module networkPrivate 'modules/network-private.bicep' = if (enablePrivateNetwork) {
  scope: rg
  name: 'network-private'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    enableSovereignSubnets: enableSovereignGpu
  }
}

// Phase 4 — Azure OpenAI private fast lane. Requires enablePrivateNetwork
// per architecture (the account is publicNetworkAccess=Disabled).
module azureOpenAi 'modules/azure-openai.bicep' = if (enableAzureOpenAi && enablePrivateNetwork) {
  scope: rg
  name: 'azure-openai'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    privateEndpointSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.peSubnetId : ''
    openAiPrivateDnsZoneId: enablePrivateNetwork ? networkPrivate!.outputs.openAiPrivateDnsZoneId : ''
    keyVaultName: keyVault.outputs.vaultName
    appServicePrincipalId: appService.outputs.apiIdentityPrincipalId
    appServiceSlotPrincipalId: appService.outputs.apiSlotIdentityPrincipalId
  }
}

// Phase 5 — sovereign GPU AKS cluster. If enableSovereignGpu=true, the
// module is always invoked so missing private-network subnets or missing
// immutable inference-image evidence fail validation instead of silently
// skipping the lane.
module sovereignGpu 'modules/sovereign-gpu-aks.bicep' = if (enableSovereignGpu) {
  scope: rg
  name: 'sovereign-gpu-aks'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    aksSystemSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.aksSystemSubnetId : ''
    aksInferenceSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.aksInferenceSubnetId : ''
    aksTrainingSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.aksTrainingSubnetId : ''
    inferenceImage: sovereignInferenceImage
    inferenceModelManifestSha256: sovereignInferenceModelManifestSha256
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────
output resourceGroupName string = rg.name
output apiUrl string = appService.outputs.apiDefaultHostName
output webUrl string = appService.outputs.webDefaultHostName
output keyVaultName string = keyVault.outputs.vaultName
output postgresFqdn string = database.outputs.serverFqdn
output redisHostName string = redis.outputs.hostName
output appInsightsName string = monitoring.outputs.appInsightsName
output ollamaUrl string = aiRuntimeEnabled ? aiRuntime!.outputs.ollamaDefaultHostName : ''
output whisperUrl string = aiRuntimeEnabled ? aiRuntime!.outputs.whisperDefaultHostName : ''

// Phase 4 outputs
output privateVnetName string = enablePrivateNetwork ? networkPrivate!.outputs.vnetName : ''
output azureOpenAiEndpoint string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAi!.outputs.openAiEndpoint : ''
output azureOpenAiFastClinicalModelName string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiFastClinicalModelName : ''
output azureOpenAiFastClinicalDeployment string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAi!.outputs.fastClinicalDeploymentName : ''
output azureOpenAiFastClinicalDeploymentSku string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiFastClinicalDeploymentSku : ''
output azureOpenAiFastClinicalCapacity int = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiFastClinicalCapacity : 0
output azureOpenAiBestClinicalModelName string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiBestClinicalModelName : ''
output azureOpenAiBestClinicalDeployment string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAi!.outputs.bestClinicalDeploymentName : ''
output azureOpenAiBestClinicalDeploymentSku string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiBestClinicalDeploymentSku : ''
output azureOpenAiBestClinicalCapacity int = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAiBestClinicalCapacity : 0
output azureOpenAiEndpointKvRef string = enableAzureOpenAi && enablePrivateNetwork ? azureOpenAi!.outputs.endpointKvRef : ''

// Phase 5 outputs
output sovereignGpuClusterName string = enableSovereignGpu ? sovereignGpu!.outputs.clusterName : ''
output sovereignGpuOidcIssuerUrl string = enableSovereignGpu ? sovereignGpu!.outputs.oidcIssuerUrl : ''
output sovereignInferenceModelManifestSha256 string = enableSovereignGpu ? sovereignGpu!.outputs.inferenceModelManifestSha256 : ''
