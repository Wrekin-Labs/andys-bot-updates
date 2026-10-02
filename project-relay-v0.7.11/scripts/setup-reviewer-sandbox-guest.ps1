# Runs only inside the disposable Windows Sandbox.
[CmdletBinding()]
param([string]$InstallCodeFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$payload = 'C:\RelayReviewPayload'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or -not (Test-Path -LiteralPath $payload)) {
    throw 'Run this script only inside the configured reviewer Windows Sandbox.'
}
$archive = Join-Path $payload 'ProjectRelay-v0.7.6.zip'
$pythonInstaller = Join-Path $payload 'python-3.12.10-amd64.exe'
$expectedRelay = '4ed819165244ff5f389c1ec7ba54f3df0de9196b89f47902526eddd5aa6f80e5'
$expectedPython = '67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb'
foreach ($item in @(@($archive, $expectedRelay), @($pythonInstaller, $expectedPython))) {
    if ((Get-FileHash -LiteralPath $item[0] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item[1]) {
        throw "Checksum mismatch: $($item[0])"
    }
}
$pythonRoot = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312'
$python = Join-Path $pythonRoot 'python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    Write-Host 'Installing Python inside this disposable Sandbox...'
    $arguments = '/quiet /norestart InstallAllUsers=0 Include_launcher=0 Include_test=0 PrependPath=0 TargetDir="' + $pythonRoot + '"'
    $install = Start-Process -FilePath $pythonInstaller -ArgumentList $arguments -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Python installer exited with code $($install.ExitCode)" }
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Guest Python installation was not found.' }
$env:PATH = $pythonRoot + ';' + (Join-Path $pythonRoot 'Scripts') + ';' + $env:PATH
$source = Join-Path $env:LOCALAPPDATA 'RelayReviewSource'
if (-not (Test-Path -LiteralPath $source)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $source
}
Write-Host ''
# Let Windows populate its trusted-root cache before Python creates its SSL context.
Invoke-WebRequest -UseBasicParsing -Uri 'https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-release?channel=stable' -TimeoutSec 20 | Out-Null
Write-Host 'Use a fresh install code from the dedicated reviewer account.'
Write-Host 'Do not enter your production account installation code.'
$installArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $source 'scripts\install-customer.ps1'), '-DeviceName', 'Review-PC', '-SkipPythonInstall')
if ($InstallCodeFile) {
    $enrollment = Get-Content -Raw -LiteralPath $InstallCodeFile | ConvertFrom-Json
    if ([DateTimeOffset]::Parse($enrollment.expires_at) -le [DateTimeOffset]::UtcNow) { throw 'Reviewer installation code expired.' }
    if ($enrollment.code -notmatch '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$') { throw 'Invalid reviewer installation code.' }
    $installArgs += @('-InstallCode', $enrollment.code)
}
& powershell.exe @installArgs
if ($LASTEXITCODE -ne 0) { throw 'Reviewer enrollment or installation failed.' }
$app = Join-Path $env:LOCALAPPDATA 'ProjectRelay\App'
$relayPython = Join-Path $app '.venv\Scripts\python.exe'
& $relayPython (Join-Path $payload 'setup-review-fixture.py')
if ($LASTEXITCODE -ne 0) { throw 'Review fixture creation failed.' }
$pythonw = Join-Path $app '.venv\Scripts\pythonw.exe'
Start-Process -FilePath $pythonw -ArgumentList '-m project_relay.gui' -WorkingDirectory $app
Start-Process -FilePath $pythonw -ArgumentList ('"' + (Join-Path $app 'scripts\reviewer-demo-window.py') + '"') -WorkingDirectory $app
Write-Host ''
Write-Host 'Enrollment and fixtures are ready. Owner controls remain governed by local consent.'
Write-Host 'In the guest Relay app, locally approve the fixture folder and any required owner controls.'
Write-Host 'Keep this Sandbox open during review. Closing it deletes its enrollment and files.'
