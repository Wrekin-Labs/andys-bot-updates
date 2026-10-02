$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Run scripts\install-windows.ps1 first."
}

$out = Join-Path $root "hardware-smoke.json"
& .\.venv\Scripts\python.exe -m project_relay.cli devices | Set-Content -Encoding UTF8 $out
Write-Host "Read-only device discovery complete: $out"
Get-Content $out
