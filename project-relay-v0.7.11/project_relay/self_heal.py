from __future__ import annotations

from typing import Any

from .owner_full_control import require_enabled
from .supervised_apps import list_apps, app_status, owner_start


def self_heal_once() -> dict[str, Any]:
    """Start missing registered apps; never auto-kill duplicates."""
    require_enabled()
    actions = []
    for item in list_apps()["apps"]:
        if not item.get("enabled", True):
            continue
        state = app_status(item["name"])
        if state["duplicate"]:
            actions.append({"name": item["name"], "action": "none", "reason": "duplicate-needs-review"})
        elif not state["running"]:
            result = owner_start(item["name"])
            actions.append({"name": item["name"], "action": "start", "started": result.get("started", False)})
        else:
            actions.append({"name": item["name"], "action": "none", "reason": "healthy"})
    return {"actions": actions}
