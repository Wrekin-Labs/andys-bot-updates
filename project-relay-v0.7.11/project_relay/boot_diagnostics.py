from __future__ import annotations

import json
import os
import subprocess
from typing import Any


def boot_diagnostics() -> dict[str, Any]:
    """Return bounded Windows boot-performance evidence without document/user content."""
    if os.name != "nt":
        raise RuntimeError("Boot diagnostics requires Windows")

    ps = r"""
$boot = Get-WinEvent -FilterHashtable @{
 LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=100
} -MaxEvents 1 -ErrorAction SilentlyContinue
$slow = Get-WinEvent -FilterHashtable @{
 LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=101,102,103,106,107,108,109,110
} -MaxEvents 12 -ErrorAction SilentlyContinue
[pscustomobject]@{
 boot = if($boot){@{time=$boot.TimeCreated.ToString('o'); message=$boot.Message.Substring(0,[Math]::Min(1800,$boot.Message.Length))}}else{$null}
 degradations = @($slow | ForEach-Object {@{
   id=$_.Id; time=$_.TimeCreated.ToString('o');
   message=$_.Message.Substring(0,[Math]::Min(1200,$_.Message.Length))
 }})
} | ConvertTo-Json -Depth 5 -Compress
"""
    proc = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
        capture_output=True, text=True, timeout=20, check=False,
    )
    if proc.returncode:
        return {"available": False, "reason": "event-query-failed"}
    try:
        data = json.loads(proc.stdout)
    except Exception:
        return {"available": False, "reason": "event-query-invalid"}
    return {"available": True, **data}
