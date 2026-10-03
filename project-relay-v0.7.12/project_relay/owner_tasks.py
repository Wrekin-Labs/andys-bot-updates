from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from .owner_full_control import require_enabled

MAX_OUTPUT = 128_000
_PROTECTED = {"project relay mcp", "project relay cloud agent"}


def _ps(script: str, args: list[str] | None = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    if os.name != "nt":
        raise RuntimeError("Scheduled Task administration requires Windows")
    return subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script, *(args or [])],
        capture_output=True,
        text=True,
        timeout=max(5, min(int(timeout), 120)),
        check=False,
    )


def owner_list_scheduled_tasks(limit: int = 500) -> dict[str, Any]:
    require_enabled()
    limit = max(1, min(int(limit), 2000))
    script = (
        "Get-ScheduledTask | Sort-Object TaskPath,TaskName | "
        f"Select-Object -First {limit} TaskName,TaskPath,State | ConvertTo-Json -Compress"
    )
    proc = _ps(script)
    if proc.returncode:
        raise RuntimeError(proc.stderr.strip() or "scheduled task inspection failed")
    raw = proc.stdout.strip()
    rows = [] if not raw else json.loads(raw)
    if isinstance(rows, dict):
        rows = [rows]
    safe = [
        {
            "name": str(row.get("TaskName") or ""),
            "path": str(row.get("TaskPath") or ""),
            "state": str(row.get("State") or ""),
            "protected": str(row.get("TaskName") or "").casefold() in _PROTECTED,
        }
        for row in rows
    ]
    return {"count": len(safe), "tasks": safe}


def owner_scheduled_task_action(name: str, task_path: str = "\\", action: str = "start") -> dict[str, Any]:
    require_enabled()
    task_name = str(name or "").strip()
    path = str(task_path or "\\").strip()
    verb = str(action or "").lower().strip()
    if not task_name or len(task_name) > 240:
        raise ValueError("invalid task name")
    if not path.startswith("\\") or len(path) > 500:
        raise ValueError("invalid task path")
    if task_name.casefold() in _PROTECTED and verb in {"disable", "stop"}:
        raise PermissionError("Project Relay recovery tasks are protected from remote disable/stop")
    scripts = {
        "start": "Start-ScheduledTask -TaskName $args[0] -TaskPath $args[1] -ErrorAction Stop",
        "stop": "Stop-ScheduledTask -TaskName $args[0] -TaskPath $args[1] -ErrorAction Stop",
        "enable": "Enable-ScheduledTask -TaskName $args[0] -TaskPath $args[1] -ErrorAction Stop | Out-Null",
        "disable": "Disable-ScheduledTask -TaskName $args[0] -TaskPath $args[1] -ErrorAction Stop | Out-Null",
    }
    if verb not in scripts:
        raise ValueError("action must be start, stop, enable or disable")
    proc = _ps(scripts[verb], [task_name, path])
    if proc.returncode:
        raise RuntimeError(proc.stderr.strip()[:MAX_OUTPUT] or "scheduled task action failed")
    return {"name": task_name, "path": path, "action": verb, "success": True}
