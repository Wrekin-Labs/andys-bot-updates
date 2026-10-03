from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from . import __version__
from .state import atomic_write_json, state_dir
from .update_health import record_success, record_failure

PENDING_FILE = "post-update-pending.json"
HEALTH_WINDOW_SECONDS = 5 * 60


def _path() -> Path:
    return state_dir() / PENDING_FILE


def mark_pending(version: str, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    data = {"version": str(version), "started_at": now, "deadline": now + HEALTH_WINDOW_SECONDS}
    atomic_write_json(_path(), data)
    return data


def pending() -> dict[str, Any] | None:
    path = _path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return raw if isinstance(raw, dict) else None


def confirm_healthy(now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    item = pending()
    if not item:
        return {"confirmed": False, "reason": "nothing-pending"}
    version = str(item.get("version") or "")
    if not version or version != __version__:
        record_failure(version or "unknown", now)
        return {"confirmed": False, "reason": "version-mismatch", "expected": version, "actual": __version__}
    if now > float(item.get("deadline") or 0):
        record_failure(version, now)
        return {"confirmed": False, "reason": "health-window-expired", "version": version}
    record_success(version, now)
    _path().unlink(missing_ok=True)
    return {"confirmed": True, "version": version}


def status(now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    item = pending()
    if not item:
        return {"pending": False}
    return {
        "pending": True,
        "version": item.get("version"),
        "deadline": item.get("deadline"),
        "expired": now > float(item.get("deadline") or 0),
    }
