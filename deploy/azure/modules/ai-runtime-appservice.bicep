// deploy/azure/modules/ai-runtime-appservice.bicep
//
// Dedicated Linux App Services for the AI runtime. This keeps Ollama and
// Whisper as independently deployable digest-pinned services:
//
//   - signacare-ollama-<env>
//   - signacare-whisper-<env>
//
// Staging may restrict public ingress to API App Service outbound IPs via
// deploy/azure/deploy-ai-runtime-services.sh. Production should move these
// services behind private networking or a managed model endpoint before broad
// clinical rollout.

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

@description('AI runtime App Service Plan SKU.')
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
param aiRuntimePlanSku string = 'P1v3'

@description('Ollama model baked into the deployed image.')
param ollamaModel string = 'llama3.2:signacare-35f39aa1'

@description('Ollama model manifest digest baked into the deployed image.')
param ollamaModelManifestSha256 string = 'sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58'

@description('Whisper model baked into the deployed image.')
param whisperModel string = 'small'

@description('Whisper model SHA-256 baked into the deployed image.')
param whisperModelSha256 string = '9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794'

var planName = '${namePrefix}-ai-asp-${environment}'
var ollamaAppName = '${namePrefix}-ollama-${environment}'
var whisperAppName = '${namePrefix}-whisper-${environment}'
var acrName = '${namePrefix}cr${environment}'
var ollamaImage = '${acrName}.azurecr.io/signacare-ollama:bootstrap'
var whisperImage = '${acrName}.azurecr.io/signacare-whisper:bootstrap'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  sku: {
    name: aiRuntimePlanSku
  }
  kind: 'linux'
  properties: {
    reserved: true
    zoneRedundant: environment == 'prod'
  }
}

resource ollamaApp 'Microsoft.Web/sites@2023-12-01' = {
  name: ollamaAppName
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
      linuxFxVersion: 'DOCKER|${ollamaImage}'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/tags'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '11434' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://${acrName}.azurecr.io' }
        { name: 'OLLAMA_HOST', value: '0.0.0.0:11434' }
        { name: 'OLLAMA_MODELS', value: '/opt/signacare/ollama/models' }
        { name: 'OLLAMA_REQUIRE_MODELS', value: ollamaModel }
        { name: 'OLLAMA_KEEP_ALIVE', value: '-1' }
        { name: 'OLLAMA_MODEL', value: ollamaModel }
        { name: 'OLLAMA_MODEL_VERSION', value: '${ollamaModel}@${ollamaModelManifestSha256}' }
        { name: 'OLLAMA_MODEL_MANIFEST_SHA256', value: ollamaModelManifestSha256 }
      ]
    }
  }
}

resource whisperApp 'Microsoft.Web/sites@2023-12-01' = {
  name: whisperAppName
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
      linuxFxVersion: 'DOCKER|${whisperImage}'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://${acrName}.azurecr.io' }
        { name: 'PORT', value: '8080' }
        { name: 'WHISPER_HOST', value: '0.0.0.0' }
        { name: 'WHISPER_DEVICE', value: 'cpu' }
        { name: 'WHISPER_MODEL', value: whisperModel }
        { name: 'WHISPER_MODEL_SHA256', value: whisperModelSha256 }
        { name: 'WHISPER_PRELOAD_MODEL', value: 'true' }
        { name: 'WHISPER_WORKERS', value: '1' }
        { name: 'WHISPER_THREADS', value: '2' }
        { name: 'WHISPER_TIMEOUT_SECONDS', value: '900' }
        { name: 'WHISPER_CACHE_DIR', value: '/opt/signacare/whisper/cache' }
      ]
    }
  }
}

output planName string = plan.name
output ollamaAppName string = ollamaApp.name
output whisperAppName string = whisperApp.name
output ollamaDefaultHostName string = ollamaApp.properties.defaultHostName
output whisperDefaultHostName string = whisperApp.properties.defaultHostName
