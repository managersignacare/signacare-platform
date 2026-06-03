// deploy/azure/modules/storage.bicep
//
// Storage Account + blob container for the BlobStorage facade. The app
// writes patient attachments (imaging, pathology PDFs, signed letters,
// scribe audio) to this container.
//
// Security model:
//   - Public blob access disabled at the account level. All reads go
//     through short-lived SAS URLs minted by the API with a maximum
//     TTL of 10 minutes, matching the behaviour of the S3BlobStorage
//     backend in apps/api/src/shared/blobStorage.ts.
//   - Soft-delete + versioning enabled — a deleted attachment can be
//     recovered within 14 days; prior versions are kept forever until
//     an explicit retention policy trims them.
//   - TLS 1.2 minimum, no cleartext HTTP.
//   - LRS replication for staging, GRS for prod (parameterised via
//     accountSku below — override in parameters.prod.json).
//
// Standards: Australian Privacy Act APP 11 (reasonable steps to
// protect), ISO 27001 A.8.14 (storage media).

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param namePrefix string
param environment string
param location string
param tags object

@description('Storage replication SKU. GRS for prod, LRS for staging.')
param accountSku string = environment == 'prod' ? 'Standard_GRS' : 'Standard_LRS'

// Storage account names must be 3-24 lowercase alphanumeric chars.
var accountName = toLower('${namePrefix}st${environment}')
var blobContainerName = 'attachments'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  sku: {
    name: accountSku
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true // API uses account key via Key Vault; disable when migrating to MI-only
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: {
          enabled: true
          keyType: 'Account'
        }
        file: {
          enabled: true
          keyType: 'Account'
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    changeFeed: {
      enabled: false
    }
  }
}

resource attachmentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'signacare-patient-attachments'
      classification: 'phi'
    }
  }
}

output accountName string = storageAccount.name
output accountResourceId string = storageAccount.id
output blobContainerName string = attachmentsContainer.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
