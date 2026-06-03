# -----------------------------------------------------------------------------
# 11-check-bootstrap-bg.ps1
#
# Reads background bootstrap status + tail logs for deterministic progress
# checks from Azure Run Command.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [int]$TailLines = 120
)

$statusPath = 'C:\Setup\bootstrap-bg.status.json'
$logPath = 'C:\Setup\bootstrap-bg.log'

if (Test-Path $statusPath) {
    Write-Output '--- STATUS ---'
    Get-Content $statusPath -Raw | Write-Output
} else {
    Write-Output '--- STATUS ---'
    Write-Output '{"state":"unknown","message":"status file missing"}'
}

if (Test-Path $logPath) {
    Write-Output '--- LOG TAIL ---'
    Get-Content $logPath -Tail $TailLines
} else {
    Write-Output '--- LOG TAIL ---'
    Write-Output 'log file missing'
}
