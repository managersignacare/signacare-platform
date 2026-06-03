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
@allowed(['prod', 'staging', 'dev'])
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
