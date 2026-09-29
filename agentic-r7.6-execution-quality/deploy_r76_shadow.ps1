param(
  [string]$Ref='main'
)
$ErrorActionPreference='Stop'
$Dest='C:\AndysBot\Andys_Bot_Desktop_Current\r7_6_execution_quality_shadow'
$Base="https://raw.githubusercontent.com/chipblock2/andys-bot-updates/$Ref/agentic-r7.6-execution-quality"
$Stage=Join-Path $env:TEMP ('andys-r76-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$Files=@(
  'config.json',
  'README.md',
  'RESEARCH_NOTES.md',
  'microstructure_quality.py',
  'queue_fill_model.py',
  'execution_tca.py',
  'statistical_promotion_guard.py',
  'correlation_risk_governor.py',
  'edge_drift_monitor.py',
  'selection_bias_guard.py',
  'tail_risk_guard.py',
  'regime_promotion_guard.py',
  'research_promotion_bundle.py',
  'r76_shadow_overlay.py',
  'live_tca_daemon.py',
  'self_test.py',
  'self_test_extended.py',
  'self_test_selection_bias.py',
  'self_test_tail_regime.py',
  'start_r76_shadow.ps1'
)

try {
  foreach($file in $Files){
    $url="$Base/$file"
    $out=Join-Path $Stage $file
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
    if(-not (Test-Path $out)){ throw "Download failed: $file" }
  }

  $PyCandidates=@(
    'C:\Users\Andy\AppData\Local\Programs\Python\Python312\python.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe')
  )
  $Py=$PyCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if(-not $Py){
    $cmd=Get-Command python.exe -ErrorAction SilentlyContinue
    if($cmd){$Py=$cmd.Source}
  }
  if(-not $Py){ throw 'python.exe not found' }

  Push-Location $Stage
  try {
    $PyFiles=(Get-ChildItem -Path $Stage -Filter '*.py').FullName
    & $Py -m py_compile @PyFiles
    if($LASTEXITCODE -ne 0){ throw 'R7.6 compile check failed' }

    & $Py .\self_test.py
    if($LASTEXITCODE -ne 0){ throw 'R7.6 base self-test failed' }
    & $Py .\self_test_extended.py
    if($LASTEXITCODE -ne 0){ throw 'R7.6 extended self-test failed' }
    & $Py .\self_test_selection_bias.py
    if($LASTEXITCODE -ne 0){ throw 'R7.6 selection-bias self-test failed' }
    & $Py .\self_test_tail_regime.py
    if($LASTEXITCODE -ne 0){ throw 'R7.6 tail/regime self-test failed' }
  } finally {
    Pop-Location
  }

  try {
    $null=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/live' -TimeoutSec 8
    $LiveApi=$true
  } catch {
    throw 'Andy''s Bot live API is not reachable on 127.0.0.1:8787; R7.6 was not installed.'
  }

  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  foreach($file in $Files){
    Copy-Item -Force (Join-Path $Stage $file) (Join-Path $Dest $file)
  }

  $Start=Join-Path $Dest 'start_r76_shadow.ps1'
  schtasks.exe /Create /F /SC MINUTE /MO 5 /TN 'AndysBot R7.6 Shadow Watchdog' /TR ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+$Start+'"') | Out-Host
  if($LASTEXITCODE -ne 0){ throw 'Could not install R7.6 watchdog task' }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Start
  Start-Sleep -Seconds 6

  $procs=Get-CimInstance Win32_Process
  $Overlay=[bool]($procs | Where-Object { $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -like '*r76_shadow_overlay.py*' })
  $Tca=[bool]($procs | Where-Object { $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -like '*live_tca_daemon.py*' })
  if(-not $Overlay -or -not $Tca){ throw "R7.6 processes did not both start (overlay=$Overlay tca=$Tca)" }

  $Status=[ordered]@{
    schema='andys-bot-r7.6-deployment-v1'
    deployed_utc=[DateTime]::UtcNow.ToString('s')+'Z'
    source_ref=$Ref
    destination=$Dest
    tests_passed=$true
    live_api_reachable=$LiveApi
    shadow_overlay_running=$Overlay
    live_tca_running=$Tca
    watchdog_installed=$true
    live_bot_modified=$false
    auto_buy_changed=$false
    risk_limits_changed=$false
    order_capability_added=$false
  }
  $Status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $Dest 'r76_deployment_status.json')
  Write-Host 'R7.6 shadow deployment verified.' -ForegroundColor Green
  $Status | Format-List | Out-Host
}
finally {
  Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
}
