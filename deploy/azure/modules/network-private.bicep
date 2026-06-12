// deploy/azure/modules/network-private.bicep
//
// Phase 4 private-ingress controls for the Signacare AI stack.
//
// Provisions:
//
//   - VNet `<prefix>-vnet-<env>` (RFC1918 /16)
//   - Subnets:
//       * `app` (/24)               — App Service VNet integration
//       * `pe`  (/24)               — Private endpoints (Cognitive Services,
//                                      Postgres, Redis, KV, Blob)
//       * `aks-system` (/24)        — Phase 5 sovereign-GPU AKS system pool
//       * `aks-inference` (/24)     — Phase 5 sovereign-GPU inference node pool
//       * `aks-training` (/24)      — Phase 5 sovereign-GPU training node pool
//                                      (kept structurally separate so the
//                                      AKS cluster CAN'T silently colocate
//                                      training jobs on inference nodes)
//   - Private DNS zones (one per provider type) with VNet links:
//       * privatelink.openai.azure.com
//       * privatelink.postgres.database.azure.com
//       * privatelink.redis.cache.windows.net
//       * privatelink.vaultcore.azure.net
//       * privatelink.blob.core.windows.net
//
// Module is invoked from main.bicep when `enablePrivateNetwork = true`.
// Existing public-ingress deployments stay backwards-compatible (the flag
// defaults to false in the bicep root; production parameters file flips
// it on).
//
// Phase 4 hard requirement #2 — private ingress/network controls via IaC.
// Phase 4 hard requirement #3 — managed identity + Key Vault secrets (the
// Cognitive Services / OpenAI endpoint is reached over the privatelink
// DNS zone created here; managed identity is wired in azure-openai.bicep).

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param namePrefix string

@allowed(['prod', 'staging'])
param environment string

param location string
param tags object

@description('VNet address space — RFC1918 /16 keeps room for AKS expansion.')
param vnetAddressPrefix string = '10.42.0.0/16'

@description('Whether to provision AKS subnets for Phase 5 sovereign-GPU lane.')
param enableSovereignSubnets bool = false

var vnetName = '${namePrefix}-vnet-${environment}'
var storagePrivateLinkZoneName = 'privatelink.blob.${az.environment().suffixes.storage}'

var dnsZoneNames = [
  'privatelink.openai.azure.com'
  'privatelink.postgres.database.azure.com'
  'privatelink.redis.cache.windows.net'
  'privatelink.vaultcore.azure.net'
  storagePrivateLinkZoneName
]

var baseSubnets = [
  {
    name: 'app'
    properties: {
      addressPrefix: '10.42.1.0/24'
      delegations: [
        {
          name: 'app-service-delegation'
          properties: {
            serviceName: 'Microsoft.Web/serverFarms'
          }
        }
      ]
      privateEndpointNetworkPolicies: 'Disabled'
    }
  }
  {
    name: 'pe'
    properties: {
      addressPrefix: '10.42.2.0/24'
      // Private endpoints require the host subnet to disable network
      // policies so the endpoint NIC is not double-secured by a NSG.
      privateEndpointNetworkPolicies: 'Disabled'
    }
  }
]

var sovereignSubnets = [
  {
    name: 'aks-system'
    properties: {
      addressPrefix: '10.42.10.0/24'
      privateEndpointNetworkPolicies: 'Disabled'
    }
  }
  {
    name: 'aks-inference'
    properties: {
      addressPrefix: '10.42.11.0/24'
      privateEndpointNetworkPolicies: 'Disabled'
    }
  }
  {
    name: 'aks-training'
    properties: {
      addressPrefix: '10.42.12.0/24'
      privateEndpointNetworkPolicies: 'Disabled'
    }
  }
]

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [vnetAddressPrefix]
    }
    subnets: enableSovereignSubnets ? concat(baseSubnets, sovereignSubnets) : baseSubnets
  }
}

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for zoneName in dnsZoneNames: {
  name: zoneName
  location: 'global'
  tags: tags
}]

resource privateDnsZoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (zoneName, i) in dnsZoneNames: {
  parent: privateDnsZones[i]
  name: '${vnetName}-link'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}]

output vnetId string = vnet.id
output vnetName string = vnet.name
output appSubnetId string = '${vnet.id}/subnets/app'
output peSubnetId string = '${vnet.id}/subnets/pe'
output aksSystemSubnetId string = enableSovereignSubnets ? '${vnet.id}/subnets/aks-system' : ''
output aksInferenceSubnetId string = enableSovereignSubnets ? '${vnet.id}/subnets/aks-inference' : ''
output aksTrainingSubnetId string = enableSovereignSubnets ? '${vnet.id}/subnets/aks-training' : ''
output openAiPrivateDnsZoneId string = privateDnsZones[0].id
output postgresPrivateDnsZoneId string = privateDnsZones[1].id
output redisPrivateDnsZoneId string = privateDnsZones[2].id
output keyVaultPrivateDnsZoneId string = privateDnsZones[3].id
output blobPrivateDnsZoneId string = privateDnsZones[4].id
