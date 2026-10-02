$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
$state = Split-Path -Parent $root
$log = Join-Path $state "recovery.log"

function Write-RecoveryLog([string]$Message) {
    try {
        Add-Content -Path $log -Value ("{0:o} {1}" -f (Get-Date), $Message) -Encoding UTF8
    } catch {}
}

function Test-InManagedTree([int]$PidToTest, $AllProcesses, $LauncherIds) {
    $current = $PidToTest
    for ($i = 0; $i -lt 12; $i++) {
        if ($LauncherIds -contains $current) { return $true }
        $proc = $AllProcesses | Where-Object ProcessId -eq $current | Select-Object -First 1
        if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq $current) { break }
        $current = [int]$proc.ParentProcessId
    }
    return $false
}

if (-not (Test-Path $python)) {
    Write-RecoveryLog "watchdog-mcp: managed python missing: $python"
    exit 1
}

$managedPython = (Resolve-Path $python).Path
$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$mcpProcesses = @($all | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.mcp_server"
})
$launchers = @($mcpProcesses | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $managedPython)
})
$launcherIds = @($launchers | ForEach-Object { [int]$_.ProcessId })

$listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($launchers.Count -eq 1 -and $listener -and (Test-InManagedTree ([int]$listener.OwningProcess) $all $launcherIds)) {
    exit 0
}

foreach ($process in $mcpProcesses) {
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 750

$leftovers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.mcp_server"
})
foreach ($process in $leftovers) {
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 500

Start-Process -FilePath $python -ArgumentList "-m","project_relay.mcp_server" -WorkingDirectory $root -WindowStyle Hidden
Write-RecoveryLog "watchdog-mcp: restarted MCP process tree"
