# -----------------------------------------------------------------------------
# Signacare EMR - Fast node bootstrap (no prereq reinstall)
# 08-bootstrap-node-fast.ps1
#
# Use when base prerequisites already exist on the VM and only runtime
# deployment + Key Vault wiring + boot validation are required.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$BundleUrl,
    [Parameter(Mandatory = $true)] [string]$AzureKeyVaultUrl,
    [Parameter(Mandatory = $true)] [string]$DbOwnerPassword,
    [Parameter(Mandatory = $true)] [string]$DbAppPassword,
    [Parameter(Mandatory = $true)] [string]$PublicFqdn
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($msg) {
    Write-Host "`n[STEP] $msg" -ForegroundColor Cyan
}

function Assert-PathExists([string]$path, [string]$message) {
    if (-not (Test-Path $path)) { throw $message }
}

function Resolve-DbSuperuserPassword {
    param([Parameter(Mandatory = $true)] [string]$KeyVaultUrl)

    $localSuperPwFile = 'D:\Signacare\postgres-data\superuser-password.txt'
    if (Test-Path $localSuperPwFile) {
        $localPw = (Get-Content $localSuperPwFile -Raw).Trim()
        if (-not [string]::IsNullOrWhiteSpace($localPw)) {
            Write-Host "  Using local postgres superuser secret from $localSuperPwFile"
            return $localPw
        }
    }
    Write-Warning "  db-superuser-password fallback not in file path $localSuperPwFile."
    return ''
}

function Get-PostgresServiceStatus {
    param([Parameter(Mandatory = $true)] [string]$OwnerPassword)

    $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
    if (-not (Test-Path $psql)) {
        Write-Warning 'psql.exe not found on this node - cannot probe postgres state without DB bootstrap.'
        return $false
    }

    $probe = 'C:\Setup\bootstrap-db-fast-probe.sql'
    Set-Content -Path $probe -Value "SELECT 1;" -Encoding UTF8
    $stdout = 'C:\Setup\bootstrap-db-fast-probe-stdout.log'
    $stderr = 'C:\Setup\bootstrap-db-fast-probe-stderr.log'

    $env:PGPASSWORD = $OwnerPassword
    $proc = Start-Process -FilePath $psql `
        -ArgumentList @('-h', 'localhost', '-U', 'signacare_owner', '-d', 'signacaredb', '-v', 'ON_ERROR_STOP=1', '-f', $probe) `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    if (Test-Path $stdout) { Get-Content $stdout | ForEach-Object { Write-Host $_ } }
    if (Test-Path $stderr) { Get-Content $stderr | ForEach-Object { Write-Host $_ } }

    return ($proc.ExitCode -eq 0)
}

$setupRoot = 'C:\Setup'
$zipPath = Join-Path $setupRoot 'signacare-bundle.zip'
$logPath = Join-Path $setupRoot 'bootstrap-node-fast.log'
$appRoot = 'D:\Signacare\app'

if (-not (Test-Path $setupRoot)) {
    New-Item -Path $setupRoot -ItemType Directory -Force | Out-Null
}
"START $(Get-Date -Format o)" | Out-File -FilePath $logPath -Encoding utf8

