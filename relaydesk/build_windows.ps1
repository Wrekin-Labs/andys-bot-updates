$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$venv = Join-Path $PSScriptRoot '.venv-build'
if (-not (Test-Path $venv)) {
    py -3 -m venv $venv
}
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --upgrade pip
& $python -m pip install -r requirements-host.txt -r requirements-controller.txt 'pyinstaller>=6,<7'

Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue

& $python -m PyInstaller --noconfirm --clean --onefile --windowed `
  --collect-all dxcam --name RelayDeskHost host_gui.py
& $python -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name RelayDeskViewer controller.py
& $python -m PyInstaller --noconfirm --clean --onefile --noconsole `
  --name RelayDeskRelay relay_server.py

Write-Host ''
Write-Host 'Built:'
Write-Host "  $PSScriptRoot\dist\RelayDeskHost.exe"
Write-Host "  $PSScriptRoot\dist\RelayDeskViewer.exe"
Write-Host "  $PSScriptRoot\dist\RelayDeskRelay.exe"
Write-Host ''
Write-Host 'These are unsigned alpha binaries. Do not distribute publicly until code signing and update verification are in place.'
