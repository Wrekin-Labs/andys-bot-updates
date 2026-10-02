$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Run scripts\install-windows.ps1 first."
}
$env:RELAY_MOCK_DEVICES = "1"
Write-Host "Mock devices (no real hardware touched):"
& .\.venv\Scripts\python.exe -m project_relay.cli devices
Write-Host "Open the local approval window with scripts\start-gui.ps1 to test the UI."
