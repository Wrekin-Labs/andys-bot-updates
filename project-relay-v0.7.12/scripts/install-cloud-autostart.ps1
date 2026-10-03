$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcher = Join-Path $root "scripts\ensure-cloud-agent.ps1"
$taskName = "Project Relay Cloud Agent"

if (-not (Test-Path $launcher)) {
    throw "Relay cloud launcher not found: $launcher"
}

$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -PreferInteractiveSession'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT20S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts the outbound-only Project Relay cloud agent at interactive user logon and takes over from unattended recovery without storing a Windows password." -Force | Out-Null
Write-Host "Installed scheduled task: $taskName"

$watchdogInstaller = Join-Path $root "scripts\install-cloud-watchdog.ps1"
if (-not (Test-Path $watchdogInstaller)) {
    throw "Relay cloud watchdog installer not found: $watchdogInstaller"
}
& $watchdogInstaller -Quiet
