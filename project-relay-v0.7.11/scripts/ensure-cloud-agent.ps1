$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Project Relay virtual environment is missing. Run scripts\install-windows.ps1 first."
}

$watchdogInstaller = Join-Path $root "scripts\install-cloud-watchdog.ps1"
if (Test-Path $watchdogInstaller) {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $watchdogInstaller -Quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "watchdog-install-failed: exit code $LASTEXITCODE"
    }
}

$managedPython = (Resolve-Path $python).Path
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "python.exe" -and $_.CommandLine -match "project_relay\.supabase_agent"
})
$launchers = @($processes | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $managedPython)
})

# On Windows a venv python.exe can launch the base interpreter as a child.
# The child belongs to the same managed process tree and is not a duplicate.
if ($launchers.Count -eq 1) {
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
