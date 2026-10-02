from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from . import __version__
from .state import state_dir
from .updater import get_release, is_newer, prepare_self_update
from .update_health import can_attempt, record_attempt, record_failure, public_status
from .post_update import mark_pending

POLICY_FILE = "auto-update.json"


def policy_path() -> Path:
    return state_dir() / POLICY_FILE


def load_policy() -> dict[str, Any]:
    defaults = {
        "enabled": True,
        "channel": "stable",
        "allow_beta": False,
    }
    path = policy_path()
    if not path.is_file():
        return defaults
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return defaults
    # Stable-only is intentional for unattended updates.
    defaults["enabled"] = bool(raw.get("enabled", True))
    defaults["channel"] = "stable"
    defaults["allow_beta"] = False
    return defaults


def check_auto_update() -> dict[str, Any]:
    policy = load_policy()
    result: dict[str, Any] = {
        "enabled": policy["enabled"],
        "channel": "stable",
        "current_version": __version__,
        "update_available": False,
    }
    if not policy["enabled"]:
        return result
    release = get_release(channel="stable")
    if not release:
        return result
    version = str(release.get("version") or "")
    result["latest_version"] = version
    result["update_available"] = is_newer(version)
    return result


def apply_auto_update() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Automatic update installation is supported on Windows only")
    policy = load_policy()
    if not policy["enabled"]:
        return {"started": False, "reason": "disabled"}
    if not can_attempt():
        return {
            "started": False,
            "reason": "backoff-active",
            "health": public_status(),
        }
    release = get_release(channel="stable")
    if not release:
        return {"started": False, "reason": "no-stable-release"}
    version = str(release.get("version") or "")
    if not is_newer(version):
        return {"started": False, "reason": "already-current", "version": version}

    record_attempt(version)
    try:
        # prepare_self_update performs authenticated download, SHA-256 verification,
        # archive validation, backup and rollback before handing off to PowerShell.
        prepare_self_update(release)
    except Exception:
        record_failure(version)
        raise

    # The newly started agent confirms this marker after the updated version
    # reconnects inside the bounded post-update health window.
    mark_pending(version)
    return {"started": True, "version": version, "channel": "stable"}
