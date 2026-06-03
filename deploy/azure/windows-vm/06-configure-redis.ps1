# -----------------------------------------------------------------------------
# Signacare EMR - Memurai data-dir relocation
# 06-configure-redis.ps1
#
# BUG-AZURE-WINDOWS-VM-FOLLOWUP-MEMURAI-DATA-DIR (2026-05-03 L5 advisory)
# - relocates Memurai's AOF/RDB persistence files to D:\Signacare\
# redis-data so they live on the data disk alongside PostgreSQL data
# rather than the OS disk's ProgramData path.
#
# Why:
#   - Default Memurai install writes RDB snapshots + AOF append-log to
#     C:\ProgramData\Memurai\. The data-disk-separation rationale of
#     main-windows.bicep (separate Premium SSD for stateful data) is
#     half-applied without this relocation.
#   - For dev/test where Redis is ephemeral cache (BullMQ jobs, rate
#     limit), the impact is small - but matching the PostgreSQL data-dir
#     posture means OS disk can be re-imaged without losing Redis state.
#   - For staging/production where BullMQ jobs hold clinical work-in-
#     progress (e.g. HL7 inbound queue, retention purge candidates),
#     relocation is necessary so Azure Backup snapshots of the data
#     disk capture Redis state alongside PostgreSQL.
#
# REQUIRES:
#   - 01-setup-prerequisites.ps1 already run (Memurai installed)
#   - D:\Signacare\redis-data\ exists (created by step 1.2 of script 01)
#
# IDEMPOTENCY:
#   Re-running this script is safe - it checks the current `dir`
#   setting in memurai.conf and is a no-op if already relocated.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$DataDriveLetter = 'D',
    [Parameter()] [string]$ServiceName     = 'Memurai'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'

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
Write-Step '0/5 - Pre-flight checks (Administrator + Memurai installed + data dir present)'

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    throw "Memurai service '$ServiceName' not found. Run 01-setup-prerequisites.ps1 first."
}

$targetDataDir = "${DataDriveLetter}:\Signacare\redis-data"
if (-not (Test-Path $targetDataDir)) {
    New-Item -ItemType Directory -Path $targetDataDir -Force | Out-Null
    Write-Host "  Created $targetDataDir"
}

# -----------------------------------------------------------------------------
# 1. Locate memurai.conf - try common install paths
# -----------------------------------------------------------------------------
Write-Step '1/5 - Locate memurai.conf'
$confCandidates = @(
    'C:\Program Files\Memurai\memurai.conf',
    'C:\ProgramData\Memurai\memurai.conf'
)
$memuraiConf = $null
foreach ($candidate in $confCandidates) {
    if (Test-Path $candidate) { $memuraiConf = $candidate; break }
}
if (-not $memuraiConf) {
    # Fallback - try registry to locate the install path
    $svcPath = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -ErrorAction SilentlyContinue).ImagePath
    if ($svcPath) {
        $exePath = ($svcPath -split '"')[1]
        $installDir = Split-Path $exePath -Parent
        $candidate = Join-Path $installDir 'memurai.conf'
        if (Test-Path $candidate) { $memuraiConf = $candidate }
    }
}
if (-not $memuraiConf) {
    throw "Could not locate memurai.conf. Tried: $($confCandidates -join ', ')"
}
Write-Host "  Found: $memuraiConf"

# -----------------------------------------------------------------------------
# 2. Check current `dir` setting (idempotency guard)
# -----------------------------------------------------------------------------
Write-Step '2/5 - Check current dir setting'
$currentDirLine = Get-Content $memuraiConf | Where-Object { $_ -match '^\s*dir\s+' } | Select-Object -First 1
if ($currentDirLine) {
    $currentDir = ($currentDirLine -replace '^\s*dir\s+', '').Trim()
    Write-Host "  Current dir: $currentDir"
    if ($currentDir -eq $targetDataDir) {
        Write-Host "  Already relocated to $targetDataDir - script is a no-op."
        Write-Host "`n[COMPLETE] Memurai already configured." -ForegroundColor Green
        return
    }
}

