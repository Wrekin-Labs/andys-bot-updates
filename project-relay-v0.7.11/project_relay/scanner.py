from __future__ import annotations

from .approvals import ApprovalStore
from .discovery import discover_devices


def _scanner(device_id: str):
    for device in discover_devices():
        if device.device_id == device_id and device.kind == "scanner":
            return device
    raise KeyError(f"Unknown scanner device_id: {device_id}")


def prepare_scan_preview(device_id: str, store: ApprovalStore | None = None) -> dict:
    scanner = _scanner(device_id)
    summary = f"Acquire a low-resolution preview from {scanner.name}"
    approval = (store or ApprovalStore()).create(
        "scan_preview", device_id, {"mode": "preview", "dpi": 100}, summary, ttl_seconds=300
    )
    return {
        "scanner": scanner.to_dict(),
        "approval_id": approval.approval_id,
        "approval_expires_at": approval.expires_at,
        "executed": False,
        "note": "Project Relay v0.3.1 prepares scanner preview approval; WIA acquisition stays disabled until real-hardware validation.",
    }
