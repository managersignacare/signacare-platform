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
//      azure-deploy.yml workflow pushes to ACR on every merge to main
//      and then calls `az webapp config container set` to point the
//      site at the new tag. Zero-downtime slot swap is used for prod.
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
//     az keyvault secret set --vault-name <kv> --name redis-password --value <...>
//
// See docs/AZURE_DEPLOYMENT.md §4 for the full secret list.
//
// Standards: ISO 27001 A.8.3 (information access restriction via
// managed identity), SOC 2 CC6 (logical access).

targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param tags object

@description('App Service Plan SKU.')
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

var planName = '${namePrefix}-asp-${environment}'
var apiAppName = '${namePrefix}-api-${environment}'
var webAppName = '${namePrefix}-web-${environment}'
var apiImage = '${namePrefix}cr${environment}.azurecr.io/signacare-api:latest'
var webImage = '${namePrefix}cr${environment}.azurecr.io/signacare-web:latest'
var acrName = '${namePrefix}cr${environment}'
var storageBlobDomain = 'blob.${az.environment().suffixes.storage}'
var slotName = environment == 'prod' ? 'staging' : 'next'
var supportsDeploymentSlots = !(planSku == 'B1' || planSku == 'F1' || planSku == 'D1')
var apiNodeEnv = environment == 'prod' ? 'production' : 'development'

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
  properties: {
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
      appSettings: [
        { name: 'WEBSITES_PORT',                          value: '4000' }
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
        // PHI encryption + blind index (distinct keys per NIST SP 800-57 §8.2.3)
        { name: 'PHI_ENCRYPTION_KEY',                     value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/phi-encryption-key)' }
        { name: 'BLIND_INDEX_KEY',                        value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/blind-index-key)' }
        // Auth
        { name: 'JWT_ACCESS_SECRET',                      value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/jwt-access-secret)' }
        { name: 'JWT_REFRESH_SECRET',                     value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/jwt-refresh-secret)' }
        { name: 'SESSION_SECRET',                         value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/session-secret)' }
        // BlobStorage (S3-compatible — point at an S3 gateway or MinIO;
        // for native Azure Blob an AzureBlobStorage backend is the
        // follow-up task documented in apps/api/src/shared/blobStorage.ts).
        { name: 'BLOB_BACKEND',                           value: 's3' }
        { name: 'BLOB_S3_BUCKET',                         value: storageBlobContainer }
        { name: 'BLOB_S3_ENDPOINT',                       value: 'https://${storageAccountName}.${storageBlobDomain}' }
        { name: 'BLOB_S3_REGION',                         value: location }
        { name: 'BLOB_S3_ACCESS_KEY_ID',                  value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/storage-access-key)' }
        { name: 'BLOB_S3_SECRET_ACCESS_KEY',              value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/storage-secret-key)' }
        // Observability
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',  value: appInsightsConnectionString }
        { name: 'OTEL_EXPORTER_OTLP_ENDPOINT',            value: 'https://${location}.in.applicationinsights.azure.com' }
        { name: 'SENTRY_DSN',                             value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/sentry-dsn)' }
        // Slack alerts
        { name: 'SLACK_WEBHOOK_SECURITY',                 value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/slack-webhook-security)' }
        { name: 'SLACK_WEBHOOK_OPS',                      value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/slack-webhook-ops)' }
        // Trust proxy so req.ip honours X-Forwarded-For behind Front Door.
        { name: 'TRUST_PROXY',                            value: 'true' }
        { name: 'CORS_ORIGIN',                            value: customDomain == '' ? 'https://${webAppName}.azurewebsites.net' : 'https://${customDomain}' }
        { name: 'NODE_ENV',                               value: apiNodeEnv }
      ]
    }
  }
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
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      acrUseManagedIdentityCreds: true
      linuxFxVersion: 'DOCKER|${apiImage}'
      keyVaultReferenceIdentity: 'SystemAssigned'
      alwaysOn: true
      healthCheckPath: '/health'
    }
  }
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
        { name: 'API_UPSTREAM',                           value: 'https://${apiApp.properties.defaultHostName}/api' }
      ]
    }
  }
}

output apiDefaultHostName string = apiApp.properties.defaultHostName
output webDefaultHostName string = webApp.properties.defaultHostName
output apiIdentityPrincipalId string = apiApp.identity.principalId
output planName string = plan.name
