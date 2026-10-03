from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from .state import state_dir


def watchdog_status(max_heartbeat_age: int = 180) -> dict[str, Any]:
    """Report bounded local agent health without process contents or secrets."""
    max_heartbeat_age = max(30, min(int(max_heartbeat_age), 3600))
    root = state_dir()
    heartbeat = root / "heartbeat.json"
    result: dict[str, Any] = {
        "healthy": False,
        "heartbeat_present": heartbeat.is_file(),
        "heartbeat_age_seconds": None,
        "max_heartbeat_age_seconds": max_heartbeat_age,
    }
    if heartbeat.is_file():
        try:
            age = max(0, int(time.time() - heartbeat.stat().st_mtime))
            result["heartbeat_age_seconds"] = age
            result["healthy"] = age <= max_heartbeat_age
        except OSError:
            pass
    return result
