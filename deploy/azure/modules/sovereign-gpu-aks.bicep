// deploy/azure/modules/sovereign-gpu-aks.bicep
//
// Phase 5 sovereign-GPU lane provisioning.
//
// Provisions:
//
//   - AKS cluster `<prefix>-aks-<env>` with:
//       * Private API server (the control plane is reachable only from
//         inside the VNet — no public Kubernetes API endpoint).
//       * Workload Identity + OIDC issuer enabled so workloads can pull
//         secrets from Key Vault via the CSI driver without static SA
//         tokens.
//       * Image Cleaner enabled.
//       * Defender + Azure Policy add-ons enabled.
//   - Three node pools (separation is a HARD requirement for Phase 5 #3):
//       * `sys`       — system pool (no GPU), runs control-plane add-ons.
//       * `inference` — GPU pool TAINTED with `signacare.io/lane=inference`.
//                       NoSchedule taint means training pods MUST NOT land
//                       here. Auto-scale [1..N], min 1.
//       * `training`  — GPU pool TAINTED with `signacare.io/lane=training`.
//                       Scale-to-zero. Spins up only for scheduled training
//                       jobs. NoSchedule taint means inference pods MUST
//                       NOT land here.
//   - The Ollama / vLLM container that runs on the inference pool
//     references the model by IMMUTABLE digest (Phase 5 #2). The image
//     itself bakes the model under `/home/ollama/models` with a manifest
//     SHA-256 baked into the OLLAMA_MODEL_MANIFEST_SHA256 env var (the
//     existing pattern from ai-runtime-appservice.bicep). There is NO
//     `ollama pull` at runtime.
//
// The cluster sits inside the `aks-system` / `aks-inference` /
// `aks-training` subnets created by `network-private.bicep`.

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(12)
param namePrefix string

@allowed(['prod', 'staging'])
param environment string

param location string
param tags object

@description('ID of the AKS system subnet from network-private module.')
@minLength(1)
param aksSystemSubnetId string

@description('ID of the AKS inference subnet from network-private module.')
@minLength(1)
param aksInferenceSubnetId string

@description('ID of the AKS training subnet from network-private module.')
@minLength(1)
param aksTrainingSubnetId string

@description('System pool VM size (no GPU).')
param systemVmSize string = 'Standard_D4ds_v5'

@description('Inference pool VM size. Default Standard_NC4as_T4_v3 = 1× T4 GPU, 4 vCPU. Use Standard_NC24ads_A100_v4 for A100 production.')
param inferenceVmSize string = 'Standard_NC4as_T4_v3'

@description('Inference pool minimum node count (always-on for SLO).')
param inferenceMinNodes int = 1

@description('Inference pool maximum node count.')
param inferenceMaxNodes int = 4

@description('Training pool VM size. Default Standard_NC4as_T4_v3; scale to A100 for serious training runs.')
param trainingVmSize string = 'Standard_NC4as_T4_v3'

@description('Training pool maximum node count. Min is always 0 (scale-to-zero between training runs).')
param trainingMaxNodes int = 4

@description('Inference container image. MUST be an ACR digest ref, e.g. <acr>.azurecr.io/signacare-ollama-sovereign@sha256:<digest>.')
@minLength(1)
param inferenceImage string

@description('Immutable model manifest SHA-256. Phase 5 #2 — no runtime pulls.')
param inferenceModelManifestSha256 string

@description('AKS Kubernetes version (e.g. 1.30.4). Pin to avoid silent rollover.')
param kubernetesVersion string = '1.30.4'

var clusterName = '${namePrefix}-aks-${environment}'

resource aks 'Microsoft.ContainerService/managedClusters@2024-09-01' = {
  name: clusterName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    kubernetesVersion: kubernetesVersion
    dnsPrefix: clusterName
    // Phase 5 — private API server. No public Kubernetes endpoint.
    apiServerAccessProfile: {
      enablePrivateCluster: true
      privateDNSZone: 'system'
    }
    enableRBAC: true
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
      imageCleaner: {
        enabled: true
        intervalHours: 24
      }
      defender: {
        securityMonitoring: {
          enabled: true
        }
      }
    }
    addonProfiles: {
      azurepolicy: {
        enabled: true
      }
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: {
          enableSecretRotation: 'true'
          rotationPollInterval: '5m'
        }
      }
    }
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'azure'
      loadBalancerSku: 'standard'
      outboundType: 'loadBalancer'
    }
    agentPoolProfiles: [
      {
        name: 'sys'
        mode: 'System'
        vmSize: systemVmSize
        count: 1
        minCount: 1
        maxCount: 3
        enableAutoScaling: true
        osType: 'Linux'
        osSKU: 'AzureLinux'
        type: 'VirtualMachineScaleSets'
        vnetSubnetID: aksSystemSubnetId
        availabilityZones: ['1', '2', '3']
        nodeLabels: {
          'signacare.io/pool': 'system'
        }
      }
    ]
  }
}

// Inference node pool. Phase 5 #3 — GPU taint enforces NoSchedule for
// any pod that doesn't tolerate `signacare.io/lane=inference`.
resource inferencePool 'Microsoft.ContainerService/managedClusters/agentPools@2024-09-01' = {
  parent: aks
  name: 'inference'
  properties: {
    mode: 'User'
    vmSize: inferenceVmSize
    count: inferenceMinNodes
    minCount: inferenceMinNodes
    maxCount: inferenceMaxNodes
    enableAutoScaling: true
    osType: 'Linux'
    osSKU: 'Ubuntu'
    type: 'VirtualMachineScaleSets'
    vnetSubnetID: aksInferenceSubnetId
    availabilityZones: ['1', '2', '3']
    // The taint is the structural enforcement of Phase 5 #3 (inference
    // and training MUST live on separate node pools). Workloads tolerate
    // the matching taint to be scheduled here.
    nodeTaints: [
      'signacare.io/lane=inference:NoSchedule'
    ]
    nodeLabels: {
      'signacare.io/pool': 'inference'
      'signacare.io/gpu': 'true'
      'signacare.io/model-manifest-sha256': inferenceModelManifestSha256
    }
    tags: union(tags, {
      'signacare.io/inference-image': inferenceImage
    })
  }
}

// Training node pool. Scale-to-zero baseline; the operator scales it up
// only when launching a training run via runbook + audit row.
resource trainingPool 'Microsoft.ContainerService/managedClusters/agentPools@2024-09-01' = {
  parent: aks
  name: 'training'
  properties: {
    mode: 'User'
    vmSize: trainingVmSize
    count: 0
    minCount: 0
    maxCount: trainingMaxNodes
    enableAutoScaling: true
    osType: 'Linux'
    osSKU: 'Ubuntu'
    type: 'VirtualMachineScaleSets'
    vnetSubnetID: aksTrainingSubnetId
    availabilityZones: ['1', '2', '3']
    nodeTaints: [
      'signacare.io/lane=training:NoSchedule'
    ]
    nodeLabels: {
      'signacare.io/pool': 'training'
      'signacare.io/gpu': 'true'
    }
  }
  dependsOn: [
    inferencePool
  ]
}

output clusterName string = aks.name
output clusterId string = aks.id
output clusterPrincipalId string = aks.identity.principalId
output oidcIssuerUrl string = aks.properties.oidcIssuerProfile.issuerURL
output inferencePoolName string = inferencePool.name
output trainingPoolName string = trainingPool.name
output inferenceModelManifestSha256 string = inferenceModelManifestSha256
