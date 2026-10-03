$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install --upgrade pip
    .\.venv\Scripts\python.exe -m pip install -e .
}

Write-Host "Project Relay v0.3.1 - local agent"
Write-Host "Physical printing and scanner acquisition remain disabled by default."
.\.venv\Scripts\python.exe -m project_relay.cli devices
