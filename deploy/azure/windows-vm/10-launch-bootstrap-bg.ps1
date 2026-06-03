# -----------------------------------------------------------------------------
# 10-launch-bootstrap-bg.ps1
#
# Launches node bootstrap as an in-VM background process and returns
# immediately, so Azure Run Command is not held open for long-running setup.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$BundleUrl,
    [Parameter(Mandatory = $true)] [string]$AzureKeyVaultUrl,
    [Parameter(Mandatory = $true)] [string]$PublicFqdn
)

$ErrorActionPreference = 'Stop'

$setupRoot = 'C:\Setup'
$runnerPath = Join-Path $setupRoot 'bootstrap-bg-runner.ps1'
$logPath = Join-Path $setupRoot 'bootstrap-bg.log'
$statusPath = Join-Path $setupRoot 'bootstrap-bg.status.json'

if (-not (Test-Path $setupRoot)) {
    New-Item -Path $setupRoot -ItemType Directory -Force | Out-Null
}

$runnerContent = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$setupRoot = 'C:\Setup'
`$statusPath = 'C:\Setup\bootstrap-bg.status.json'
`$logPath = 'C:\Setup\bootstrap-bg.log'
`$zipPath = 'C:\Setup\signacare-bundle.zip'
`$bundleUrl = '$BundleUrl'
`$kvUrl = '$AzureKeyVaultUrl'
`$fqdn = '$PublicFqdn'

function Write-Status([string]`$state, [string]`$message) {
  `$obj = [ordered]@{
    state = `$state
    message = `$message
    updatedAt = (Get-Date).ToString('o')
  }
  (`$obj | ConvertTo-Json -Depth 4) | Set-Content -Path `$statusPath -Encoding UTF8
}

try {
  Write-Status 'running' 'bootstrap started'
  "START `$((Get-Date).ToString('o'))" | Out-File -FilePath `$logPath -Encoding utf8

  Invoke-WebRequest -Uri `$bundleUrl -OutFile `$zipPath -UseBasicParsing
  Expand-Archive -Path `$zipPath -DestinationPath `$setupRoot -Force
  `$bundleDir = Get-ChildItem `$setupRoot -Directory | Where-Object { `$_.Name -like 'windows-vm-release-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not `$bundleDir) { throw 'Bundle extraction failed: windows-vm-release-* directory not found' }

  `$bootstrap = Join-Path `$bundleDir.FullName 'deploy\azure\windows-vm\07-bootstrap-node.ps1'
  if (-not (Test-Path `$bootstrap)) { throw "Bootstrap script not found at `$bootstrap" }

  `$tokenResp = Invoke-RestMethod -Method GET -Headers @{ Metadata = 'true' } -Uri 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net'
  `$kvHeaders = @{ Authorization = "Bearer `$(`$tokenResp.access_token)" }
  `$kvBase = `$kvUrl.TrimEnd('/')
  `$dbOwner = (Invoke-RestMethod -Method GET -Headers `$kvHeaders -Uri "`$kvBase/secrets/db-password?api-version=7.4").value
  `$dbApp = (Invoke-RestMethod -Method GET -Headers `$kvHeaders -Uri "`$kvBase/secrets/db-app-password?api-version=7.4").value
  if ([string]::IsNullOrWhiteSpace(`$dbOwner) -or [string]::IsNullOrWhiteSpace(`$dbApp)) {
    throw 'Unable to resolve db-password/db-app-password from Key Vault via managed identity.'
  }

  & `$bootstrap -BundleUrl `$bundleUrl -AzureKeyVaultUrl `$kvUrl -DbOwnerPassword `$dbOwner -DbAppPassword `$dbApp -PublicFqdn `$fqdn *>> `$logPath

  Write-Status 'succeeded' 'bootstrap completed successfully'
  "END_OK `$((Get-Date).ToString('o'))" | Add-Content -Path `$logPath
}
catch {
  `$msg = (`$_ | Out-String)
  Write-Status 'failed' `$msg
  "END_FAIL `$((Get-Date).ToString('o'))" | Add-Content -Path `$logPath
  `$msg | Add-Content -Path `$logPath
}
"@

Set-Content -Path $runnerPath -Value $runnerContent -Encoding UTF8

$existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
    $_.CommandLine -like "*bootstrap-bg-runner.ps1*"
}
if ($existing) {
    Write-Output "bootstrap runner already active (pid=$($existing.ProcessId))"
    if (Test-Path $statusPath) {
        Write-Output (Get-Content $statusPath -Raw)
    }
    exit 0
}

Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $runnerPath
) -WindowStyle Hidden | Out-Null

Write-Output 'bootstrap runner launched'
if (Test-Path $statusPath) {
    Write-Output (Get-Content $statusPath -Raw)
}
