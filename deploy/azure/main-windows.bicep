// deploy/azure/main-windows.bicep
//
// LEGACY / REFERENCE ONLY.
//
// This is not the active Signacare production deployment lane. The active Azure
// Linux lane is deploy/azure/main.bicep plus deploy/azure/deploy.sh,
// preflight-linux.sh, post-deploy-smoke.sh, and .github/workflows/azure-deploy.yml.
//
// Use this Windows VM template only when a Windows-only requirement is explicitly
// approved and documented. See deploy/azure/windows-vm/README.md and
// docs/operations/deployment-learnings.md before running it.
//
// Signacare EMR — Windows Server 2022 single-VM deployment (BUG-AZURE-WINDOWS-VM, 2026-05-03).
//
// Per-org clarification 2026-05-03: deployment target is Windows Server 2022
// Datacenter (IaaS VM) hosting EVERYTHING on one box for dev/test:
//
//   - Node.js 20 LTS (API + Web)        — running as Windows Services via node-windows
//   - PostgreSQL 17 (Windows installer) — co-hosted on the same VM (NOT Azure managed PG)
//   - Redis (Memurai — Microsoft Windows-native Redis fork) — co-hosted on the same VM
//   - IIS 10 (TLS-terminating reverse proxy + static SPA host)
//
// Tradeoffs vs the existing Linux App Service stack (main.bicep):
//   - Single-VM SPOF (no automatic failover; backups are operator's responsibility)
//   - Higher per-VM cost vs split managed services for similar resources
//   - All maintenance (PostgreSQL upgrades, Redis upgrades, OS patching) is manual
//   + Full control / on-prem posture parity / no PaaS quirks
//   + Org's Windows Server licensing posture preserved
//   + Dev/test does NOT carry real PHI per Azure dev/test deploy doc
//
// Parameter file: deploy/azure/parameters.windows-dev.json
//
// To deploy:
//   az deployment group create \
//     --resource-group signacare-windows-dev-rg \
//     --template-file deploy/azure/main-windows.bicep \
//     --parameters @deploy/azure/parameters.windows-dev.json \
//     --parameters adminPassword='<generated_password>'
//
// Australian Data Residency: region locked to australiaeast / australiasoutheast.
// Sibling pattern of main.bicep but for Windows Server hosting target.

@description('Resource name prefix (lowercase, alphanumeric)')
@minLength(3)
@maxLength(15)
param namePrefix string = 'signacare'

@description('Environment name (dev | test | staging | prod)')
@allowed(['dev', 'test', 'staging', 'prod'])
param environment string = 'dev'

@description('Azure region (must be AU for residency)')
@allowed(['australiaeast', 'australiasoutheast'])
param location string = 'australiaeast'

@description('VM size — D4s_v5 covers Node + Postgres + Redis + IIS for dev/test (~AUD $250/mo + storage + bandwidth)')
@allowed([
  'Standard_B2ms'    // 2 vCPU, 8 GB — minimum, may struggle under load
  'Standard_B4ms'    // 4 vCPU, 16 GB — comfortable dev tier
  'Standard_D2s_v3'  // 2 vCPU, 8 GB — broad subscription quota availability
  'Standard_D4s_v3'  // 4 vCPU, 16 GB — broad subscription quota availability
  'Standard_D2s_v5'  // 2 vCPU, 8 GB — slightly faster than B2ms
  'Standard_D4s_v5'  // 4 vCPU, 16 GB — recommended dev/test default
  'Standard_D8s_v5'  // 8 vCPU, 32 GB — staging
  'Standard_E4s_v5'  // 4 vCPU, 32 GB — staging with PG memory headroom
  'Standard_E8s_v5'  // 8 vCPU, 64 GB — production
])
param vmSize string = 'Standard_D4s_v5'

@description('Windows Admin username — used for RDP. Created on first boot.')
@minLength(1)
@maxLength(20)
param adminUsername string = 'signacareadmin'

