# Calls only the dedicated reviewer account's normal MCP token.
function Invoke-ReviewerTool([string]$Name,[hashtable]$Arguments,[string]$Label) {
 $ErrorActionPreference='Stop'
 $root=Join-Path $env:LOCALAPPDATA 'ProjectRelayReviewerDemo'
 $s=(Get-Content -Raw -LiteralPath (Join-Path $root 'Private\reviewer-oauth.dpapi')).Trim()|ConvertTo-SecureString
 $token=([Net.NetworkCredential]::new('',$s)).Password|ConvertFrom-Json
 $body=@{jsonrpc='2.0';id=1;method='tools/call';params=@{name=$Name;arguments=$Arguments}}|ConvertTo-Json -Depth 20 -Compress
 $r=Invoke-RestMethod -Method Post -Uri 'https://project-relay-mcp-gateway.onrender.com/mcp' -Headers @{Authorization='Bearer '+$token.access_token;Accept='application/json, text/event-stream'} -ContentType 'application/json' -Body $body -TimeoutSec 70
 $r|ConvertTo-Json -Depth 60|Set-Content -LiteralPath (Join-Path $root ('Diagnostics\test-'+$Label+'.json')) -Encoding UTF8
 if($r.error){throw ($r.error|ConvertTo-Json -Compress)}
 if($r.result.isError){throw (($r.result.content|Where-Object type -eq 'text'|ForEach-Object text)-join ' ')}
 return $r.result
}
