param(
    [Parameter(Mandatory = $true)]
    [string]$StateRoot
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$watchdog = Join-Path $root "scripts\watchdog-cloud-agent.ps1"

if (-not (Test-Path $watchdog)) {
    throw "Relay cloud watchdog not found: $watchdog"
}

$env:RELAY_STATE_DIR = [System.IO.Path]::GetFullPath($StateRoot)
& $watchdog
if (-not $?) {
    exit 1
}
exit 0
