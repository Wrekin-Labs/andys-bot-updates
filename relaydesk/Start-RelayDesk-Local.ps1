$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path '.venv-local')) {
    py -3 -m venv .venv-local
}
$python = Join-Path $PSScriptRoot '.venv-local\Scripts\python.exe'
& $python -m pip install -r requirements-server.txt -r requirements-host.txt -r requirements-controller.txt

Write-Host 'Starting local relay in a new window...'
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PSScriptRoot'; & '$python' relay_server.py"
Start-Sleep -Seconds 1
Write-Host 'Starting RelayDesk Host...'
Start-Process $python -ArgumentList 'host_gui.py','--server','ws://127.0.0.1:8765'
Write-Host 'Start controller.py on a second PC, paste the rd2_ invite, and use the same relay URL.'
