# R7.6 Studio deployment

The deployment is intentionally separate from the live Andy's Bot process.

## Destination

`C:\AndysBot\Andys_Bot_Desktop_Current\r7_6_execution_quality_shadow`

## What runs

- `r76_shadow_overlay.py` — reads the existing local `/api/live` payload and adds microstructure evidence to R7.5 shadow candidates.
- `live_tca_daemon.py` — read-only transaction-cost / markout recorder.
- `AndysBot R7.6 Shadow Watchdog` — every five minutes, ensures those two research processes are running.

## Safety

The deployer runs Python compilation and all R7.6 self-tests before copying anything to the destination. It refuses deployment if Andy's Bot is not reachable on port 8787. It does not change the live manifest, settings, Auto Buy, risk ceilings, Coinbase credentials, orders, stops or targets.

## Command

From an authenticated Studio PowerShell session:

```powershell
$u='https://raw.githubusercontent.com/chipblock2/andys-bot-updates/main/agentic-r7.6-execution-quality/deploy_r76_shadow.ps1'
$f=Join-Path $env:TEMP 'deploy_r76_shadow.ps1'
Invoke-WebRequest -UseBasicParsing $u -OutFile $f
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f
```

After deployment, inspect `r76_deployment_status.json` in the destination. All booleans for tests/processes should be true and all live-change booleans should be false.