try {
    Write-Step '1/7 - Download + extract release bundle'
    Invoke-WebRequest -Uri $BundleUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $setupRoot -Force
    $bundleDir = Get-ChildItem $setupRoot -Directory |
      Where-Object { $_.Name -like 'windows-vm-release-*' } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (-not $bundleDir) {
        throw 'Could not locate extracted bundle under C:\Setup'
    }

    Write-Step '2/7 - Stage application bundle to D:\Signacare\app'
    if (-not (Test-Path $appRoot)) {
        New-Item -Path $appRoot -ItemType Directory -Force | Out-Null
    } else {
        Get-ChildItem -Path $appRoot -Force | Remove-Item -Recurse -Force
    }
    Copy-Item -Path (Join-Path $bundleDir.FullName '*') -Destination $appRoot -Recurse -Force

    Write-Step '3/7 - Create/repair database roles and schema baseline (02)'
    $superPw = Resolve-DbSuperuserPassword -KeyVaultUrl $AzureKeyVaultUrl
    $script02 = Join-Path $appRoot 'deploy\azure\windows-vm\02-create-database.ps1'
    Assert-PathExists $script02 "Missing script: $script02"
    if ([string]::IsNullOrWhiteSpace($superPw)) {
        Write-Warning 'Postgres superuser password not found (local file).'
        Write-Host 'Attempting idempotent resume: probing whether existing DB and owner role are already initialized.'
        if (Get-PostgresServiceStatus -OwnerPassword $DbOwnerPassword) {
            Write-Host '  DB probe succeeded - skipping role/db bootstrap in 02-create-database.'
        } else {
            throw 'Missing postgres superuser secret and DB owner probe failed. Re-run from a fresh bootstrap path with superuser password available.'
        }
    } else {
        & $script02 `
          -PostgresSuperuserPassword $superPw `
          -OwnerRolePassword $DbOwnerPassword `
          -AppRolePassword $DbAppPassword *>> $logPath
    }

    Write-Step '4/7 - Write production API env (Key Vault backend)'
    $apiEnvPath = Join-Path $appRoot 'apps\api\.env'
    $envText = @"
NODE_ENV=production
PORT=4000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=signacaredb
DB_USER=signacare_owner
DB_PASSWORD=from-keyvault
DB_APP_USER=app_user
DB_APP_PASSWORD=from-keyvault
DB_SSL=false
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=from-keyvault
JWT_REFRESH_SECRET=from-keyvault
PHI_ENCRYPTION_KEY=from-keyvault
BLIND_INDEX_KEY=from-keyvault
SESSION_SECRET=from-keyvault
CALENDAR_ICAL_SECRET=from-keyvault
SIGNACARE_LICENSE_SECRET=from-keyvault
SESSION_IDLE_TIMEOUT=900
UPLOAD_BASE_DIR=D:\Signacare\uploads
LOG_DIR=D:\Signacare\logs
RETENTION_DRY_RUN=true
RETENTION_TZ=Australia/Sydney
HL7_LAB_PROTOCOL=disabled
ERX_ADAPTER=disabled
SAFESCRIPT_ENABLED=false
CORS_ORIGIN=https://$PublicFqdn
WEBAUTHN_RP_ID=$PublicFqdn
WEBAUTHN_RP_NAME=Signacare EMR
SECRETS_BACKEND=azure_keyvault
AZURE_KEYVAULT_URL=$AzureKeyVaultUrl
LLM_ENABLED=false
WHISPER_ENABLED=false
ALLOW_MISSING_PGVECTOR=true
LOG_LEVEL=info
"@
    Set-Content -Path $apiEnvPath -Value $envText -Encoding UTF8

    Write-Step '5/7 - Install app dependencies + run migrations (03)'
    $script03 = Join-Path $appRoot 'deploy\azure\windows-vm\03-deploy-app.ps1'
    Assert-PathExists $script03 "Missing script: $script03"
    & $script03 -AppRoot $appRoot *>> $logPath

    Write-Step '6/7 - Configure IIS + service + Redis (04,05,06)'
    $script04 = Join-Path $appRoot 'deploy\azure\windows-vm\04-configure-iis.ps1'
    $script05 = Join-Path $appRoot 'deploy\azure\windows-vm\05-install-services.ps1'
    $script06 = Join-Path $appRoot 'deploy\azure\windows-vm\06-configure-redis.ps1'
    Assert-PathExists $script04 "Missing script: $script04"
    Assert-PathExists $script05 "Missing script: $script05"
    Assert-PathExists $script06 "Missing script: $script06"
    & $script04 *>> $logPath
    & $script05 *>> $logPath
    & $script06 *>> $logPath

    Write-Step '7/7 - Local boot validation'
    Start-Sleep -Seconds 6
    $health = Invoke-WebRequest -Uri 'http://localhost:4000/health' -UseBasicParsing -TimeoutSec 20
    if ($health.StatusCode -ne 200) { throw "API /health returned $($health.StatusCode)" }
    $ready = Invoke-WebRequest -Uri 'http://localhost:4000/ready' -UseBasicParsing -TimeoutSec 20
    if ($ready.StatusCode -ne 200) { throw "API /ready returned $($ready.StatusCode)" }
    $iisHealth = Invoke-WebRequest -Uri 'http://localhost/health' -UseBasicParsing -TimeoutSec 20
    if ($iisHealth.StatusCode -ne 200) { throw "IIS /health returned $($iisHealth.StatusCode)" }
    $service = Get-Service -Name 'SignacareAPI' -ErrorAction Stop
    if ($service.Status -ne 'Running') { throw "SignacareAPI service is $($service.Status)" }

    "END_OK $(Get-Date -Format o)" | Add-Content -Path $logPath
    Write-Output 'BOOTSTRAP_FAST_EXIT=0'
    Write-Output "SERVICE_STATUS=$($service.Status)"
    Write-Output "HEALTH_STATUS=$($health.StatusCode)"
    Write-Output "READY_STATUS=$($ready.StatusCode)"
    Write-Output "IIS_HEALTH_STATUS=$($iisHealth.StatusCode)"
}
catch {
    "END_FAIL $(Get-Date -Format o)" | Add-Content -Path $logPath
    ($_ | Out-String) | Add-Content -Path $logPath
    Write-Output 'BOOTSTRAP_FAST_EXIT=1'
    throw
}
finally {
    Write-Output '--- LOG TAIL (last 220 lines) ---'
    if (Test-Path $logPath) {
        Get-Content $logPath -Tail 220
    }
}
