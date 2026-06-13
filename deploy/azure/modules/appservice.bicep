// deploy/azure/modules/appservice.bicep
//
// App Service Plan + two App Service sites (API and Web) for Signacare.
// Both sites run Linux containers built from apps/api/Dockerfile and
// apps/web/Dockerfile respectively.
//
// Key architectural decisions:
//
//   1. System-assigned managed identity on the API site. Used to pull
//      secrets from Key Vault via native @Microsoft.KeyVault references
//      — no SDK calls, no code changes to the secrets resolver. The
//      existing `env` backend just reads the injected values.
//
//   2. Container image pulled from Azure Container Registry. The
//      azure-deploy.yml workflow pushes to ACR on every merge to main,
//      resolves the immutable manifest digest, and then calls
//      `az webapp config container set` to point the site at repo@sha256.
//      Zero-downtime slot swap is used for prod.
//
//   3. Always On = true so the API process doesn't get hibernated
//      between requests — warm-up on BullMQ workers matters.
//
//   4. HTTPS-only, TLS 1.2 minimum, HTTP/2 enabled.
//
//   5. Health probe at /health for liveness and /ready for readiness,
//      both already implemented in apps/api/src/server.ts.
//
//   6. Deployment slot "staging" on the API for blue-green — swap to
//      production after smoke tests pass.
//
// Secret values are passed as Key Vault references (NOT plaintext in
// this template). Before first deploy the ops team must push the
// expected secret names via:
//
//     az keyvault secret set --vault-name <kv> --name db-password --value <...>
//     az keyvault secret set --vault-name <kv> --name jwt-access-secret --value <...>
//     az keyvault secret set --vault-name <kv> --name phi-encryption-key --value <...>
//     az keyvault secret set --vault-name <kv> --name blind-index-key --value <...>
//     az keyvault secret set --vault-name <kv> --name patient-app-dedupe-pepper --value <...>
//     az keyvault secret set --vault-name <kv> --name redis-password --value <...>
//
// See docs/AZURE_DEPLOYMENT.md §4 for the full secret list.
//
// Standards: ISO 27001 A.8.3 (information access restriction via
// managed identity), SOC 2 CC6 (logical access).

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param namePrefix string

@allowed([
  'prod'
  'staging'
])
param environment string
param location string
param tags object

@description('App Service Plan SKU.')
@allowed([
  'B1'
  'B2'
  'B3'
  'S1'
  'S2'
  'S3'
  'P1v3'
  'P2v3'
  'P3v3'
])
param planSku string = 'P1v3'

@description('Postgres Flexible Server FQDN, passed through from the database module.')
param postgresFqdn string

param postgresDatabase string

param redisHost string

param redisPort int

param storageAccountName string

param storageBlobContainer string

param keyVaultUri string

param appInsightsConnectionString string

@description('Optional custom domain to bind. Leave empty to use the default azurewebsites.net hostname.')
param customDomain string = ''

@description('Phase 4 — wire the private Azure OpenAI fast lane into API app settings.')
param enableAzureOpenAi bool = false

@description('Phase 4 — attach the API app + slot to the delegated App Service subnet so private-lane egress resolves through VNet DNS.')
param enablePrivateNetwork bool = false

@description('Phase 4 — delegated Microsoft.Web/serverFarms subnet resource ID for regional VNet integration.')
param appSubnetId string = ''

@description('Phase 4 — Azure OpenAI API version used by the runtime adapter.')
param azureOpenAiApiVersion string = '2025-01-01-preview'

@description('Phase 4 — deployment name for the fast_clinical alias.')
param azureOpenAiFastClinicalDeployment string = ''

@description('Phase 4 — pinned model version for the fast_clinical alias.')
param azureOpenAiFastClinicalModelVersion string = ''

@description('Phase 4 — deployment name for best_clinical / court_report_reasoning aliases.')
param azureOpenAiBestClinicalDeployment string = ''

@description('Phase 4 — pinned model version for best_clinical / court_report_reasoning aliases.')
param azureOpenAiBestClinicalModelVersion string = ''

