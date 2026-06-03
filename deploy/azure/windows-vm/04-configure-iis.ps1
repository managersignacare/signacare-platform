# -----------------------------------------------------------------------------
# Signacare EMR - IIS reverse-proxy configuration
# 04-configure-iis.ps1
#
# Configures IIS as TLS-terminating reverse proxy in front of the Node.js
# API + static-file host for the SPA build.
#
# Layout:
#   IIS site "signacare" listens on 443 (HTTPS) + 80 (HTTPS-redirect)
#     - serves D:\Signacare\app\web\dist\* as static files (the SPA)
#     - URL Rewrite proxies /api/* -> http://localhost:4000/api/*
#     - URL Rewrite proxies /health, /ready, /metrics -> API
#
# REQUIRES:
#   - 01-setup-prerequisites.ps1 already run (URL Rewrite + ARR installed)
#   - 03-deploy-app.ps1 already run (web/dist staged)
#
# TLS:
#   For dev/test we use a self-signed cert; for prod replace with a
#   bring-your-own cert via `Import-PfxCertificate` and update binding.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$SiteName    = 'signacare',
    [Parameter()] [string]$WebRoot     = 'D:\Signacare\app\apps\web\dist',
    [Parameter()] [string]$ApiBackend  = 'http://localhost:4000',
    [Parameter()] [string]$Hostname    = ''  # leave blank to bind on all hostnames
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Write-Step($msg) {
    Write-Host "`n[STEP] $msg" -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 1. Stop default site if it conflicts
# -----------------------------------------------------------------------------
Write-Step '1/5 - Disable the IIS Default Web Site'
if (Get-Website -Name 'Default Web Site' -ErrorAction SilentlyContinue) {
    Stop-Website -Name 'Default Web Site' -ErrorAction SilentlyContinue
    Set-ItemProperty 'IIS:\Sites\Default Web Site' -Name serverAutoStart -Value $false
    Write-Host '  Default Web Site stopped'
}

# -----------------------------------------------------------------------------
# 2. Create app pool + site
# -----------------------------------------------------------------------------
Write-Step "2/5 - Create app pool + site $SiteName"
if (-not (Get-Item "IIS:\AppPools\$SiteName" -ErrorAction SilentlyContinue)) {
    New-WebAppPool -Name $SiteName | Out-Null
    Set-ItemProperty "IIS:\AppPools\$SiteName" -Name 'managedRuntimeVersion' -Value ''  # No .NET (we proxy to Node)
    Set-ItemProperty "IIS:\AppPools\$SiteName" -Name 'startMode' -Value 'AlwaysRunning'
    Write-Host "  App pool $SiteName created"
}
if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
    New-Website -Name $SiteName -Port 80 -PhysicalPath $WebRoot -ApplicationPool $SiteName | Out-Null
    Write-Host "  Site $SiteName created on port 80"
}

# -----------------------------------------------------------------------------
# 3. Create or import TLS cert + bind 443
# -----------------------------------------------------------------------------
Write-Step '3/5 - Bind HTTPS (443) with self-signed cert (replace with real cert for prod)'
$certName = "CN=$($env:COMPUTERNAME).cloudapp.azure.com"
$existingCert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq $certName } | Select-Object -First 1
if (-not $existingCert) {
    $existingCert = New-SelfSignedCertificate -DnsName "$($env:COMPUTERNAME).cloudapp.azure.com" -CertStoreLocation 'Cert:\LocalMachine\My' -NotAfter (Get-Date).AddYears(2)
    Write-Host "  Self-signed cert created: thumbprint=$($existingCert.Thumbprint)"
}
# Bind 443 if not already bound
$httpsBinding = Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue
if (-not $httpsBinding) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -SslFlags 0
    $binding = Get-WebBinding -Name $SiteName -Protocol https
    $binding.AddSslCertificate($existingCert.Thumbprint, 'My')
    Write-Host '  HTTPS binding added'
}

# -----------------------------------------------------------------------------
# 4. Drop the URL Rewrite + ARR config (web.config) into the site root
# -----------------------------------------------------------------------------
Write-Step '4/5 - Install web.config (URL Rewrite reverse proxy + SPA fallback)'
$webConfigSource = Join-Path $PSScriptRoot 'web.config'
$webConfigTarget = Join-Path $WebRoot       'web.config'
if (-not (Test-Path $webConfigSource)) {
    throw "web.config template not found at $webConfigSource - ensure deploy/azure/windows-vm/web.config is on the VM"
}
Copy-Item -Path $webConfigSource -Destination $webConfigTarget -Force
Write-Host "  web.config copied to $webConfigTarget"

# -----------------------------------------------------------------------------
# 5. Restart IIS + smoke-test
# -----------------------------------------------------------------------------
Write-Step '5/5 - Restart IIS + smoke-test'
iisreset /restart
Start-Sleep -Seconds 3

try {
    # The API will only respond once 05-install-services.ps1 starts the
    # Node service; for now we just verify IIS itself is listening.
    $iisRunning = (Get-Service -Name W3SVC).Status
    Write-Host "  IIS (W3SVC) status: $iisRunning"
    Write-Host "  HTTPS endpoint: https://$($env:COMPUTERNAME).cloudapp.azure.com (cert is self-signed - ignore browser warning for dev)"
} catch {
    Write-Warning "  IIS smoke check failed: $_"
}

Write-Host "`n[COMPLETE] IIS reverse proxy configured. Run 05-install-services.ps1 to start the Node services." -ForegroundColor Green
