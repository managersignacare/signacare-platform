// deploy/azure/modules/redis.bicep
//
// Azure Cache for Redis for the Signacare API. Redis is load-bearing
// for:
//
//   DB0  — BullMQ AI job queue (llm module)
//   DB1  — Rate limit buckets (4 tiers — ip, user, auth, llm)
//   DB2  — BullMQ HL7 worker queue
//   DB3  — redisCache: session idle window, WebAuthn challenges,
//          idempotency keys
//
// Signacare's Redis clients use multiple logical DBs (0-3) which
// **requires** Standard or Premium. Basic has a single DB and would
// corrupt cross-surface state.
//
// Non-SSL port is disabled; all connections go through port 6380 with
// TLS 1.2+. The access key lives in Key Vault and is referenced from
// App Service via @Microsoft.KeyVault(SecretUri=...).
//
// Standards: ISO 27001 A.8.14, SOC 2 A1.

targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param tags object

@description('Redis SKU tier. Basic is unsafe for Signacare (single DB).')
@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Standard'

@description('Redis SKU family: C for Basic/Standard, P for Premium.')
param family string = sku == 'Premium' ? 'P' : 'C'

@description('Redis capacity. For C family: 0=250MB, 1=1GB, 2=2.5GB, 3=6GB…')
param capacity int = 1

var redisName = '${namePrefix}-redis-${environment}'

resource redis 'Microsoft.Cache/Redis@2023-08-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: {
      name: sku
      family: family
      capacity: capacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
      'maxmemory-reserved': '50'
      'maxfragmentationmemory-reserved': '50'
      'maxmemory-delta': '50'
    }
  }
}

output hostName string = redis.properties.hostName
output sslPort int = redis.properties.sslPort
output redisResourceId string = redis.id
