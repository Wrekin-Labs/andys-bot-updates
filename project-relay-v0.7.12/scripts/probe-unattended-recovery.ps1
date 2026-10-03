param(
    [Parameter(Mandatory = $true)]
    [string]$StateRoot,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
$env:RELAY_STATE_DIR = [System.IO.Path]::GetFullPath($StateRoot)

$result = [ordered]@{
    identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    dpapi_ok = $false
    network_ok = $false
    state_ok = $false
    error = $null
}

try {
    $configPath = Join-Path $env:RELAY_STATE_DIR "cloud.json"
    if (-not (Test-Path $configPath)) {
        throw "Project Relay cloud config is missing."
    }
    if (-not (Test-Path $python)) {
        throw "Project Relay managed Python is missing."
    }

    $result.state_ok = $true
    $secretResult = & $python -c "from project_relay.cloud_credentials import load_cloud_secret; print('OK' if bool(load_cloud_secret('device')) else 'EMPTY')" 2>&1
    if ($LASTEXITCODE -eq 0 -and (($secretResult -join "") -match "OK")) {
        $result.dpapi_ok = $true
    }

    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $uri = [Uri]$cfg.device_endpoint
    $port = if ($uri.Port -gt 0) { $uri.Port } elseif ($uri.Scheme -eq "https") { 443 } else { 80 }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($uri.Host, $port, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(10000, $false)
        if ($connected -and $client.Connected) {
            $client.EndConnect($async)
            $result.network_ok = $true
        }
    } finally {
        $client.Close()
    }
} catch {
    $result.error = $_.Exception.Message
}

$result | ConvertTo-Json | Set-Content -Path $OutputPath -Encoding UTF8
