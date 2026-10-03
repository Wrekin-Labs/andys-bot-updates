param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'RelayDesk\Rescue'),
    [int]$Port = 8790
)
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item (Join-Path $source 'rescue_host.py') (Join-Path $InstallRoot 'rescue_host.py') -Force

$python = $null
try { $python = (& py -3.12 -c 'import sys; print(sys.executable)' 2>$null).Trim() } catch {}
if (-not $python) { throw 'Python 3.12 is required for RelayDesk Rescue.' }
$venv = Join-Path $InstallRoot '.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { & $python -m venv $venv }
$venvPython = Join-Path $venv 'Scripts\python.exe'
& $venvPython -m pip install --quiet --upgrade pip mss Pillow
if ($LASTEXITCODE -ne 0) { throw 'Could not install RelayDesk Rescue dependencies.' }

$taskName = 'RelayDesk Rescue Host'
$action = New-ScheduledTaskAction -Execute $venvPython -Argument ('"' + (Join-Path $InstallRoot 'rescue_host.py') + '" --port ' + $Port)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT15S'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Tailnet-only RelayDesk emergency view/control and exact Project Relay recovery.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$tokenPath = Join-Path $env:LOCALAPPDATA 'RelayDesk\rescue.token'
Write-Host "RelayDesk Rescue installed. Task: $taskName"
Write-Host "Token file: $tokenPath"
Write-Host 'Project Relay 0.7.12 unattended recovery remains the boot-without-login recovery path.'
