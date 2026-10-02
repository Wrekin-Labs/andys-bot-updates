from __future__ import annotations

import subprocess
from typing import Any

from .owner_full_control import require_enabled


def service(name: str, action: str) -> dict[str, Any]:
    require_enabled()
    if not name or len(name) > 256:
        raise ValueError("invalid service name")
    if action not in {"start", "stop", "restart"}:
        raise ValueError("action must be start, stop or restart")
    script = {
        "start": "Start-Service -Name $args[0] -ErrorAction Stop",
        "stop": "Stop-Service -Name $args[0] -ErrorAction Stop",
        "restart": "Restart-Service -Name $args[0] -ErrorAction Stop",
    }[action]
    proc = subprocess.run(
        ["powershell.exe","-NoProfile","-NonInteractive","-Command",script,name],
        capture_output=True,text=True,timeout=60,check=False,
    )
    return {"name": name, "action": action, "success": proc.returncode == 0, "returncode": proc.returncode}
