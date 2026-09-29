$ErrorActionPreference='Stop'
$Here='C:\AndysBot\Andys_Bot_Desktop_Current\r7_6_execution_quality_shadow'

$PywCandidates=@(
  'C:\Users\Andy\AppData\Local\Programs\Python\Python312\pythonw.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\pythonw.exe')
)
$Pyw=$PywCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if(-not $Pyw){
  $cmd=Get-Command pythonw.exe -ErrorAction SilentlyContinue
  if($cmd){$Pyw=$cmd.Source}
}
if(-not $Pyw){ throw 'pythonw.exe not found' }

$jobs=@(
  'r76_shadow_overlay.py',
  'live_tca_daemon.py'
)
foreach($file in $jobs){
  $target=Join-Path $Here $file
  if(-not (Test-Path $target)){ throw "Missing R7.6 file: $target" }
  $running=Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -like ('*'+$file+'*')
  }
  if(-not $running){
    Start-Process -FilePath $Pyw -ArgumentList ('"'+$target+'"') -WorkingDirectory $Here -WindowStyle Hidden
  }
}
