// deploy/azure/modules/keyvault.bicep
//
// Key Vault for every long-lived secret the Signacare API needs:
//
//   - DB_PASSWORD, DB_ADMIN_PASSWORD
//   - REDIS_PASSWORD
//   - JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
//   - PHI_ENCRYPTION_KEY (hex)
//   - BLIND_INDEX_KEY (hex, DIFFERENT from PHI_ENCRYPTION_KEY per NIST
//     SP 800-57 §8.2.3)
//   - PATIENT_APP_DEDUPE_PEPPER (hex, HMAC key for public registration dedupe)
//   - SESSION_SECRET
//   - SLACK_WEBHOOK_SECURITY, SLACK_WEBHOOK_OPS
//   - SENTRY_DSN
//   - OLLAMA_API_KEY (if the Ollama instance is on a private network)
//
// Access model:
//   - The App Service system-assigned managed identity gets secret-get
//     via Azure RBAC ("Key Vault Secrets User" role) assigned in
//     appservice.bicep — NOT via access policies. Access policies are
//     legacy; RBAC is the supported mode going forward.
//   - An admin AAD group gets "Key Vault Administrator" so ops can
//     rotate secrets. adminObjectId is the group's object ID.
//
// Soft-delete + purge-protection are enabled to meet ISO 27001 A.8.24
// (cryptographic controls) — a deleted secret is recoverable within
// 90 days, and purge-protection prevents even a tenant-admin from
// hard-deleting key material before that window expires.
//
// Enabled-for-template-deployment is OFF — secrets are written post-
// provision via `az keyvault secret set` or the rotation workflow,
// never via Bicep parameters that could leak into deployment history.

targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param tags object

@description('Object ID of the AAD group that should have Key Vault Administrator role.')
param adminObjectId string

var vaultName = '${namePrefix}-kv-${environment}'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    // Secrets are pushed by rotation scripts, not by deployments.
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enabledForDiskEncryption: false
    publicNetworkAccess: 'Enabled' // Restrict via network ACLs post-provision
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Key Vault Administrator role for the ops group.
// 00482a5a-887f-4fb3-b363-3b7fe8e74483 = Key Vault Administrator (built-in)
resource adminRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, adminObjectId, 'keyvault-admin')
  properties: {
    principalId: adminObjectId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '00482a5a-887f-4fb3-b363-3b7fe8e74483'
    )
  }
}

output vaultName string = vault.name
output vaultUri string = vault.properties.vaultUri
output vaultResourceId string = vault.id
