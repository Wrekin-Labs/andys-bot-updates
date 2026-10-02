from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from . import __version__
from .state import state_dir


def maintenance_status() -> dict[str, Any]:
    """Return non-sensitive workstation maintenance state."""
    root = state_dir()
    updates = root / "updates"
    log = updates / "update.log"
    result: dict[str, Any] = {
        "version": __version__,
        "platform": "windows" if os.name == "nt" else os.name,
        "self_update_supported": os.name == "nt",
        "update_log_present": log.is_file(),
        "rollback_available": False,
    }
    rollback = root / "rollback"
    if rollback.is_dir():
        try:
            result["rollback_available"] = any(p.is_dir() for p in rollback.iterdir())
        except OSError:
            pass
    if log.is_file():
        try:
            stat = log.stat()
            result["last_update_log_mtime"] = stat.st_mtime
            result["last_update_log_age_seconds"] = max(0, int(time.time() - stat.st_mtime))
        except OSError:
            pass
    return result
