# Authorized publisher integration check for the dedicated reviewer account.
# Uses the normal public-client PKCE flow; never seeds tokens or changes roles.
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'ProjectRelayReviewerDemo'
$origin='https://project-relay-mcp-gateway.onrender.com'
$client='https://chatgpt.com/oauth/client.json'
$redirect='https://chatgpt.com/connector_platform_oauth_redirect'
function Query($values){($values.GetEnumerator()|ForEach-Object{[uri]::EscapeDataString($_.Key)+'='+[uri]::EscapeDataString([string]$_.Value)}) -join '&'}
function Protect($value,$file){$value|ConvertTo-Json -Depth 20 -Compress|ConvertTo-SecureString -AsPlainText -Force|ConvertFrom-SecureString|Set-Content -LiteralPath (Join-Path $root ('Private\'+$file)) -Encoding UTF8}
$bytes=New-Object byte[] 48
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$verifier=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$sha=[Security.Cryptography.SHA256]::Create()
$challenge=[Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))).TrimEnd('=').Replace('+','-').Replace('/','_')
$state=[guid]::NewGuid().ToString('N')
$query=Query @{response_type='code';client_id=$client;redirect_uri=$redirect;resource=$origin+'/mcp';scope='relay:inspect openid email';code_challenge=$challenge;code_challenge_method='S256';state=$state}
$page=Invoke-WebRequest -UseBasicParsing -Uri ($origin+'/oauth/authorize?'+$query) -TimeoutSec 25
$requestId=[regex]::Match($page.Content,'const requestId=("[^"]+");').Groups[1].Value|ConvertFrom-Json
$pub=[regex]::Match($page.Content,'createClient\("[^"]+","([^"]+)"').Groups[1].Value
if(-not $requestId -or -not $pub){throw 'Authorization page missing expected public configuration'}
$secret=(Get-Content -Raw -LiteralPath (Join-Path $root 'Private\reviewer-credentials.dpapi')).Trim()|ConvertTo-SecureString
$creds=([Net.NetworkCredential]::new('',$secret)).Password|ConvertFrom-Json
if($creds.email -ne 'andyeastment+relay-review@gmail.com'){throw 'Unexpected reviewer identity'}
$session=Invoke-RestMethod -Method Post -Uri 'https://dbhwjzznwhukoogjewfl.supabase.co/auth/v1/token?grant_type=password' -Headers @{apikey=$pub} -ContentType 'application/json' -Body ($creds|ConvertTo-Json -Compress) -TimeoutSec 20
if($session.user.id -ne '7ecec2d1-d23a-4c6c-b31d-a8eadb65c843'){throw 'Unexpected authenticated user'}
Protect $session 'reviewer-session.dpapi'
$return=Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($origin+'/oauth/approve') -Body @{request_id=$requestId;decision='allow';user_access_token=$session.access_token} -TimeoutSec 25
$link=[Net.WebUtility]::HtmlDecode([regex]::Match($return.Content,'<a href="([^"]+)"').Groups[1].Value)
if(-not $link.StartsWith($redirect+'?')){throw 'Unexpected callback'}
Add-Type -AssemblyName System.Web
$values=[Web.HttpUtility]::ParseQueryString(([uri]$link).Query)
if($values['state'] -ne $state -or $values['iss'] -ne $origin -or -not $values['code']){throw 'Callback validation failed'}
$token=Invoke-RestMethod -Method Post -Uri ($origin+'/oauth/token') -Body @{grant_type='authorization_code';code=$values['code'];client_id=$client;redirect_uri=$redirect;resource=$origin+'/mcp';code_verifier=$verifier} -TimeoutSec 25
if(-not $token.access_token){throw 'No scoped token'}
Protect $token 'reviewer-oauth.dpapi'
$headers=@{Authorization='Bearer '+$token.access_token;Accept='application/json, text/event-stream'}
$body=@{jsonrpc='2.0';id=1;method='tools/call';params=@{name='list_workstations';arguments=@{}}}|ConvertTo-Json -Depth 6
$result=Invoke-RestMethod -Method Post -Uri ($origin+'/mcp') -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 25
$result|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $root 'Diagnostics\reviewer-discovery.json') -Encoding UTF8
$result|ConvertTo-Json -Depth 20 -Compress