var planName = '${namePrefix}-asp-${environment}'
var apiAppName = '${namePrefix}-api-${environment}'
var webAppName = '${namePrefix}-web-${environment}'
var apiImage = '${namePrefix}cr${environment}.azurecr.io/signacare-api:bootstrap'
var webImage = '${namePrefix}cr${environment}.azurecr.io/signacare-web:bootstrap'
var acrName = '${namePrefix}cr${environment}'
var storageBlobDomain = 'blob.${az.environment().suffixes.storage}'
var slotName = environment == 'prod' ? 'staging' : 'next'
var supportsDeploymentSlots = !(planSku == 'B1' || planSku == 'F1' || planSku == 'D1')
var apiNodeEnv = environment == 'prod' ? 'production' : 'development'
var azureOpenAiAppSettings = enableAzureOpenAi ? [
  { name: 'AZURE_OPENAI_AUTH_MODE',                          value: 'managed_identity' }
  { name: 'AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED',           value: 'true' }
  { name: 'AZURE_OPENAI_ENDPOINT',                           value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/AZURE-OPENAI-ENDPOINT)' }
  { name: 'AZURE_OPENAI_API_VERSION',                        value: azureOpenAiApiVersion }
  { name: 'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL',           value: azureOpenAiFastClinicalDeployment }
  { name: 'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION',   value: azureOpenAiFastClinicalModelVersion }
  { name: 'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL',           value: azureOpenAiBestClinicalDeployment }
  { name: 'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION',   value: azureOpenAiBestClinicalModelVersion }
] : []
var apiBaseAppSettings = [
  { name: 'WEBSITES_PORT',                          value: '4000' }
  { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE',    value: 'true' }
  { name: 'PORT',                                   value: '4000' }
  { name: 'DOCKER_REGISTRY_SERVER_URL',             value: 'https://${namePrefix}cr${environment}.azurecr.io' }
  // Database
  { name: 'DB_HOST',                                value: postgresFqdn }
  { name: 'DB_PORT',                                value: '5432' }
  { name: 'DB_NAME',                                value: postgresDatabase }
  { name: 'DB_USER',                                value: 'signacareadmin' }
  { name: 'DB_PASSWORD',                            value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/db-password)' }
  { name: 'DB_APP_PASSWORD',                        value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/db-app-password)' }
  { name: 'DB_SSL',                                 value: 'true' }
  // Redis — Azure requires TLS 6380 for Standard+
  { name: 'REDIS_HOST',                             value: redisHost }
  { name: 'REDIS_PORT',                             value: string(redisPort) }
  { name: 'REDIS_URL',                              value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/redis-url)' }
  { name: 'REDIS_PASSWORD',                         value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/redis-password)' }
  { name: 'REDIS_TLS',                              value: 'true' }
  // PHI encryption + blind index
  { name: 'PHI_ENCRYPTION_KEY',                     value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/phi-encryption-key)' }
  { name: 'BLIND_INDEX_KEY',                        value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/blind-index-key)' }
  { name: 'PATIENT_APP_DEDUPE_PEPPER',              value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/patient-app-dedupe-pepper)' }
  { name: 'PATIENT_APP_DEDUPE_PEPPER_VERSION',      value: 'v1' }
  // Auth
  { name: 'JWT_ACCESS_SECRET',                      value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/jwt-access-secret)' }
  { name: 'JWT_REFRESH_SECRET',                     value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/jwt-refresh-secret)' }
  { name: 'SESSION_SECRET',                         value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/session-secret)' }
  // BlobStorage — keep slot boot config identical to the production app.
  { name: 'BLOB_STORAGE_BACKEND',                   value: 'azure-blob' }
  { name: 'BLOB_AZURE_ACCOUNT_NAME',                value: storageAccountName }
  { name: 'BLOB_AZURE_CONTAINER',                   value: storageBlobContainer }
  { name: 'BLOB_AZURE_ENDPOINT',                    value: 'https://${storageAccountName}.${storageBlobDomain}' }
  { name: 'BLOB_AZURE_ACCOUNT_KEY',                 value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/storage-secret-key)' }
  { name: 'UPLOAD_BASE_DIR',                        value: '/home/site/signacare/uploads' }
  // Observability
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',  value: appInsightsConnectionString }
  { name: 'OTEL_EXPORTER_OTLP_ENDPOINT',            value: 'https://${location}.in.applicationinsights.azure.com' }
  { name: 'SENTRY_DSN',                             value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/sentry-dsn)' }
  // Slack alerts
  { name: 'SLACK_WEBHOOK_SECURITY',                 value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/slack-webhook-security)' }
  { name: 'SLACK_WEBHOOK_OPS',                      value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/slack-webhook-ops)' }
  { name: 'TRUST_PROXY',                            value: 'true' }
  { name: 'CORS_ORIGIN',                            value: customDomain == '' ? 'https://${webAppName}.azurewebsites.net' : 'https://${customDomain}' }
  { name: 'API_BASE_URL',                           value: 'https://${apiAppName}.azurewebsites.net' }
  { name: 'NODE_ENV',                               value: apiNodeEnv }
]
var apiSlotAppSettings = concat(apiBaseAppSettings, azureOpenAiAppSettings)
var apiAppProperties = union({
  serverFarmId: plan.id
  httpsOnly: true
  clientAffinityEnabled: false
  siteConfig: {
    acrUseManagedIdentityCreds: true
    linuxFxVersion: 'DOCKER|${apiImage}'
    keyVaultReferenceIdentity: 'SystemAssigned'
    alwaysOn: true
    http20Enabled: true
    minTlsVersion: '1.2'
    ftpsState: 'Disabled'
    healthCheckPath: '/health'
    appSettings: apiSlotAppSettings
  }
}, enablePrivateNetwork ? {
  virtualNetworkSubnetId: appSubnetId
  vnetRouteAllEnabled: true
} : {})
var apiSlotProperties = union({
  serverFarmId: plan.id
  httpsOnly: true
  siteConfig: {
    acrUseManagedIdentityCreds: true
    linuxFxVersion: 'DOCKER|${apiImage}'
    keyVaultReferenceIdentity: 'SystemAssigned'
    alwaysOn: true
    healthCheckPath: '/health'
    appSettings: apiSlotAppSettings
  }
}, enablePrivateNetwork ? {
  virtualNetworkSubnetId: appSubnetId
  vnetRouteAllEnabled: true
} : {})

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  sku: {
    name: planSku
  }
  kind: 'linux'
  properties: {
    reserved: true // Linux
    zoneRedundant: environment == 'prod'
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' existing = {
  name: acrName
}

// ── API site ─────────────────────────────────────────────────────────────
resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: apiAppName
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: apiAppProperties
}

