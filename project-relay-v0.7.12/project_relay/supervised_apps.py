from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .audit import AuditLog
from .owner_full_control import require_enabled
from .state import atomic_write_json, state_dir

REGISTRY = "supervised-apps.json"


def _path() -> Path:
    return state_dir() / REGISTRY


def _load() -> dict[str, dict[str, Any]]:
    if not _path().is_file():
        return {}
    try:
        raw = json.loads(_path().read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def list_apps() -> dict[str, Any]:
    apps = _load()
    # Do not expose arguments: they may contain credentials.
    safe = [
        {"name": name, "executable": item.get("executable"), "enabled": item.get("enabled", True)}
        for name, item in sorted(apps.items())
    ]
    return {"count": len(safe), "apps": safe}


def register_local(name: str, executable: str, args: list[str] | None = None) -> dict[str, Any]:
    """Local setup registers an exact executable; remote callers cannot create persistence."""
    name = str(name).strip()
    exe = Path(str(executable)).expanduser().resolve(strict=False)
    if not name or len(name) > 80:
        raise ValueError("invalid supervised app name")
    if os.name == "nt" and exe.suffix.casefold() not in {".exe", ".com", ".bat", ".cmd", ".py", ".pyw"}:
        raise ValueError("unsupported executable type")
    argv = [str(v) for v in (args or [])]
    if len(argv) > 32 or any(len(v) > 1024 for v in argv):
        raise ValueError("arguments exceed supervised app limits")
    apps = _load()
    apps[name] = {"executable": str(exe), "args": argv, "enabled": True, "registered_at": time.time()}
    atomic_write_json(_path(), apps)
    AuditLog(state_dir() / "audit.jsonl").append("supervised_app.registered", {"name": name})
    return {"registered": True, "name": name, "executable": str(exe)}


def _matching_pids(executable: str, args: list[str] | None = None) -> list[int]:
    if os.name != "nt":
        raise RuntimeError("Supervised application management requires Windows")
    identity = [str(v) for v in (args or [])]
    script = (
        "$p=[IO.Path]::GetFullPath($args[0]);$need=@($args[1..($args.Count-1)]);"
        "Get-CimInstance Win32_Process | Where-Object { "
        "$ok=$_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $p);"
        "if($ok -and $need.Count){$cmd=[string]$_.CommandLine;foreach($n in $need){"
        "if($n -and $cmd.IndexOf($n,[StringComparison]::OrdinalIgnoreCase) -lt 0){$ok=$false;break}}};$ok } | "
        "Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress"
    )
    r = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script,executable,*identity],
                       text=True,capture_output=True,timeout=15,check=False)
    if r.returncode:
        raise RuntimeError("Cannot inspect supervised application")
    raw = json.loads(r.stdout or "[]")
    if isinstance(raw, int):
        return [raw]
    return [int(v) for v in raw] if isinstance(raw, list) else []


def app_status(name: str) -> dict[str, Any]:
    app = _load().get(str(name))
    if not app:
        raise KeyError("unknown supervised app")
    pids = _matching_pids(app["executable"], app.get("args", []))
    return {
        "name": str(name), "running": len(pids) == 1,
        "instances": len(pids), "duplicate": len(pids) > 1,
        "pids": pids[:8],
    }


def owner_start(name: str) -> dict[str, Any]:
    require_enabled()
    apps = _load(); app = apps.get(str(name))
    if not app or not app.get("enabled", True):
        raise KeyError("unknown or disabled supervised app")
    state = app_status(name)
    if state["instances"]:
        return {"started": False, "reason": "already-running", **state}
    subprocess.Popen([app["executable"], *app.get("args", [])], close_fds=True)
    AuditLog(state_dir() / "audit.jsonl").append("supervised_app.started", {"name": str(name)})
    return {"started": True, "name": str(name)}


def owner_restart(name: str) -> dict[str, Any]:
    require_enabled()
    apps = _load(); app = apps.get(str(name))
    if not app or not app.get("enabled", True):
        raise KeyError("unknown or disabled supervised app")
    pids = _matching_pids(app["executable"], app.get("args", []))
    for pid in pids:
        subprocess.run(["taskkill.exe","/PID",str(pid),"/T"],capture_output=True,timeout=15,check=False)
    subprocess.Popen([app["executable"], *app.get("args", [])], close_fds=True)
    AuditLog(state_dir() / "audit.jsonl").append(
        "supervised_app.restarted", {"name": str(name), "previous_instances": len(pids)}
    )
    return {"restarted": True, "name": str(name), "previous_instances": len(pids)}
