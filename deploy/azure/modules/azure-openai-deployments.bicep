// deploy/azure/modules/azure-openai-deployments.bicep
//
// Second-phase Azure OpenAI model deployments. The account itself is
// provisioned by azure-openai.bicep; this module runs only after that
// deployment reaches Succeeded so Cognitive Services no longer rejects child
// deployments while the account is still in Accepted.

targetScope = 'resourceGroup'

@description('Existing Azure OpenAI account name.')
param openAiAccountName string

@description('Deployment name for the fast_clinical alias.')
param fastClinicalDeploymentName string

@description('Deployment name for the best_clinical alias.')
param bestClinicalDeploymentName string

@description('Model name for the fast clinical deployment.')
param fastClinicalModelName string

@description('Pinned model version for the fast clinical deployment.')
param fastClinicalModelVersion string

@description('Model name for the best clinical deployment.')
param bestClinicalModelName string

@description('Pinned model version for the best clinical deployment.')
param bestClinicalModelVersion string

@description('Deployment SKU for the fast clinical alias.')
param fastClinicalDeploymentSku string

@description('Deployment SKU for the best clinical alias.')
param bestClinicalDeploymentSku string

@description('TPM capacity for the fast clinical deployment.')
param fastClinicalCapacity int

@description('TPM capacity for the best clinical deployment.')
param bestClinicalCapacity int

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: openAiAccountName
}

resource fastClinicalDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: fastClinicalDeploymentName
  sku: {
    name: fastClinicalDeploymentSku
    capacity: fastClinicalCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: fastClinicalModelName
      version: fastClinicalModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

resource bestClinicalDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: bestClinicalDeploymentName
  sku: {
    name: bestClinicalDeploymentSku
    capacity: bestClinicalCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: bestClinicalModelName
      version: bestClinicalModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

output fastClinicalDeploymentName string = fastClinicalDeployment.name
output bestClinicalDeploymentName string = bestClinicalDeployment.name
