from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .audit import AuditLog
from .state import atomic_write_json, state_dir

CONFIG = "owner-full-control.json"


def _path() -> Path:
    return state_dir() / CONFIG


def status() -> dict[str, Any]:
    path = _path()
    enabled = False
    enabled_at = None
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            enabled = raw.get("enabled") is True
            enabled_at = raw.get("enabled_at")
        except Exception:
            enabled = False
    return {"enabled": enabled, "enabled_at": enabled_at}


def set_local(enabled: bool) -> dict[str, Any]:
    """Local workstation UI/setup code may explicitly enable or revoke owner full control."""
    now = time.time()
    data = {"enabled": bool(enabled), "enabled_at": now if enabled else None}
    atomic_write_json(_path(), data)
    AuditLog(state_dir() / "audit.jsonl").append(
        "owner_full_control.enabled" if enabled else "owner_full_control.revoked",
        {"enabled": bool(enabled)},
    )
    return status()


def require_enabled() -> None:
    if not status()["enabled"]:
        raise PermissionError("Owner Full Control is not enabled on this workstation")
