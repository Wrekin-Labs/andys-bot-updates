from __future__ import annotations

from typing import Any

from . import __version__
from .maintenance_status import maintenance_status
from .post_update import status as post_update_status
from .update_health import public_status as update_health_status
from .watchdog import watchdog_status
from .recovery_status import recovery_status
from .owner_full_control import status as owner_full_control_status


def workstation_health() -> dict[str, Any]:
    """Return one bounded, non-sensitive health snapshot for fleet diagnostics."""
    maintenance = maintenance_status()
    update = update_health_status()
    post_update = post_update_status()
    watchdog = watchdog_status()
    recovery = recovery_status()
    owner = owner_full_control_status()
    return {
        "version": __version__,
        "healthy": bool(watchdog.get("healthy")) and not bool(update.get("backoff_active")),
        "watchdog": watchdog,
        "update": update,
        "post_update": post_update,
        "recovery": recovery,
        "owner_full_control": {"enabled": bool(owner.get("enabled"))},
        "self_update_supported": bool(maintenance.get("self_update_supported")),
        "update_log_present": bool(maintenance.get("update_log_present")),
        "rollback_available": bool(maintenance.get("rollback_available")),
    }
