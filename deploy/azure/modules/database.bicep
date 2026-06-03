// deploy/azure/modules/database.bicep
//
// Azure Database for PostgreSQL Flexible Server for Signacare. Chosen
// over Single Server because Flexible supports:
//
//   - Zone-redundant HA (same region, different availability zones)
//   - pg_trgm and pgcrypto extensions needed by:
//       - Blind-index HMAC lookups (S7.1 duplicate detection)
//       - Trigram fuzzy name matching (S3.3 patient search)
//       - PHI column encryption via pgcrypto in phiEncryption.ts
//   - Major-version upgrades without tearing down the server
//   - Storage autogrow so we don't page the DBA at 3am when
//     clinical_note_versions crosses 80% disk
//
// Extensions are allow-listed here via azure.extensions because
// Postgres Flexible Server requires explicit allow-list before
// `CREATE EXTENSION` works for a given extension. Omitting this is the
// #1 source of "migration 20260411000009_evidence_corpus.ts failed
// because pg_trgm is not installed" errors in fresh Azure deployments.
//
// Backup policy:
//   - 35 days retention (Azure maximum)
//   - Geo-redundant backup enabled for prod
//   - Point-in-time recovery always available within the retention
//
// Standards: SOC 2 A1, ISO 27001 A.8.13.

targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param tags object

@description('PostgreSQL administrator login name.')
param administratorLogin string = 'signacareadmin'

@secure()
param administratorLoginPassword string

@description('SKU name for the server (e.g. Standard_D2ds_v4).')
param skuName string = 'Standard_D2ds_v4'

@description('Storage size in GB. Autogrow enabled separately.')
param storageSizeGB int = 128

@description('High-availability mode.')
@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param haMode string = 'ZoneRedundant'

var serverName = '${namePrefix}-pg-${environment}'
var databaseName = 'signacareemr'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
      tier: 'P10'
    }
    backup: {
      backupRetentionDays: 35
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: haMode
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: 0 // Sunday
      startHour: 18 // 04:00 AEST = 18:00 UTC Saturday
      startMinute: 0
    }
  }
}

// Allow Azure services to reach the server (App Service egress IPs are
// dynamic, so a CIDR allow-list would be fragile — Azure-services rule
// covers App Service + Container Apps + Functions). For truly locked-
// down prod, switch to VNet integration later.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: server
  name: 'allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0' // Azure's special "allow all Azure services" sentinel
  }
}

// Required-extensions allow-list. Signacare migrations call CREATE
// EXTENSION for pg_trgm, pgcrypto, uuid-ossp, and btree_gin; the
// Flexible Server blocks unlisted extensions by default.
resource extensionsConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: 'PG_TRGM,PGCRYPTO,UUID-OSSP,BTREE_GIN,PG_STAT_STATEMENTS'
    source: 'user-override'
  }
}

// Enable pg_stat_statements for the slow-query surface in App Insights.
resource sharedPreload 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: server
  name: 'shared_preload_libraries'
  properties: {
    value: 'pg_stat_statements'
    source: 'user-override'
  }
  dependsOn: [
    extensionsConfig
  ]
}

// Primary application database.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_AU.utf8'
  }
}

output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
output administratorLogin string = administratorLogin
