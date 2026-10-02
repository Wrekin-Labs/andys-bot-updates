from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from .audit import AuditLog
from .owner_grants import OwnerGrantStore
from .state import state_dir
from .updater import get_release, is_newer, prepare_self_update


POWER_ACTIONS = {"shutdown", "restart", "sleep", "lock"}
SERVICE_ACTIONS = {"start", "stop", "restart"}
AUDIT = AuditLog(state_dir() / "audit.jsonl")


def commandport_process_details(limit: int = 250) -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Process details are available on Windows only")
    limit = max(1, min(int(limit), 1000))
    script = (
        "Get-CimInstance Win32_Process | "
        "Select-Object -First " + str(limit) + " ProcessId,Name,ExecutablePath,CommandLine | "
        "ConvertTo-Json -Compress"
    )
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True, text=True, timeout=20, check=False,
    )
    if proc.returncode:
        raise RuntimeError("Process inspection failed")
    raw = proc.stdout.strip()
    rows = [] if not raw else json.loads(raw)
    if isinstance(rows, dict):
        rows = [rows]
    safe = []
    for row in rows:
        cmd = str(row.get("CommandLine") or "")
        if len(cmd) > 2048:
            cmd = cmd[:2048] + "…"
        safe.append({
            "pid": row.get("ProcessId"),
            "name": row.get("Name"),
            "path": row.get("ExecutablePath"),
            "command_line": cmd,
        })
    return {"count": len(safe), "processes": safe}


def _power_args(action: str, delay_seconds: int = 0) -> dict[str, Any]:
    action = str(action or "").lower().strip()
    if action not in POWER_ACTIONS:
        raise ValueError("action must be shutdown, restart, sleep or lock")
    delay_seconds = max(0, min(int(delay_seconds), 3600))
    return {"action": action, "delay_seconds": delay_seconds}


def commandport_owner_power(grant_id: str, action: str, delay_seconds: int = 0) -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Power actions are available on Windows only")
    args = _power_args(action, delay_seconds)
    OwnerGrantStore().consume(grant_id, action="commandport_owner_power", arguments=args)
    AUDIT.append("owner.power", args)

    if args["action"] == "lock":
        subprocess.Popen(["rundll32.exe", "user32.dll,LockWorkStation"], close_fds=True)
    elif args["action"] == "sleep":
        subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)"],
            close_fds=True,
        )
    else:
        flag = "/r" if args["action"] == "restart" else "/s"
        subprocess.Popen(
            ["shutdown.exe", flag, "/t", str(args["delay_seconds"]), "/d", "p:0:0"],
            close_fds=True,
        )
    return {"accepted": True, **args}


def _service_args(name: str, action: str) -> dict[str, Any]:
    name = str(name or "").strip()
    action = str(action or "").lower().strip()
    if not name or len(name) > 128:
        raise ValueError("service name is required")
    if action not in SERVICE_ACTIONS:
        raise ValueError("action must be start, stop or restart")
    return {"name": name, "action": action}


def commandport_owner_service(grant_id: str, name: str, action: str) -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Service actions are available on Windows only")
    args = _service_args(name, action)
    OwnerGrantStore().consume(grant_id, action="commandport_owner_service", arguments=args)
    AUDIT.append("owner.service", args)
    verb = {"start": "Start-Service", "stop": "Stop-Service", "restart": "Restart-Service"}[args["action"]]
    script = f"{verb} -Name '{args['name'].replace("'", "''")}' -ErrorAction Stop"
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if proc.returncode:
        raise RuntimeError("Service action failed")
    return {"ok": True, **args}


def commandport_owner_update(grant_id: str, channel: str = "stable") -> dict[str, Any]:
    args = {"channel": str(channel or "stable").lower().strip()}
    if args["channel"] not in {"stable", "beta"}:
        raise ValueError("channel must be stable or beta")
    OwnerGrantStore().consume(grant_id, action="commandport_owner_update", arguments=args)
    release = get_release(channel=args["channel"])
    if not release:
        return {"update_available": False, "reason": "no published release"}
    version = str(release.get("version") or "")
    if not is_newer(version):
        return {"update_available": False, "version": version}
    path = prepare_self_update(release)
    AUDIT.append("owner.update", {"channel": args["channel"], "version": version})
    return {"update_available": True, "version": version, "staged": str(path)}
