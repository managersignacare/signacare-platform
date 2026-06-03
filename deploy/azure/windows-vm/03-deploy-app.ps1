# -----------------------------------------------------------------------------
# Signacare EMR - App deployment
# 03-deploy-app.ps1
#
# Run after copying the packaged monorepo deployment bundle to D:\Signacare\app:
#   D:\Signacare\app\package.json
#   D:\Signacare\app\package-lock.json
#   D:\Signacare\app\apps\api\dist\            (compiled API: tsc output)
#   D:\Signacare\app\apps\api\package.json
#   D:\Signacare\app\apps\api\.env             (production env file with DB_PASSWORD etc)
#   D:\Signacare\app\apps\api\migrations\
#   D:\Signacare\app\apps\api\scripts\         (compiled migrate.js target in dist/scripts)
#   D:\Signacare\app\apps\web\dist\            (Vite SPA build output)
#   D:\Signacare\app\packages\shared\dist\     (workspace runtime dependency for @signacare/shared)
#   D:\Signacare\app\packages\shared\package.json
#
# This script:
#   1. Validates the staged artifacts exist
#   2. Installs production npm deps for apps/api + packages/shared via root workspace lockfile
#   3. Runs migrations (npm run migrate --workspace apps/api)
#   4. Tests health endpoint via local curl
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$AppRoot = 'D:\Signacare\app'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
    Write-Host "`n[STEP] $msg" -ForegroundColor Cyan
}

function Resolve-NpmCommand {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) { return $npm.Source }
    $candidates = @(
        'C:\Program Files\nodejs\npm.cmd',
        'C:\Program Files\nodejs\npm.exe',
        'C:\ProgramData\chocolatey\bin\npm.cmd'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw 'npm executable not found. Ensure Node.js is installed and available.'
}

function Resolve-NodeCommand {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    $candidates = @(
        'C:\Program Files\nodejs\node.exe',
        'C:\ProgramData\chocolatey\bin\node.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw 'node executable not found. Ensure Node.js is installed and available.'
}

function Invoke-NpmCmdWithLog {
    param(
        [Parameter(Mandatory = $true)] [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)] [string]$Arguments,
        [Parameter(Mandatory = $true)] [string]$LogPath
    )
    Push-Location $WorkingDirectory
    try {
        cmd /c "`"$npmCmd`" $Arguments > `"$LogPath`" 2>&1"
        $exitCode = $LASTEXITCODE
        if (Test-Path $LogPath) {
            Get-Content $LogPath | ForEach-Object { Write-Host $_ }
        }
        if ($exitCode -ne 0) {
            throw "npm command failed (exit=$exitCode): $Arguments"
        }
    }
    finally {
        Pop-Location
    }
}

$npmCmd = Resolve-NpmCommand
$nodeCmd = Resolve-NodeCommand
$nodeDir = Split-Path -Parent $nodeCmd
if (-not ($env:Path -split ';' | Where-Object { $_ -eq $nodeDir })) {
    $env:Path = "$nodeDir;$env:Path"
}

# -----------------------------------------------------------------------------
# 1. Validate staged artifacts
# -----------------------------------------------------------------------------
Write-Step "1/4 - Validate staged artifacts under $AppRoot"
$required = @(
    "$AppRoot\package.json",
    "$AppRoot\package-lock.json",
    "$AppRoot\apps\api\package.json",
    "$AppRoot\apps\api\.env",
    "$AppRoot\apps\api\dist",
    "$AppRoot\apps\api\migrations",
    "$AppRoot\apps\api\scripts",
    "$AppRoot\apps\web\dist",
    "$AppRoot\packages\shared\package.json",
    "$AppRoot\packages\shared\dist"
)
foreach ($p in $required) {
    if (-not (Test-Path $p)) {
        throw "Required path missing: $p - copy build artifacts before running this script."
    }
}
Write-Host '  All required artifacts present'

# -----------------------------------------------------------------------------
# 2. Install production npm deps for the API
# -----------------------------------------------------------------------------
Write-Step '2/4 - Install production deps via workspace lockfile (apps/api + packages/shared)'
Invoke-NpmCmdWithLog `
    -WorkingDirectory "$AppRoot" `
    -Arguments "ci --omit=dev --workspace packages/shared --workspace apps/api --include-workspace-root=true" `
    -LogPath "$AppRoot\apps\api\npm-ci.log"

# -----------------------------------------------------------------------------
# 3. Run database migrations
# -----------------------------------------------------------------------------
Write-Step '3/4 - Run database migrations (npm run migrate --workspace apps/api)'
Invoke-NpmCmdWithLog `
    -WorkingDirectory "$AppRoot" `
    -Arguments "run migrate --workspace apps/api" `
    -LogPath "$AppRoot\apps\api\npm-migrate.log"
Write-Host '  Migrations applied successfully'

# -----------------------------------------------------------------------------
# 4. Health-check (start the API in test mode + curl /health)
# -----------------------------------------------------------------------------
Write-Step '4/4 - Health-check the API (start temp instance + curl /health)'
$apiPort = $env:PORT
if (-not $apiPort) { $apiPort = '4000' }

$proc = Start-Process -FilePath $nodeCmd -ArgumentList "-r dotenv/config dist/src/index.js" `
    -WorkingDirectory "$AppRoot\apps\api" -PassThru -NoNewWindow `
    -RedirectStandardOutput "$AppRoot\apps\api\health-check.log" `
    -RedirectStandardError  "$AppRoot\apps\api\health-check-err.log"

try {
    $resp = $null
    $healthOk = $false
    for ($attempt = 1; $attempt -le 24; $attempt++) {
        Start-Sleep -Seconds 5
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$apiPort/health" -UseBasicParsing -TimeoutSec 10
            if ($resp.StatusCode -eq 200) {
                $healthOk = $true
                break
            }
        } catch {
            Write-Host "  Health probe attempt $attempt/24 failed - retrying..."
        }
    }
    if ($healthOk) {
        Write-Host "  Health check PASS - $($resp.Content)"
    } else {
        throw 'Health check did not return HTTP 200 within retry window'
    }
} catch {
    Write-Warning '  Health check FAILED - review D:\Signacare\app\apps\api\health-check-err.log'
    throw
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }
}

Write-Host "`n[COMPLETE] App deployed. Run 04-configure-iis.ps1 next." -ForegroundColor Green
