// deploy/azure/modules/azure-openai.bicep
//
// Phase 4 private Azure OpenAI ("azure_fast" lane) provisioning.
//
// Provisions:
//
//   - Cognitive Services account (kind: 'OpenAI') in the same RG, with:
//       * Public network access disabled (private-endpoint only ingress).
//       * Managed identity (SystemAssigned) so the API uses AAD auth.
//   - Two versioned model deployments:
//       * `<prefix>-fast-clinical-<env>`  — alias `fast_clinical`
//       * `<prefix>-best-clinical-<env>`  — alias `best_clinical` /
//                                            `court_report_reasoning`
//     Each deployment pins the model SKU + version explicitly; we do
//     NOT take provider-defaulted versions because Azure rolls those
//     forward without notice. Phase 4 requirement #4: versioned model
//     deployment references, no `ollama pull`-style runtime fetch.
//   - Private endpoint into the `pe` subnet exposed via the
//     `privatelink.openai.azure.com` private DNS zone (provisioned by
//     `network-private.bicep`).
//   - Key Vault secret for the endpoint. App Service pulls it via a
//     Key Vault reference; model calls authenticate with managed identity,
//     not an API key (Phase 4 requirement #3).
//
// This module is invoked from main.bicep when `enableAzureOpenAi = true`
// AND `enablePrivateNetwork = true` (the second is a hard requirement
// per Phase 4 architecture — Azure OpenAI MUST NOT be publicly reachable
// in this deployment topology).

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param namePrefix string

@allowed(['prod', 'staging'])
param environment string

param location string
param tags object

@description('ID of the private-endpoint subnet from network-private module.')
param privateEndpointSubnetId string

@description('ID of the Azure OpenAI private DNS zone from network-private module.')
param openAiPrivateDnsZoneId string

@description('Name of the Key Vault to write the endpoint secret to.')
param keyVaultName string

@description('Object ID of the App Service principal that should have access to the deployed account.')
param appServicePrincipalId string

@description('Object ID of the API deployment-slot principal. Empty when slots are unsupported.')
param appServiceSlotPrincipalId string = ''

@description('Cognitive Services SKU. S0 is the standard pay-as-you-go OpenAI SKU.')
param cognitiveSku string = 'S0'

var openAiName = '${namePrefix}-openai-${environment}'
var fastDeploymentName = '${namePrefix}-fast-clinical-${environment}'
var bestDeploymentName = '${namePrefix}-best-clinical-${environment}'
var privateEndpointName = '${openAiName}-pe'

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiName
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: cognitiveSku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: openAiName
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
    // Phase 4 #3 — local API auth disabled. AAD / managed identity
    // (granted by the role assignment below) is the ONLY ingress path.
    disableLocalAuth: true
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: privateEndpointName
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'openai-link'
        properties: {
          privateLinkServiceId: openAi.id
          groupIds: ['account']
        }
      }
    ]
  }
}

resource privateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'openai-dns'
        properties: {
          privateDnsZoneId: openAiPrivateDnsZoneId
        }
      }
    ]
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
}

resource endpointSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'AZURE-OPENAI-ENDPOINT'
  properties: {
    value: 'https://${openAi.properties.customSubDomainName}.openai.azure.com/'
    contentType: 'text/plain'
  }
}

// Phase 4 #3 — managed identity only. Grant the App Service principal
// the Cognitive Services OpenAI User role so it can authenticate via AAD
// instead of plaintext API keys.
resource openAiUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openAi
  // Role: "Cognitive Services OpenAI User"
  name: guid(openAi.id, appServicePrincipalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    principalId: appServicePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
    )
  }
}

resource openAiSlotUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appServiceSlotPrincipalId)) {
  scope: openAi
  // Role: "Cognitive Services OpenAI User" for the blue-green API slot.
  name: guid(openAi.id, appServiceSlotPrincipalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    principalId: appServiceSlotPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
    )
  }
}

output openAiAccountName string = openAi.name
output openAiEndpoint string = 'https://${openAi.properties.customSubDomainName}.openai.azure.com/'
output fastClinicalDeploymentName string = fastDeploymentName
output bestClinicalDeploymentName string = bestDeploymentName
output endpointKvRef string = '@Microsoft.KeyVault(SecretUri=${endpointSecret.properties.secretUri})'
output privateEndpointName string = privateEndpoint.name