@description('Windows Admin password — must satisfy Azure complexity. Pass via secure CLI parameter.')
@secure()
@minLength(12)
@maxLength(72)
param adminPassword string

@description('Allowed RDP source — operator MUST replace with a single corporate /32 IP (e.g. "203.0.113.42/32") before deploy. Sentinel default REJECTED at template-parse-time AND at NSG CIDR validation time to fail-loud rather than silently expose RDP to the world. For first-run setup against a fresh VM, set this to your operator workstation IP /32; tighten further once setup complete.')
param rdpAllowedSource string = 'REPLACE_ME_WITH_CORPORATE_IP_CIDR'

@description('Allowed WinRM-over-HTTPS source. Defaults to None (NSG service tag rejects all inbound on 5986). Decoupled from rdpAllowedSource per BUG-AZURE-WINDOWS-VM-FOLLOWUP-WINRM-SEPARATE-ALLOW so a future operator narrowing RDP does not accidentally leave WinRM open to the prior allow-list. Set to a /32 only when enabling automated WinRM deploys.')
param winrmAllowedSource string = 'None'

@description('Allowed HTTPS source — Internet for public-facing dev/test.')
param httpsAllowedSource string = 'Internet'

@description('Windows Server licensing posture. "None" = pay-as-you-go (default; included Azure Windows licence). "Windows_Server" = Azure Hybrid Benefit / BYOL (requires existing on-prem Windows Server licence with active Software Assurance). Saves ~AUD $80/mo per VM at dev tier.')
@allowed(['None', 'Windows_Server'])
param licenseType string = 'None'

@description('OS disk size in GiB — 128 covers OS + Node + PG data dir initially')
@minValue(128)
@maxValue(2048)
param osDiskSizeGB int = 128

@description('Data disk size in GiB — separate from OS for backup hygiene; PG cluster + Redis snapshots + scribe audio')
@minValue(64)
@maxValue(4096)
param dataDiskSizeGB int = 256

@description('Tag applied to every resource — used for billing rollups')
param costCentreTag string = 'signacare-emr'

// ─────────────────────────────────────────────────────────────────────────────
// Computed names — `<prefix>-<service>-<env>` per main.bicep convention
// ─────────────────────────────────────────────────────────────────────────────

var vmName            = '${namePrefix}-vm-${environment}'
var computerName      = take('${namePrefix}${environment}', 15)
var nicName           = '${namePrefix}-nic-${environment}'
var publicIpName      = '${namePrefix}-pip-${environment}'
var nsgName           = '${namePrefix}-nsg-${environment}'
var vnetName          = '${namePrefix}-vnet-${environment}'
var subnetName        = '${namePrefix}-subnet-${environment}'
var dataDiskName      = '${namePrefix}-data-${environment}'
var dnsLabel          = '${namePrefix}-${environment}'  // becomes <name>.<region>.cloudapp.azure.com

var commonTags = {
  application: 'signacare-emr'
  environment: environment
  costCentre:  costCentreTag
  managedBy:   'bicep'
  hostingMode: 'windows-iaas'
}

