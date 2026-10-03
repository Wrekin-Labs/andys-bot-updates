# Live published MCP calls, started locally for owner filming. No screen capture.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$root=Join-Path $env:LOCALAPPDATA 'ProjectRelayReviewerDemo'
. (Join-Path $root 'invoke-reviewer-tool.ps1')
$fixture='C:\Users\WDAGUtilityAccount\ProjectRelayReviewFixture'
$script:runId=Get-Date -Format 'yyyyMMdd-HHmmss'
$script:workbook=$fixture+'\demo-'+$script:runId+'.xlsx'
$script:journal=@()
$script:step=0
$form=New-Object Windows.Forms.Form
$form.Text='Project Relay - Live reviewer demonstration'
$form.WindowState='Maximized'
$form.MinimumSize=New-Object Drawing.Size(900,600)
$form.BackColor=[Drawing.ColorTranslator]::FromHtml('#111827')
$heading=New-Object Windows.Forms.Label
$heading.Dock='Top';$heading.Height=105
$heading.Padding=New-Object Windows.Forms.Padding(24,15,10,5)
$heading.ForeColor=[Drawing.Color]::White
$heading.Font=New-Object Drawing.Font('Segoe UI',19,[Drawing.FontStyle]::Bold)
$heading.Text='PROJECT RELAY 0.7.6'+[Environment]::NewLine+'Live MCP API demonstration | Dedicated Review-PC'
$output=New-Object Windows.Forms.RichTextBox
$output.Dock='Fill';$output.ReadOnly=$true;$output.BorderStyle='None'
$output.BackColor=[Drawing.ColorTranslator]::FromHtml('#111827')
$output.ForeColor=[Drawing.ColorTranslator]::FromHtml('#e5e7eb')
$output.Font=New-Object Drawing.Font('Consolas',15)
$output.WordWrap=$true
$footer=New-Object Windows.Forms.Panel
$footer.Dock='Bottom';$footer.Height=86
$start=New-Object Windows.Forms.Button
$start.Text='START LIVE DEMO'
$start.Width=270;$start.Height=56;$start.Left=24;$start.Top=15
$start.Font=New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)
$start.BackColor=[Drawing.ColorTranslator]::FromHtml('#fb923c')
$start.ForeColor=[Drawing.Color]::Black
$start.FlatStyle='Flat'
$status=New-Object Windows.Forms.Label
$status.Left=315;$status.Top=28;$status.Width=900;$status.Height=42
$status.Font=New-Object Drawing.Font('Segoe UI',13)
$status.ForeColor=[Drawing.Color]::White
$status.Text='Ready. Start your phone video, then click START LIVE DEMO.'
$footer.Controls.AddRange(@($start,$status))
$form.Controls.Add($output);$form.Controls.Add($heading);$form.Controls.Add($footer)
function Show-Line([string]$Text){
 $output.AppendText($Text+[Environment]::NewLine)
 $output.SelectionStart=$output.TextLength
 $output.ScrollToCaret()
 [Windows.Forms.Application]::DoEvents()
}
function Assert-Demo([bool]$Condition,[string]$Message){
 if(-not $Condition){throw $Message}
}
function Call-Relay([string]$Name,[hashtable]$Arguments,[string]$Label){
 Show-Line ('  Calling '+$Name+' ...')
 $r=Invoke-ReviewerTool $Name $Arguments ('demo-'+$script:runId+'-'+$Label)
 if(-not $r.structuredContent){throw ('Missing structured result from '+$Name)}
 return $r.structuredContent
}
function Save-Status([string]$State){
 [pscustomobject]@{run_id=$script:runId;state=$State;step=$script:step;updated_at=[DateTime]::UtcNow.ToString('o');evidence=$script:journal}|
 ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $root 'Diagnostics\live-demo-status.json') -Encoding UTF8
}
$steps=@(
 @{
 title='TEST 1/5 - Discover the linked reviewer PC'
 action={
  Show-Line 'Request: List linked workstations and inspect capabilities/hardware.'
  $d=Call-Relay 'list_workstations' @{} 'discovery'
  Assert-Demo (@($d.workstations).Count -eq 1) 'Expected only the dedicated Review-PC.'
  $pc=@($d.workstations)[0]
  Assert-Demo ($pc.name -eq 'Review-PC' -and $pc.online -and $pc.owner_full_control) 'Review-PC is not ready.'
  Show-Line ('  Result: '+$pc.name+' | online='+$pc.online+' | version='+$pc.version)
  Show-Line ('  Owner Full Control enabled locally: '+$pc.owner_full_control)
  $c=Call-Relay 'get_workstation_capabilities' @{relay_device='Review-PC'} 'capabilities'
  $h=Call-Relay 'list_devices' @{relay_device='Review-PC'} 'devices'
  Show-Line ('  Advertised actions: '+@($c.actions).Count)
  Show-Line ('  Hardware devices returned: '+@($h.devices).Count+' (virtual review PC)')
  Show-Line ''
  Show-Line 'PASS - only the dedicated reviewer workstation is visible.'
 }
 },
 @{
 title='TEST 2/5 - Read and search the approved fixture'
 action={
  Show-Line 'Request: List sample files, read sample.txt, find relay search target.'
  $r=Call-Relay 'commandport_get_runtime_config' @{relay_device='Review-PC'} 'runtime'
  Assert-Demo ($r.allowed_roots -contains 'C:\Users\WDAGUtilityAccount') 'Expected approved home root.'
  Show-Line ('  Approved root: '+($r.allowed_roots -join ', '))
  $d=Call-Relay 'commandport_list_directory' @{relay_device='Review-PC';path=$fixture;depth=1;max_entries=20} 'directory'
  Show-Line ('  Files: '+(($d.items|ForEach-Object name) -join ', '))
  $t=Call-Relay 'commandport_read_text_file' @{relay_device='Review-PC';path=$fixture+'\sample.txt';length=1000} 'read'
  Show-Line ('  File text: '+($t.text.Trim() -replace '\r?\n',' | '))
  $s=Call-Relay 'commandport_search_text' @{relay_device='Review-PC';path=$fixture;query='relay search target';pattern='sample.txt';max_results=10;max_depth=1} 'search'
  Assert-Demo ($t.text.Contains('Project Relay reviewer fixture') -and $s.count -eq 1 -and $s.matches[0].line -eq 2) 'Fixture read/search mismatch.'
  Show-Line 'PASS - exact match at sample.txt, line 2. No file changes.'
 }
 },
 @{
 title='TEST 3/5 - Create and read a disposable spreadsheet'
 action={
  Show-Line 'Request: Create columns name/value, with relay/76 and review/1.'
  Show-Line ('  File: '+[IO.Path]::GetFileName($script:workbook))
  $w=Call-Relay 'commandport_owner_write_xlsx' @{relay_device='Review-PC';path=$script:workbook;sheets=@{Review=@(@('name','value'),@('relay',76),@('review',1))}} 'xlsx-create'
  $script:originalHash=$w.sha256
  $r=Call-Relay 'commandport_owner_read_document' @{relay_device='Review-PC';path=$script:workbook;sheet='Review'} 'xlsx-original'
  Show-Line $r.text
  Assert-Demo ($r.sheets[0].rows[2][1] -eq '1') 'Initial spreadsheet value mismatch.'
  Show-Line ''
  Show-Line 'Created and read successfully. Next: edit then roll back.'
 }
 },
 @{
 title='TEST 3/5 - Change one cell and verify'
 action={
  Show-Line 'Request: Change review value from 1 to 2 (cell B3).'
  $u=Call-Relay 'commandport_owner_update_xlsx_cells' @{relay_device='Review-PC';path=$script:workbook;sheet='Review';cells=@{B3=2};expected_sha256=$script:originalHash} 'xlsx-update'
  $script:checkpoint=$u.checkpoint_id
  Assert-Demo (-not [string]::IsNullOrWhiteSpace($script:checkpoint)) 'No rollback checkpoint returned.'
  $r=Call-Relay 'commandport_owner_read_document' @{relay_device='Review-PC';path=$script:workbook;sheet='Review'} 'xlsx-updated'
  Show-Line $r.text
  Assert-Demo ($r.sheets[0].rows[2][1] -eq '2') 'Updated spreadsheet value mismatch.'
  Show-Line ''
  Show-Line 'Verified value = 2. The tool returned a rollback checkpoint.'
 }
 },
 @{
 title='TEST 3/5 - Restore the recorded rollback checkpoint'
 action={
  Show-Line 'Request: Restore the exact checkpoint returned by the edit.'
  $b=Call-Relay 'commandport_owner_rollback_document' @{relay_device='Review-PC';checkpoint_id=$script:checkpoint} 'xlsx-rollback'
  $r=Call-Relay 'commandport_owner_read_document' @{relay_device='Review-PC';path=$script:workbook;sheet='Review'} 'xlsx-restored'
  Show-Line $r.text
  Assert-Demo ($b.rolled_back -and $b.sha256 -eq $script:originalHash -and $r.sheets[0].rows[2][1] -eq '1') 'Rollback verification failed.'
  Show-Line ''
  Show-Line 'PASS - value restored to 1 and original file SHA-256 restored.'
 }
 },
 @{
 title='TEST 4/5 - Run one bounded PowerShell command'
 action={
  Show-Line "Request: Write-Output 'relay-review-ok'"
  $r=Call-Relay 'commandport_owner_run_command' @{relay_device='Review-PC';command="Write-Output 'relay-review-ok'";timeout_seconds=10} 'terminal'
  Show-Line ('  stdout: '+$r.stdout.Trim())
  Show-Line ('  Exit status: '+$r.returncode)
  Show-Line ('  Timed out: '+$r.timed_out)
  Assert-Demo ($r.stdout.Trim() -eq 'relay-review-ok' -and $r.returncode -eq 0 -and -not $r.timed_out) 'Terminal result mismatch.'
  Show-Line ''
  Show-Line 'PASS - expected output, successful exit, no timeout.'
 }
 },
 @{
 title='TEST 5/5 - Read-only workstation diagnostics'
 action={
  Show-Line 'Request: Inspect health, system, bounded processes and network.'
  $h=Call-Relay 'commandport_health_report' @{relay_device='Review-PC'} 'health'
  Show-Line ('  Healthy: '+$h.healthy+' | Watchdog healthy: '+$h.watchdog.healthy)
  $s=Call-Relay 'commandport_owner_system_snapshot' @{relay_device='Review-PC'} 'system'
  Show-Line ('  OS: '+$s.windows.Caption+' | Model: '+$s.windows.Model)
  Show-Line ('  CPUs: '+$s.cpu_count+' | Memory: '+[math]::Round($s.windows.TotalVisibleMemorySize/1MB,1)+' GiB')
  $p=Call-Relay 'commandport_list_process_details' @{relay_device='Review-PC';limit=10} 'processes'
  Show-Line ('  Bounded processes returned: '+$p.count)
  $n=Call-Relay 'commandport_owner_network_summary' @{relay_device='Review-PC'} 'network'
  Show-Line ('  Network interfaces: '+$n.count)
  Assert-Demo ($h.healthy -and $p.count -le 10 -and $n.count -ge 1) 'Diagnostics verification failed.'
  Show-Line ''
  Show-Line 'PASS - read-only diagnostics; no installs, restarts or scans.'
 }
 }
)
$timer=New-Object Windows.Forms.Timer
$timer.Interval=8000
$timer.Add_Tick({
 $timer.Stop()
 try {
  if($script:step -ge $steps.Count){
   $output.Clear()
   Show-Line 'LIVE DEMONSTRATION COMPLETE'
   Show-Line ''
   Show-Line '5 / 5 reviewer tool scenarios passed.'
   Show-Line '  1. Account-scoped discovery and capabilities'
   Show-Line '  2. Approved fixture listing, reading and search'
   Show-Line '  3. Spreadsheet creation, edit and exact rollback'
   Show-Line '  4. Bounded PowerShell command'
   Show-Line '  5. Read-only health and system diagnostics'
   Show-Line ''
   Show-Line 'Every result came from a fresh published MCP request.'
   Show-Line 'This window is a test client, not the ChatGPT interface.'
   Show-Line 'The reviewer account is limited to disposable Review-PC.'
   Show-Line ''
   Show-Line 'Stop filming. Keep Windows Sandbox open for review.'
   $status.Text='Complete - stop filming and upload the video in chat.'
   Save-Status 'passed'
   return
  }
  $item=$steps[$script:step]
  $output.Clear()
  Show-Line $item.title
  Show-Line ('Live run '+$script:runId+' | '+(Get-Date -Format 'HH:mm:ss'))
  Show-Line ''
  $status.Text='Running live requests. Results remain visible between steps.'
  & $item.action
  $script:journal+=@{step=$item.title;completed_at=[DateTime]::UtcNow.ToString('o');result=$output.Text}
  $script:step++
  Save-Status 'running'
  $status.Text='Step verified. Next step starts automatically.'
  $timer.Start()
 } catch {
  $message=$_.Exception.Message
  if($message.Length -gt 700){$message=$message.Substring(0,700)}
  Show-Line ''
  Show-Line ('STOPPED - '+$message)
  $status.Text='Demo stopped on a real error. No success claim was made.'
  Save-Status 'failed'
 }
})
$start.Add_Click({
 $start.Enabled=$false
 $output.Clear()
 Show-Line 'Starting live reviewer demonstration...'
 Show-Line ''
 Show-Line 'Account: dedicated reviewer, linked only to Review-PC.'
 Show-Line 'Transport: HTTPS to the published Project Relay MCP endpoint.'
 Show-Line 'Owner Full Control was enabled locally by the workstation owner.'
 Show-Line 'Only disposable review fixture data will be edited.'
 Show-Line ''
 Show-Line 'Results are fetched live. No passwords or tokens are displayed.'
 $status.Text='Starting in eight seconds. Keep filming.'
 Save-Status 'starting'
 $timer.Start()
})
$form.Add_FormClosed({$timer.Stop();$timer.Dispose()})
Show-Line 'READY TO FILM'
Show-Line ''
Show-Line '1. Point your phone camera at this window, in landscape.'
Show-Line '2. Start video recording, then click START LIVE DEMO.'
Show-Line '3. The five tests run automatically, with readable results.'
Show-Line '4. Stop recording when LIVE DEMONSTRATION COMPLETE appears.'
Show-Line ''
Show-Line 'This is a live API test client for the published Relay tools.'
Show-Line 'It does not record your screen or display account secrets.'
Show-Line ''
Show-Line 'Leave Windows Sandbox running throughout and after the demo.'
Save-Status 'ready'
[Windows.Forms.Application]::Run($form)
