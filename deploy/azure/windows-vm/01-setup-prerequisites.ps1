# -----------------------------------------------------------------------------
# Signacare EMR - Windows Server 2022 first-run setup script
# 01-setup-prerequisites.ps1
#
# RUN THIS ONCE on a fresh Windows Server 2022 Datacenter VM after first RDP.
# Installs Node.js 20 LTS, PostgreSQL 17, Memurai (Redis-Windows fork), IIS
# with URL Rewrite + ARR, and configures the Windows Firewall.
#
# REQUIRES:
#   - Run as Administrator (right-click -> Run with PowerShell as Administrator)
#   - Internet access from the VM (default; egress allowed)
#   - Empty data disk attached at LUN 0 (provisioned by main-windows.bicep)
#
# IDEMPOTENCY:
#   Each install step checks for prior installation. Safe to re-run if a
#   step partially fails - pick up where it left off.
#
# AUSTRALIAN COMPLIANCE NOTE:
#   This setup is for the dev/test tier ONLY. Real PHI MUST NOT touch the
#   dev/test environment until pre-staging gate passes (see plan).
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$PostgresVersion = '17.0',
    [Parameter()] [string]$NodeVersion     = '20.19.0',
    [Parameter()] [string]$DataDriveLetter = 'D',
    [Parameter()] [bool]$RelocatePostgresCluster = $false
)

$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'  # speeds up Invoke-WebRequest

function Write-Step($msg) {
    Write-Host "`n[STEP] $msg" -ForegroundColor Cyan
}

function Test-AdminContext {
    $current = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run as Administrator.'
    }
}

# -----------------------------------------------------------------------------
# 0. Pre-flight
# -----------------------------------------------------------------------------
Test-AdminContext
Write-Step '0/8 - Pre-flight checks complete (running as Administrator)'

# -----------------------------------------------------------------------------
# 1. Initialize and format the data disk (LUN 0) -> mount as D:
# -----------------------------------------------------------------------------
Write-Step "1/8 - Initialize data disk and mount as ${DataDriveLetter}:"
$candidateDisk = Get-Disk | Where-Object PartitionStyle -eq 'RAW' | Select-Object -First 1
if (-not $candidateDisk) {
    # Recovery path: some Azure images arrive with a GPT data disk that only
    # has reserved partitions (no mounted volume). Treat it as a candidate.
    $candidateDisk = Get-Disk |
        Where-Object { $_.Number -ne 0 -and $_.Size -gt 50GB } |
        Where-Object {
            $parts = Get-Partition -DiskNumber $_.Number -ErrorAction SilentlyContinue
            if (-not $parts) { return $true }
            $hasMounted = $parts | Where-Object { $_.DriveLetter -ne [char]0 -and $_.DriveLetter -ne $null }
            return -not $hasMounted
        } |
        Sort-Object Size -Descending |
        Select-Object -First 1
}

