from __future__ import annotations

from .models import ActionPlan

READ_ONLY = {
    "list_devices",
    "get_device_status",
    "list_serial_ports",
}

SENSITIVE_READS = {
    "read_serial",
    "scan_preview",
}

WRITE_ACTIONS = {
    "scan_document",
    "prepare_document_print",
}

PHYSICAL_ACTIONS = {
    "start_document_print",
    "write_serial",
    "flash_firmware",
    "start_3d_print",
    "start_cnc_job",
    "start_laser_job",
}


def classify_action(action: str) -> str:
    if action in READ_ONLY:
        return "read"
    if action in SENSITIVE_READS:
        return "sensitive_read"
    if action in WRITE_ACTIONS:
        return "write"
    if action in PHYSICAL_ACTIONS:
        return "physical"
    return "unknown"


def approval_required(action: str) -> bool:
    return classify_action(action) != "read"


def plan(action: str, device_id: str, summary: str, **arguments) -> ActionPlan:
    risk = classify_action(action)
    return ActionPlan(
        action=action,
        device_id=device_id,
        risk=risk,
        requires_approval=approval_required(action),
        summary=summary,
        arguments=arguments,
    )