# -----------------------------------------------------------------------------
# 3. Stop service + edit memurai.conf
# -----------------------------------------------------------------------------
Write-Step "3/5 - Stop $ServiceName + edit memurai.conf"
Stop-Service -Name $ServiceName -Force

# Backup existing conf
$backupPath = "${memuraiConf}.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -Path $memuraiConf -Destination $backupPath -Force
Write-Host "  Backed up to $backupPath"

# Read + rewrite
$conf = Get-Content $memuraiConf
$updated = @()
$dirReplaced = $false
foreach ($line in $conf) {
    if ($line -match '^\s*dir\s+') {
        $updated += "dir $targetDataDir"
        $dirReplaced = $true
    } else {
        $updated += $line
    }
}
if (-not $dirReplaced) {
    # Append directive if not present
    $updated += ''
    $updated += '# BUG-AZURE-WINDOWS-VM-FOLLOWUP-MEMURAI-DATA-DIR (2026-05-03)'
    $updated += "dir $targetDataDir"
}
Set-Content -Path $memuraiConf -Value $updated -Encoding ASCII

# -----------------------------------------------------------------------------
# 4. Move existing AOF/RDB files (if any) to the new location
# -----------------------------------------------------------------------------
Write-Step '4/5 - Move existing AOF/RDB files to data drive'
$oldDataDir = if ($currentDirLine) { $currentDir } else { 'C:\ProgramData\Memurai' }
if (Test-Path $oldDataDir) {
    $aof = Join-Path $oldDataDir 'appendonly.aof'
    $rdb = Join-Path $oldDataDir 'dump.rdb'
    foreach ($f in @($aof, $rdb)) {
        if (Test-Path $f) {
            $target = Join-Path $targetDataDir (Split-Path -Leaf $f)
            Move-Item -Path $f -Destination $target -Force
            Write-Host "  Moved $f -> $target"
        }
    }
}

# -----------------------------------------------------------------------------
# 5. Restart service + smoke-check
# -----------------------------------------------------------------------------
Write-Step "5/5 - Start $ServiceName + smoke-check"
Start-Service -Name $ServiceName
Start-Sleep -Seconds 2

# Verify service is running
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    throw "Memurai service did not start. Check Event Viewer for errors. Backup at $backupPath."
}

# Verify connectivity via memurai-cli (or fallback to a basic TCP check)
$cli = (Get-Command 'memurai-cli' -ErrorAction SilentlyContinue).Source
if ($cli) {
    $pong = & $cli -h 127.0.0.1 -p 6379 ping
    if ($pong -ne 'PONG') {
        throw "Memurai PING returned '$pong' (expected PONG)"
    }
    Write-Host "  PING -> PONG (OK)"
} else {
    # TCP smoke fallback
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
    if (-not $tcp.TcpTestSucceeded) {
        throw 'Memurai TCP port 6379 not listening'
    }
    Write-Host "  TCP 127.0.0.1:6379 OK (memurai-cli not installed; PING not verified)"
}

Write-Host @"

[COMPLETE] Memurai relocated to $targetDataDir.

Verification:
  - Persistence dir: $targetDataDir
  - Service status:  $($svc.Status)
  - Backup of conf:  $backupPath

If you need to roll back:
  Stop-Service -Name $ServiceName
  Copy-Item -Path '$backupPath' -Destination '$memuraiConf' -Force
  Move-Item -Path '$targetDataDir\appendonly.aof' '$oldDataDir\appendonly.aof' -ErrorAction SilentlyContinue
  Move-Item -Path '$targetDataDir\dump.rdb' '$oldDataDir\dump.rdb' -ErrorAction SilentlyContinue
  Start-Service -Name $ServiceName

"@ -ForegroundColor Green
