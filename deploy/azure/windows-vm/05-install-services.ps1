# -----------------------------------------------------------------------------
# Signacare EMR - Register Node.js API as Windows Service via node-windows
# 05-install-services.ps1
#
# Registers the API as a Windows Service named "SignacareAPI" so it:
#   - starts on boot
#   - restarts automatically on crash
#   - logs to D:\Signacare\logs\
#
# REQUIRES:
#   - 03-deploy-app.ps1 already run (artifacts staged + migrations applied)
#   - node-windows installed globally (done in 01-setup-prerequisites.ps1)
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$ApiRoot     = 'D:\Signacare\app\apps\api',
    [Parameter()] [string]$ServiceName = 'SignacareAPI'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
    Write-Host "`n[STEP] $msg" -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 1. Generate the node-windows service installer script
# -----------------------------------------------------------------------------
Write-Step "1/3 - Generate service installer script for $ServiceName"
$installerPath = "$ApiRoot\install-windows-service.js"
$installerJs = @"
// node-windows installer for $ServiceName
// Run once: `node install-windows-service.js`
const Service = require('node-windows').Service;
const path    = require('path');

const svc = new Service({
  name:        '$ServiceName',
  description: 'Signacare EMR API - Node.js backend (BUG-AZURE-WINDOWS-VM)',
  script:      path.join(__dirname, 'dist', 'src', 'index.js'),
  nodeOptions: ['--require', 'dotenv/config'],
  workingDirectory: __dirname,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT',     value: '4000' }
  ],
  // Restart on crash: 5x with 5s backoff
  wait:    2,
  grow:    .5,
  maxRetries: 5
});

svc.on('install',   () => { console.log('Service installed'); svc.start(); });
svc.on('alreadyinstalled', () => { console.log('Already installed; restarting'); svc.restart(); });
svc.on('start',     () => { console.log('Service started'); });
svc.on('error',     (e) => { console.error('Service error:', e); process.exit(1); });

svc.install();
"@
Set-Content -Path $installerPath -Value $installerJs -Force
Write-Host "  Installer script written: $installerPath"

# -----------------------------------------------------------------------------
# 2. Install or restart service (idempotent)
# -----------------------------------------------------------------------------
Write-Step "2/3 - Ensure service $ServiceName is installed and running"
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "  Service already exists (status=$($existingService.Status)); performing restart"
    if ($existingService.Status -eq 'Running') {
        Restart-Service -Name $ServiceName -Force
    } else {
        Start-Service -Name $ServiceName
    }
} else {
    Push-Location $ApiRoot
    try {
        $globalNodePath = (npm root -g).Trim()
        if (-not (Test-Path (Join-Path $globalNodePath 'node-windows'))) {
            throw "node-windows not found in global npm path ($globalNodePath). Re-run 01-setup-prerequisites.ps1."
        }
        # Make the global module visible to this script without mutating app deps.
        $env:NODE_PATH = $globalNodePath

        # Prevent indefinite hangs on installer callbacks.
        $proc = Start-Process -FilePath 'node' -ArgumentList 'install-windows-service.js' -PassThru -NoNewWindow
        if (-not $proc.WaitForExit(120000)) {
            $proc.Kill()
            throw "Service installer timed out after 120s for $ServiceName"
        }
        if ($proc.ExitCode -ne 0) {
            throw "Service installation failed with exit code $($proc.ExitCode)"
        }
    } finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# 3. Verify the service is running
# -----------------------------------------------------------------------------
Write-Step "3/3 - Verify $ServiceName is running"
Start-Sleep -Seconds 5
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Write-Host "  Service $ServiceName is RUNNING"
    # Test the API directly
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:4000/health' -UseBasicParsing -TimeoutSec 10
        Write-Host "  API health endpoint OK: $($resp.Content)"
    } catch {
        Write-Warning "  API health check failed: $_ - review service logs in Event Viewer + D:\Signacare\logs"
    }
} else {
    Write-Warning "  Service $ServiceName is NOT running. Status: $($svc.Status). Review Event Viewer for errors."
}

Write-Host @"

[COMPLETE] Service installed.

To manage the service:
  - Start:    Start-Service  -Name $ServiceName
  - Stop:     Stop-Service   -Name $ServiceName
  - Restart:  Restart-Service -Name $ServiceName
  - Status:   Get-Service     -Name $ServiceName
  - Uninstall: cd $ApiRoot; node uninstall-windows-service.js  (you may need to write this)

Logs:
  - Service stdout/stderr: $ApiRoot\daemon\$ServiceName.out.log + $ServiceName.err.log
  - App log:               D:\Signacare\logs\ (configured via pino destination)

Final smoke test (run from your laptop):
  curl https://<vm-fqdn>/health
  curl https://<vm-fqdn>/ready

"@ -ForegroundColor Green