// Deployment slot strategy:
// - Production uses the "staging" slot for blue-green flow.
// - Non-prod uses the "next" slot for canary/preview deploys.
// - Slots are created only when the plan SKU supports them.
resource apiSlot 'Microsoft.Web/sites/slots@2023-12-01' = if (supportsDeploymentSlots) {
  parent: apiApp
  name: slotName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: apiSlotProperties
}

// Grant the API managed identity "Key Vault Secrets User" role on the
// vault. This is how the @Microsoft.KeyVault references above actually
// resolve at runtime.
// 4633458b-17de-408a-b874-0445c86b69e6 = Key Vault Secrets User (built-in)
resource apiKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup()
  name: guid(apiApp.id, 'kv-secrets-user')
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
  }
}

resource apiSlotKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (supportsDeploymentSlots) {
  scope: resourceGroup()
  name: guid(apiSlot.id, 'kv-secrets-user')
  properties: {
    principalId: apiSlot!.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
  }
}

// ── Web site ─────────────────────────────────────────────────────────────
resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  kind: 'app,linux,container'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      acrUseManagedIdentityCreds: true
      linuxFxVersion: 'DOCKER|${webImage}'
      keyVaultReferenceIdentity: 'SystemAssigned'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '80' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://${namePrefix}cr${environment}.azurecr.io' }
        { name: 'API_UPSTREAM',                           value: 'https://${apiApp.properties.defaultHostName}/api' }
      ]
    }
  }
}

// Allow both API and web identities to pull images from ACR without
// plaintext container credentials.
resource apiAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, apiApp.id, 'acr-pull-api')
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    // Built-in role "AcrPull"
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

resource webAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, webApp.id, 'acr-pull-web')
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

// Ensure deployment slots inherit the same ACR auth mode for
// blue/green + canary rollout.
resource webSlot 'Microsoft.Web/sites/slots@2023-12-01' = if (supportsDeploymentSlots) {
  parent: webApp
  name: slotName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      acrUseManagedIdentityCreds: true
      linuxFxVersion: 'DOCKER|${webImage}'
      keyVaultReferenceIdentity: 'SystemAssigned'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '80' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://${namePrefix}cr${environment}.azurecr.io' }
        { name: 'API_UPSTREAM',                           value: 'https://${apiApp.properties.defaultHostName}/api' }
      ]
    }
  }
}

resource apiSlotAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (supportsDeploymentSlots) {
  scope: acr
  name: guid(acr.id, apiSlot!.id, 'acr-pull-api-slot')
  properties: {
    principalId: apiSlot!.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

resource webSlotAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (supportsDeploymentSlots) {
  scope: acr
  name: guid(acr.id, webSlot!.id, 'acr-pull-web-slot')
  properties: {
    principalId: webSlot!.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

output apiDefaultHostName string = apiApp.properties.defaultHostName
output webDefaultHostName string = webApp.properties.defaultHostName
output apiIdentityPrincipalId string = apiApp.identity.principalId
output apiSlotIdentityPrincipalId string = supportsDeploymentSlots ? apiSlot!.identity.principalId : ''
output planName string = plan.name
