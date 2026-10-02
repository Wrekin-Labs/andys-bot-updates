$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Run scripts\start-relay.ps1 first to create the environment."
}
.\.venv\Scripts\python.exe -m project_relay.mcp_server
