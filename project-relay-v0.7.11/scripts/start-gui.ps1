$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Run scripts\install-windows.ps1 first."
}
.\.venv\Scripts\python.exe -m project_relay.gui