if ($candidateDisk) {
    $existingPartition = Get-Partition -DriveLetter $DataDriveLetter -ErrorAction SilentlyContinue
    if ($existingPartition) {
        # If the target letter is already on the candidate disk, keep it.
        if ($existingPartition.DiskNumber -ne $candidateDisk.Number) {
            $fallbackLetter = @('T','U','V','W','X','Y','Z') |
                Where-Object { -not (Get-Partition -DriveLetter $_ -ErrorAction SilentlyContinue) } |
                Select-Object -First 1
            if (-not $fallbackLetter) {
                throw "Drive letter ${DataDriveLetter}: is already in use and no fallback letter is available to reassign it."
            }
            try {
                Set-Partition -DriveLetter $DataDriveLetter -NewDriveLetter $fallbackLetter -ErrorAction Stop
                Write-Host "  Reassigned existing ${DataDriveLetter}: partition to ${fallbackLetter}: to free ${DataDriveLetter}: for Signacare data"
            }
            catch {
                # Some Azure images expose a non-movable volume on D:.
                # Fall back to a stable free letter for Signacare data rather than hard failing.
                Write-Warning "  Could not reassign existing ${DataDriveLetter}: drive ($($_.Exception.Message)). Using ${fallbackLetter}: for Signacare data drive."
                $DataDriveLetter = $fallbackLetter
            }
        }
    }

    if ($candidateDisk.PartitionStyle -eq 'RAW') {
        $candidateDisk = $candidateDisk | Initialize-Disk -PartitionStyle GPT -PassThru
    }

    $mountedPartition = Get-Partition -DiskNumber $candidateDisk.Number -ErrorAction SilentlyContinue |
        Where-Object { $_.DriveLetter -ne [char]0 -and $_.DriveLetter -ne $null } |
        Select-Object -First 1

    if (-not $mountedPartition) {
        $dataPartition = Get-Partition -DiskNumber $candidateDisk.Number -ErrorAction SilentlyContinue |
            Where-Object { $_.Type -eq 'Basic' } |
            Sort-Object Size -Descending |
            Select-Object -First 1

        if (-not $dataPartition) {
            $dataPartition = New-Partition -DiskNumber $candidateDisk.Number -UseMaximumSize
            Format-Volume -Partition $dataPartition -FileSystem NTFS -NewFileSystemLabel 'SignacareData' -Confirm:$false | Out-Null
        }

        if ($dataPartition.DriveLetter -eq [char]0 -or $dataPartition.DriveLetter -eq $null) {
            Set-Partition -DiskNumber $candidateDisk.Number -PartitionNumber $dataPartition.PartitionNumber -NewDriveLetter $DataDriveLetter
        } elseif ($dataPartition.DriveLetter -ne $DataDriveLetter) {
            Set-Partition -DiskNumber $candidateDisk.Number -PartitionNumber $dataPartition.PartitionNumber -NewDriveLetter $DataDriveLetter
        }

        Write-Host "  Data disk mounted at ${DataDriveLetter}: (Disk $($candidateDisk.Number))"
    } else {
        Write-Host "  Candidate data disk already has a mounted volume - skipping format"
    }
} else {
    if (Test-Path "${DataDriveLetter}:\") {
        Write-Host "  Data disk already initialised at ${DataDriveLetter}: - skipping"
    } else {
        Write-Warning "  No candidate data disk found AND ${DataDriveLetter}: not present. Verify the VM has a data disk attached."
    }
}

# -----------------------------------------------------------------------------
# 2. Create directory layout on the data drive
# -----------------------------------------------------------------------------
Write-Step '2/8 - Create directory layout'
$dirs = @(
    "${DataDriveLetter}:\Signacare",
    "${DataDriveLetter}:\Signacare\app",
    "${DataDriveLetter}:\Signacare\app\api",
    "${DataDriveLetter}:\Signacare\app\web",
    "${DataDriveLetter}:\Signacare\uploads",
    "${DataDriveLetter}:\Signacare\logs",
    "${DataDriveLetter}:\Signacare\backups",
    "${DataDriveLetter}:\Signacare\redis-data",
    "${DataDriveLetter}:\Signacare\postgres-data"
)
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  Created $dir"
    }
}

# -----------------------------------------------------------------------------
# 3. Install Chocolatey package manager (used to install Node.js + Postgres + Memurai)
# -----------------------------------------------------------------------------
Write-Step '3/8 - Install Chocolatey'
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
    Write-Host '  Chocolatey installed'
} else {
    Write-Host '  Chocolatey already installed - skipping'
}

