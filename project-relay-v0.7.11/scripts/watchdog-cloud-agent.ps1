$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
$state = Split-Path -Parent $root
$heartbeat = Join-Path $state "heartbeat.json"
$restartMarker = Join-Path $state "watchdog-restart.json"
$log = Join-Path $state "recovery.log"

$staleAfterSeconds = 180
$restartCooldownSeconds = 120

function Write-RecoveryLog([string]$Message) {
    try {
        Add-Content -Path $log -Value ("{0:o} {1}" -f (Get-Date), $Message) -Encoding UTF8
    } catch {}
}

if (-not (Test-Path $python)) {
    Write-RecoveryLog "watchdog-cloud-agent: managed python missing: $python"
    exit 1
}

$managedPython = (Resolve-Path $python).Path
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.supabase_agent"
})
$launchers = @($processes | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $managedPython)
})

$heartbeatFresh = $false
$heartbeatAge = $null
if (Test-Path $heartbeat) {
    try {
        $heartbeatAge = [int]((Get-Date) - (Get-Item $heartbeat).LastWriteTime).TotalSeconds
        $heartbeatFresh = $heartbeatAge -le $staleAfterSeconds
    } catch {
        $heartbeatFresh = $false
    }
}

if ($launchers.Count -eq 1 -and $heartbeatFresh) { exit 0 }

$cooldownActive = $false
if (Test-Path $restartMarker) {
    try {
        $marker = Get-Content $restartMarker -Raw | ConvertFrom-Json
        if ($marker.restarted_at) {
            $elapsed = ((Get-Date).ToUniversalTime() - [DateTime]::Parse($marker.restarted_at).ToUniversalTime()).TotalSeconds
            $cooldownActive = $elapsed -lt $restartCooldownSeconds
        }
    } catch {}
}

# Preserve the v0.7.8 guarantee: a missing managed launcher always bypasses
# cooldown, while a running-but-stale agent is protected from restart storms.
if ($cooldownActive -and $launchers.Count -eq 1) { exit 0 }

foreach ($process in $processes) {
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 750

$leftovers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.supabase_agent"
})
foreach ($process in $leftovers) {
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 500

Start-Process -FilePath $python -ArgumentList "-m","project_relay.supabase_agent" -WorkingDirectory $root -WindowStyle Hidden

$reason = "launcher-missing"
if ($launchers.Count -gt 1) {
    $reason = "duplicate-launchers"
} elseif ($launchers.Count -eq 1 -and -not $heartbeatFresh) {
    $reason = "heartbeat-stale age=$heartbeatAge"
}

@{
    restarted_at = (Get-Date).ToUniversalTime().ToString("o")
    reason = $reason
} | ConvertTo-Json | Set-Content -Path $restartMarker -Encoding UTF8

Write-RecoveryLog "watchdog-cloud-agent: restarted agent tree; reason=$reason"
