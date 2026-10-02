$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcher = Join-Path $root "scripts\ensure-cloud-agent.ps1"
$wrapper = Join-Path $root "scripts\relay-hidden.vbs"
$taskName = "Project Relay Cloud Agent"

if (-not (Test-Path $launcher)) {
    throw "Relay cloud launcher not found: $launcher"
}
if (-not (Test-Path $wrapper)) {
$wrapperLines = @(
    'Option Explicit',
    'Dim sh, psScript, cmd',
    'If WScript.Arguments.Count < 1 Then WScript.Quit 2',
    'psScript = WScript.Arguments(0)',
    'Set sh = CreateObject("WScript.Shell")',
    'cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & psScript & Chr(34)',
    'sh.Run cmd, 0, False'
)
$wrapperLines | Set-Content -Path $wrapper -Encoding ASCII
}

$arguments = '"' + $wrapper + '" "' + $launcher + '"'
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT20S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts the outbound-only Project Relay Supabase agent at user logon without opening a console window." -Force | Out-Null
Write-Host "Installed scheduled task: $taskName"

$watchdogInstaller = Join-Path $root "scripts\install-cloud-watchdog.ps1"
if (-not (Test-Path $watchdogInstaller)) {
    throw "Relay cloud watchdog installer not found: $watchdogInstaller"
}
& $watchdogInstaller -Quiet
