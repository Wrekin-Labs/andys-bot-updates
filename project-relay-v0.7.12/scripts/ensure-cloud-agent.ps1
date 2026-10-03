param(
    [switch]$PreferInteractiveSession
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Project Relay virtual environment is missing. Run scripts\install-windows.ps1 first."
}

$managedPython = (Resolve-Path $python).Path
$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$processes = @($all | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.supabase_agent"
})
$launchers = @($processes | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $managedPython)
})

$currentSessionId = [int](Get-Process -Id $PID).SessionId
$sessionMismatch = $false
if ($PreferInteractiveSession -and $launchers.Count -eq 1) {
    $launcherSessionId = [int]$launchers[0].SessionId
    $sessionMismatch = $launcherSessionId -ne $currentSessionId
}

if ($launchers.Count -eq 1 -and -not $sessionMismatch) {
    exit 0
}

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
