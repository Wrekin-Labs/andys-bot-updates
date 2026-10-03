param(
    [string]$InstallCode,
    [string]$DeviceName = $env:COMPUTERNAME,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "ProjectRelay\App"),
    [switch]$SkipPythonInstall,
    [switch]$ValidationOnly,
    [switch]$EnableUnattendedRecovery
)

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Find-Python312 {
    try {
        $candidate = (& py -3.12 -c "import sys; print(sys.executable)" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $candidate) { return $candidate.Trim() }
    } catch {}
    try {
        $candidate = (& python -c "import sys; assert sys.version_info[:2] == (3,12); print(sys.executable)" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $candidate) { return $candidate.Trim() }
    } catch {}
    return $null
}

$python = Find-Python312
if (-not $python -and -not $SkipPythonInstall) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Python 3.12 is not installed and Winget is unavailable. Install Python 3.12, then run this installer again."
    }
    Write-Host "Installing Python 3.12 for the current user..."
    & winget install --id Python.Python.3.12 -e --scope user --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 installation failed." }
    $python = Find-Python312
}

if (-not $python) {
    throw "Python 3.12 was not found."
}

$stateRoot = Join-Path $env:LOCALAPPDATA "ProjectRelay"
$alreadyEnrolled = $ValidationOnly -or
    (Test-Path (Join-Path $stateRoot "cloud.json")) -or
    (Test-Path (Join-Path $stateRoot "cloud-device.dpapi"))

if (-not $alreadyEnrolled) {
    if (-not $InstallCode) {
        $InstallCode = Read-Host "Enter the Project Relay install code"
    }
    if (-not $InstallCode) { throw "An install code is required for a new workstation." }
} else {
    Write-Host "Existing Project Relay enrollment detected. Preserving this workstation identity."
}

Write-Host "Installing Project Relay to $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$directoryItems = @("project_relay", "scripts")
foreach ($item in $directoryItems) {
    $src = Join-Path $sourceRoot $item
    $dst = Join-Path $InstallRoot $item
    if (Test-Path $src) {
        if (Test-Path $dst) {
            Remove-Item $dst -Recurse -Force
        }
        Copy-Item $src $dst -Recurse -Force
    }
}

$fileItems = @("pyproject.toml", "README.md", "ARCHITECTURE.md", "MCP_TOOL_CONTRACT.json")
foreach ($item in $fileItems) {
    $src = Join-Path $sourceRoot $item
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $InstallRoot $item) -Force
    }
}

foreach ($stale in @("build", "project_relay.egg-info")) {
    $stalePath = Join-Path $InstallRoot $stale
    if (Test-Path $stalePath) {
        Remove-Item $stalePath -Recurse -Force
    }
}

$venvPython = Join-Path $InstallRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    & $python -m venv (Join-Path $InstallRoot ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Python environment creation failed." }
}
& $venvPython -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { throw "Pip upgrade failed; installation is incomplete." }
& $venvPython -m pip install --upgrade --force-reinstall $InstallRoot --quiet
if ($LASTEXITCODE -ne 0) { throw "Project Relay dependency installation failed; installation is incomplete." }

if ($ValidationOnly) {
    Write-Host "Running Project Relay clean-install validation..."
    $validation = & $venvPython -c "import project_relay; from project_relay.bridge_actions import bridge_action_names; assert project_relay.__version__; assert len(bridge_action_names()) >= 1; print(project_relay.__version__ + '|' + str(len(bridge_action_names())))"
    if ($LASTEXITCODE -ne 0 -or -not $validation) {
        throw "Project Relay validation import/capability check failed."
    }
    Write-Host "Project Relay validation passed: $validation"
    Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
}

if (-not $alreadyEnrolled) {
    $bootstrapExe = Join-Path $InstallRoot ".venv\Scripts\relay-bootstrap.exe"
    & $bootstrapExe --code $InstallCode --device-name $DeviceName
    if ($LASTEXITCODE -ne 0) { throw "Project Relay cloud enrollment failed." }
} else {
    Write-Host "Keeping existing cloud enrollment."
}

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\install-autostart.ps1")
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\install-cloud-autostart.ps1")

if ($EnableUnattendedRecovery) {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\install-unattended-recovery.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Project Relay unattended recovery installation failed." }
}

$venvRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot ".venv")).TrimEnd("\")
$relayProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and
    ([System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($venvRoot, [System.StringComparison]::OrdinalIgnoreCase)) -and
    ($_.CommandLine -match "project_relay\.(mcp_server|supabase_agent)")
}
foreach ($process in $relayProcesses) {
    Write-Host "Restarting Project Relay runtime process $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 750

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-mcp.ps1")
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-cloud-agent.ps1") -PreferInteractiveSession

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shortcutPath = Join-Path $startMenu "Project Relay.lnk"
$pythonw = Join-Path $InstallRoot ".venv\Scripts\pythonw.exe"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = "-m project_relay.gui"
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = "Project Relay"
$shortcut.Save()

Write-Host ""
Write-Host "Project Relay installed successfully."
Write-Host "The cloud agent and local MCP service start at Windows logon. Use -EnableUnattendedRecovery from an elevated local install to add passwordless boot-time cloud recovery."
Write-Host "Open Project Relay from the Start Menu to view devices, approvals and account pairing."