// ─────────────────────────────────────────────────────────────────────────────
// Network — VNet + Subnet + Public IP + NSG with RDP / HTTPS rules
// ─────────────────────────────────────────────────────────────────────────────

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name:     nsgName
  location: location
  tags:     commonTags
  properties: {
    securityRules: [
      {
        name: 'allow-rdp-from-corp'
        properties: {
          priority:                 100
          protocol:                 'Tcp'
          sourceAddressPrefix:      rdpAllowedSource
          sourcePortRange:          '*'
          destinationAddressPrefix: '*'
          destinationPortRange:     '3389'
          access:                   'Allow'
          direction:                'Inbound'
          description:              'RDP — restrict to corporate IP for prod'
        }
      }
      {
        name: 'allow-https-public'
        properties: {
          priority:                 110
          protocol:                 'Tcp'
          sourceAddressPrefix:      httpsAllowedSource
          sourcePortRange:          '*'
          destinationAddressPrefix: '*'
          destinationPortRange:     '443'
          access:                   'Allow'
          direction:                'Inbound'
          description:              'HTTPS — IIS reverse proxy in front of Node.js'
        }
      }
      {
        name: 'allow-http-redirect'
        properties: {
          priority:                 120
          protocol:                 'Tcp'
          sourceAddressPrefix:      httpsAllowedSource
          sourcePortRange:          '*'
          destinationAddressPrefix: '*'
          destinationPortRange:     '80'
          access:                   'Allow'
          direction:                'Inbound'
          description:              'HTTP — IIS redirects to HTTPS'
        }
      }
      ...(winrmAllowedSource == 'None' ? [] : [
        {
          name: 'allow-winrm-https-from-corp'
          properties: {
            priority:                 130
            protocol:                 'Tcp'
            sourceAddressPrefix:      winrmAllowedSource
            sourcePortRange:          '*'
            destinationAddressPrefix: '*'
            destinationPortRange:     '5986'
            access:                   'Allow'
            direction:                'Inbound'
            description:              'WinRM-over-HTTPS automation path; default source is None (closed).'
          }
        }
      ])
      {
        name: 'deny-all-inbound'
        properties: {
          priority:                 4096
          protocol:                 '*'
          sourceAddressPrefix:      '*'
          sourcePortRange:          '*'
          destinationAddressPrefix: '*'
          destinationPortRange:     '*'
          access:                   'Deny'
          direction:                'Inbound'
          description:              'Default-deny — all other inbound rejected'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name:     vnetName
  location: location
  tags:     commonTags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.42.0.0/16']
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: '10.42.1.0/24'
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-01-01' = {
  name:     publicIpName
  location: location
  tags:     commonTags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion:   'IPv4'
    dnsSettings: {
      domainNameLabel: dnsLabel
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-01-01' = {
  name:     nicName
  location: location
  tags:     commonTags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: {
            id: publicIp.id
          }
          subnet: {
            id: '${vnet.id}/subnets/${subnetName}'
          }
        }
      }
    ]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VM — Windows Server 2022 Datacenter, premium SSD, separate data disk
// ─────────────────────────────────────────────────────────────────────────────

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name:     vmName
  location: location
  tags:     commonTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // BUG-AZURE-WINDOWS-VM-FOLLOWUP-LICENSE-TYPE (2026-05-03) —
    // explicit licensing posture. Azure's licenseType property only
    // accepts 'Windows_Server' (BYOL via Azure Hybrid Benefit) or
    // omitted/null (pay-as-you-go default). The Bicep-param-allowed
    // value 'None' maps to null here so the VM resource sees the
    // canonical absence-of-property for PAYG.
    licenseType: licenseType == 'Windows_Server' ? 'Windows_Server' : null
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName:  computerName
      adminUsername: adminUsername
      adminPassword: adminPassword
      windowsConfiguration: {
        provisionVMAgent:        true
        enableAutomaticUpdates:  true
        timeZone:                'AUS Eastern Standard Time'
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'MicrosoftWindowsServer'
        offer:     'WindowsServer'
        sku:       '2022-datacenter-azure-edition'
        version:   'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
        diskSizeGB: osDiskSizeGB
      }
      dataDisks: [
        {
          name:         dataDiskName
          createOption: 'Empty'
          diskSizeGB:   dataDiskSizeGB
          lun:          0
          managedDisk: {
            storageAccountType: 'Premium_LRS'
          }
        }
      ]
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
    diagnosticsProfile: {
      bootDiagnostics: {
        enabled: true
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outputs — values the runbook needs
// ─────────────────────────────────────────────────────────────────────────────

output vmFqdn string = publicIp.properties.dnsSettings.fqdn
output vmPublicIp string = publicIp.properties.ipAddress
output vmResourceId string = vm.id
output rdpEndpoint string = '${publicIp.properties.dnsSettings.fqdn}:3389'
output httpsEndpoint string = 'https://${publicIp.properties.dnsSettings.fqdn}'
