param(
    [switch]$Disable
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stateRoot = Split-Path -Parent $root
$runner = Join-Path $root "scripts\unattended-cloud-recovery.ps1"
$probeScript = Join-Path $root "scripts\probe-unattended-recovery.ps1"
$taskName = "Project Relay Unattended Recovery"
$probeTaskName = "Project Relay Unattended Recovery Probe"
$probeOutput = Join-Path $stateRoot "unattended-recovery-probe.json"

function Test-IsAdministrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw "Unattended recovery requires one elevated local install. Re-run this script from an Administrator PowerShell session."
}

if ($Disable) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task: $taskName"
    exit 0
}

foreach ($required in @($runner, $probeScript)) {
    if (-not (Test-Path $required)) {
        throw "Required Project Relay recovery component is missing: $required"
    }
}

$identityName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identityName -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Remove-Item $probeOutput -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $probeTaskName -Confirm:$false -ErrorAction SilentlyContinue

$probeArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $probeScript + '" -StateRoot "' + $stateRoot + '" -OutputPath "' + $probeOutput + '"'
$probeAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $probeArguments

try {
    Register-ScheduledTask -TaskName $probeTaskName -Action $probeAction -Principal $principal -Settings $settings -Description "Temporary Project Relay S4U security and connectivity probe." -Force | Out-Null
    Start-ScheduledTask -TaskName $probeTaskName

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $probeOutput)) {
        Start-Sleep -Milliseconds 500
    }

    if (-not (Test-Path $probeOutput)) {
        throw "The unattended recovery probe did not complete."
    }

    $probe = Get-Content $probeOutput -Raw | ConvertFrom-Json
    if (-not $probe.state_ok) {
        throw "The unattended recovery probe could not read the existing Project Relay state."
    }
    if (-not $probe.dpapi_ok) {
        throw "Windows S4U could not decrypt the existing user-scoped Project Relay device credential. Unattended recovery was not enabled."
    }
    if (-not $probe.network_ok) {
        throw "Windows S4U could not reach the configured Project Relay cloud endpoint. Unattended recovery was not enabled."
    }
} finally {
    Unregister-ScheduledTask -TaskName $probeTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item $probeOutput -Force -ErrorAction SilentlyContinue
}

$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -StateRoot "' + $stateRoot + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$startup = New-ScheduledTaskTrigger -AtStartup
$startup.Delay = "PT30S"
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startup, $repeat) -Principal $principal -Settings $settings -Description "Passwordless S4U recovery for the Project Relay cloud agent. A local DPAPI/network probe must pass before installation." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed scheduled task: $taskName"
Write-Host "Project Relay can now recover its cloud agent after boot without requiring an interactive Windows sign-in."
Write-Host "Interactive logon still takes ownership of the agent session for desktop/UI capabilities."
