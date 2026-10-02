from __future__ import annotations

from typing import Any

from .audit import AuditLog
from .owner_full_control import require_enabled
from .state import state_dir
from .updater import get_release, is_newer, prepare_self_update

AUDIT = AuditLog(state_dir() / "audit.jsonl")


def self_update(channel: str = "stable") -> dict[str, Any]:
    require_enabled()
    selected = str(channel or "stable").lower().strip()
    if selected not in {"stable", "beta"}:
        raise ValueError("channel must be stable or beta")
    release = get_release(channel=selected)
    if not release:
        return {"update_available": False, "reason": "no published release", "channel": selected}
    version = str(release.get("version") or "")
    if not version:
        raise RuntimeError("release manifest has no version")
    if not is_newer(version):
        return {"update_available": False, "version": version, "channel": selected}
    path = prepare_self_update(release)
    AUDIT.append("owner.self_update", {"channel": selected, "version": version})
    return {
        "update_available": True,
        "version": version,
        "channel": selected,
        "verified_update_staged": True,
        "staged": str(path),
    }
