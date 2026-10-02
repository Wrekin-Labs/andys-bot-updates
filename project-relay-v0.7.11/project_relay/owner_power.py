from __future__ import annotations

import os
import subprocess
from typing import Any

from .audit import AuditLog
from .owner_full_control import require_enabled
from .state import state_dir

POWER_ACTIONS = {"shutdown", "restart", "sleep", "lock"}


def owner_power_action(action: str, delay_seconds: int = 0) -> dict[str, Any]:
    require_enabled()
    if os.name != "nt":
        raise RuntimeError("Power actions require Windows")
    selected = str(action or "").lower().strip()
    if selected not in POWER_ACTIONS:
        raise ValueError("action must be shutdown, restart, sleep or lock")
    delay = max(0, min(int(delay_seconds), 3600))
    AuditLog(state_dir() / "audit.jsonl").append(
        "owner.power.local_gate", {"action": selected, "delay_seconds": delay}
    )

    if selected == "shutdown":
        subprocess.Popen(
            ["shutdown.exe", "/s", "/t", str(delay), "/d", "p:0:0"],
            close_fds=True,
        )
    elif selected == "restart":
        subprocess.Popen(
            ["shutdown.exe", "/r", "/t", str(delay), "/d", "p:0:0"],
            close_fds=True,
        )
    elif selected == "sleep":
        if delay:
            raise ValueError("delay_seconds is supported only for shutdown/restart")
        subprocess.Popen(
            [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; "
                "[System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)",
            ],
            close_fds=True,
        )
    else:
        if delay:
            raise ValueError("delay_seconds is supported only for shutdown/restart")
        subprocess.Popen(
            ["rundll32.exe", "user32.dll,LockWorkStation"],
            close_fds=True,
        )
    return {"accepted": True, "action": selected, "delay_seconds": delay}