# -----------------------------------------------------------------------------
# 4. Install Node.js 20 LTS via Chocolatey
# -----------------------------------------------------------------------------
Write-Step "4/8 - Install Node.js $NodeVersion"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    choco install nodejs-lts --version=$NodeVersion --yes --no-progress
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
    Write-Host "  Node.js $(node --version) installed"
} else {
    $current = (node --version) -replace '^v', ''
    Write-Host "  Node.js v$current already installed - skipping (target was $NodeVersion)"
}
# Install node-windows globally so the API can register as a Windows Service
if (-not (Test-Path 'C:\ProgramData\npm-cache\node-windows')) {
    # Execute via cmd and redirect output to file so benign npm notices do not
    # get promoted to terminating NativeCommandError records under strict mode.
    $npmLog = 'C:\Setup\npm-node-windows.log'
    cmd /c "npm install -g node-windows@latest > `"$npmLog`" 2>&1"
    $npmExit = $LASTEXITCODE
    if (Test-Path $npmLog) {
        Get-Content $npmLog | ForEach-Object { Write-Host $_ }
    }
    if ($npmExit -ne 0) {
        throw "npm install -g node-windows failed (exit=$npmExit)"
    }
    Write-Host '  node-windows installed globally'
}

# -----------------------------------------------------------------------------
# 5. Install PostgreSQL 17 with data dir on D:\Signacare\postgres-data
# -----------------------------------------------------------------------------
Write-Step "5/8 - Install PostgreSQL $PostgresVersion"
$pgService = Get-Service -Name 'postgresql-x64-17' -ErrorAction SilentlyContinue
if (-not $pgService) {
    # Generate a secure password for the postgres superuser; emit to a local
    # file the operator MUST move to Key Vault and then delete locally.
    $pgPassword = -join ((48..57) + (65..90) + (97..122) + (33,35,36,37,38,42,43,45,61,63,64) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    $pgPasswordFile = "${DataDriveLetter}:\Signacare\postgres-data\superuser-password.txt"
    Set-Content -Path $pgPasswordFile -Value $pgPassword -NoNewline
    Write-Host "  Generated postgres superuser password - saved to $pgPasswordFile"
    Write-Host '  *** IMPORTANT: Move this password to Azure Key Vault, then DELETE the local file ***' -ForegroundColor Yellow

    choco install postgresql17 --version=$PostgresVersion --params "/Password:$pgPassword" --yes --no-progress
    Write-Host "  PostgreSQL $PostgresVersion installed"

    if ($RelocatePostgresCluster) {
        Write-Host '  RelocatePostgresCluster=true: relocating cluster to data drive...'
        Stop-Service -Name 'postgresql-x64-17' -Force
        $defaultDataDir = 'C:\Program Files\PostgreSQL\17\data'
        $newDataDir     = "${DataDriveLetter}:\Signacare\postgres-data\cluster"
        if (-not (Test-Path $newDataDir)) {
            Copy-Item -Path $defaultDataDir -Destination $newDataDir -Recurse -Force
            # Update the service registry to point at the new data dir
            $svcKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\postgresql-x64-17'
            $imagePath = (Get-ItemProperty -Path $svcKey).ImagePath
            $newImagePath = $imagePath -replace [regex]::Escape($defaultDataDir), $newDataDir
            Set-ItemProperty -Path $svcKey -Name ImagePath -Value $newImagePath
            Rename-Item -Path $defaultDataDir -NewName "${defaultDataDir}.relocated-$(Get-Date -Format yyyyMMdd-HHmmss)"
        }
    } else {
        Write-Host '  RelocatePostgresCluster=false: keeping PostgreSQL cluster at default data directory for deterministic bootstrap'
    }
    Start-Service -Name 'postgresql-x64-17'
    if ($RelocatePostgresCluster) {
        Write-Host "  PostgreSQL cluster relocated to ${DataDriveLetter}:\\Signacare\\postgres-data\\cluster"
    } else {
        Write-Host '  PostgreSQL service started using default cluster path'
    }
} else {
    Write-Host '  PostgreSQL already installed - validating service health'
    $pgSvc = Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'"
    $imagePath = $pgSvc.PathName
    $dataDir = $null
    if ($imagePath -match '-D\s+"([^"]+)"') {
        $dataDir = $matches[1]
    }

    if ($dataDir -and -not (Test-Path $dataDir)) {
        Write-Warning "  PostgreSQL data directory missing at $dataDir. Attempting service-path repair."
        $defaultDataDir = 'C:\Program Files\PostgreSQL\17\data'
        $candidateDataDir = $null
        if (Test-Path $defaultDataDir) {
            $candidateDataDir = $defaultDataDir
        } else {
            $relocated = Get-ChildItem 'C:\Program Files\PostgreSQL\17' -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'data.relocated-*' } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            if ($relocated) {
                $candidateDataDir = $relocated.FullName
            }
        }

        if (-not $candidateDataDir) {
            throw "PostgreSQL cluster path missing and no fallback cluster found (checked $defaultDataDir and data.relocated-*)."
        }

        $svcKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\postgresql-x64-17'
        $newImagePath = $imagePath -replace [regex]::Escape($dataDir), $candidateDataDir
        Set-ItemProperty -Path $svcKey -Name ImagePath -Value $newImagePath
        Write-Host "  Repointed PostgreSQL service data dir to $candidateDataDir"
    }

    try {
        Start-Service -Name 'postgresql-x64-17' -ErrorAction Stop
        Write-Host '  PostgreSQL service started'
    } catch {
        Write-Warning "  PostgreSQL start failed: $($_.Exception.Message)"
        throw
    }
}

# -----------------------------------------------------------------------------
# 6. Install Memurai (Redis-API-compatible Windows Server)
# -----------------------------------------------------------------------------
Write-Step '6/8 - Install Memurai (Redis-Windows fork)'
$memuraiService = Get-Service -Name 'Memurai' -ErrorAction SilentlyContinue
if (-not $memuraiService) {
    choco install memurai-developer --yes --no-progress
    Write-Host '  Memurai (developer edition) installed - listens on 127.0.0.1:6379'
    # Production deploys must use the licensed Memurai Enterprise edition; dev
    # tier on developer SKU is acceptable per Memurai EULA.
} else {
    Write-Host '  Memurai already installed - skipping'
}

# -----------------------------------------------------------------------------
# 7. Enable IIS + URL Rewrite + ARR (Application Request Routing)
# -----------------------------------------------------------------------------
Write-Step '7/8 - Enable IIS + URL Rewrite + ARR'
$iisFeatures = @(
    'Web-Server',
    'Web-WebServer',
    'Web-Common-Http',
    'Web-Static-Content',
    'Web-Default-Doc',
    'Web-Dir-Browsing',
    'Web-Http-Errors',
    'Web-Http-Redirect',
    'Web-Health',
    'Web-Http-Logging',
    'Web-Performance',
    'Web-Stat-Compression',
    'Web-Security',
    'Web-Filtering',
    'Web-Mgmt-Tools',
    'Web-Mgmt-Console',
    'Web-Scripting-Tools'
)
foreach ($feat in $iisFeatures) {
    $state = (Get-WindowsFeature -Name $feat).InstallState
    if ($state -ne 'Installed') {
        Install-WindowsFeature -Name $feat -IncludeManagementTools | Out-Null
        Write-Host "  Installed $feat"
    }
}
# URL Rewrite + ARR via Chocolatey (these are the IIS modules that allow
# IIS to reverse-proxy to Node.js running on localhost:4000)
choco install urlrewrite --yes --no-progress
choco install iis-arr --yes --no-progress
Write-Host '  URL Rewrite + ARR installed'
# Enable ARR proxy mode
& "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.webServer/proxy /enabled:"True" /commit:apphost

# -----------------------------------------------------------------------------
# 8. Configure Windows Firewall
# -----------------------------------------------------------------------------
Write-Step '8/8 - Configure Windows Firewall (allow 80/443 inbound; block PG/Redis from outside)'
# Allow HTTP/HTTPS via IIS
New-NetFirewallRule -DisplayName 'Signacare-HTTP'  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName 'Signacare-HTTPS' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue | Out-Null

# EXPLICITLY BLOCK postgres (5432), Redis (6379), and WinRM-HTTPS (5986)
# from external - they bind to 127.0.0.1 only by default but Windows
# Firewall is the belt below the suspenders. WinRM listener is not
# enabled by this script (port 5986 isn't listening) but a future
# operator enabling automated deploys via WinRM should explicitly remove
# this block rule rather than discover it via debugging.
# BUG-AZURE-WINDOWS-VM-FOLLOWUP-WINRM-SEPARATE-ALLOW L5 advisory absorb
# (2026-05-03): host-edge symmetry with NSG-edge winrmAllowedSource='None'.
New-NetFirewallRule -DisplayName 'Signacare-Block-Postgres-External' -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Block -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName 'Signacare-Block-Redis-External'    -Direction Inbound -Protocol TCP -LocalPort 6379 -Action Block -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName 'Signacare-Block-WinRM-External'    -Direction Inbound -Protocol TCP -LocalPort 5986 -Action Block -ErrorAction SilentlyContinue | Out-Null

Write-Step 'COMPLETE - VM is ready for app deployment.'
Write-Host @"

Next steps:
  1. Move PostgreSQL superuser password from D:\Signacare\postgres-data\superuser-password.txt
     to Azure Key Vault, then DELETE the local file.
  2. Run 02-create-database.ps1 to create the signacaredb database + roles.
  3. Run 03-deploy-app.ps1 (after copying built artifacts to D:\Signacare\app).
  4. Run 04-configure-iis.ps1 to wire IIS reverse proxy.
  5. Run 05-install-services.ps1 to register Node.js as a Windows Service.

"@ -ForegroundColor Green
