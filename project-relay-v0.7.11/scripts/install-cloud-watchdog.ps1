param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cloudWatchdog = Join-Path $root "scripts\watchdog-cloud-agent.ps1"
$mcpWatchdog = Join-Path $root "scripts\watchdog-mcp.ps1"
$wrapper = Join-Path $root "scripts\relay-hidden.vbs"

if (-not (Test-Path $cloudWatchdog)) {
    throw "Relay cloud watchdog not found: $cloudWatchdog"
}
if (-not (Test-Path $mcpWatchdog)) {
    throw "Relay MCP watchdog not found: $mcpWatchdog"
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

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

function Register-RelayWatchdogTask(
    [string]$TaskName,
    [string]$ScriptPath,
    [string]$LogonDelay
) {
    $arguments = '"' + $wrapper + '" "' + $ScriptPath + '"'
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arguments
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $logon.Delay = $LogonDelay
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $repeat) -Settings $settings -Principal $principal -Description "Independent Project Relay self-recovery watchdog that runs without opening a console window." -Force | Out-Null
}

Register-RelayWatchdogTask "Project Relay Cloud Watchdog" $cloudWatchdog "PT30S"
Register-RelayWatchdogTask "Project Relay MCP Watchdog" $mcpWatchdog "PT25S"

if (-not $Quiet) {
    Write-Host "Installed scheduled tasks: Project Relay Cloud Watchdog, Project Relay MCP Watchdog"
}
