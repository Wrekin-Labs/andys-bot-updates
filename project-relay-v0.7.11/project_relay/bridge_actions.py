from __future__ import annotations

import time
from typing import Any, Callable

from .app_launcher import commandport_prepare_launch_app, commandport_launch_app
from .browser_state import commandport_browser_scroll_state
from .owner_maintenance import (
    commandport_list_process_details,
    commandport_prepare_power,
    commandport_power,
    commandport_list_services,
    commandport_prepare_service,
    commandport_service,
)
from .maintenance import (
    commandport_process_details,
    commandport_owner_power,
    commandport_owner_service,
    commandport_owner_update,
)
from .supervised_apps import (
    list_apps as supervised_list_apps,
    app_status as supervised_app_status,
    owner_start as supervised_owner_start,
    owner_restart as supervised_owner_restart,
)
from .approvals import ApprovalStore
from .owner_grants import OwnerGrantStore
from .audit import AuditLog
from .state import state_dir
from .commandport import (
    commandport_get_file_info,
    commandport_list_directory,
    commandport_list_processes,
    commandport_list_windows,
    commandport_open_url,
    commandport_focus_window,
    commandport_capture_screen,
    commandport_prepare_click,
    commandport_click,
    commandport_prepare_type_text,
    commandport_type_text,
    commandport_search_files,
    commandport_search_text,
    commandport_prepare_run_command,
    commandport_prepare_write_file,
    commandport_read_text_file,
    commandport_run_command,
    commandport_owner_run_command,
    commandport_write_file,
)
from .desktop_controls import (
    commandport_prepare_scroll,
    commandport_scroll,
    commandport_prepare_switch_tab,
    commandport_switch_tab,
)
from .browser_targets import (
    commandport_find_target,
    commandport_prepare_click_target,
    commandport_click_target,
)
from .discovery import discover_devices
from .print_jobs import prepare_document_print, start_document_print
from .scanner import prepare_scan_preview
from .serialio import prepare_serial_read, read_serial
from .owner_full_control import require_enabled
from .workspace_files import (
    hash_file as workspace_hash_file,
    read_multiple_files as workspace_read_multiple_files,
    read_file_lines as workspace_read_file_lines,
    preview_text_replace as workspace_preview_text_replace,
    owner_apply_text_replace,
    owner_rollback_text_edit,
    preview_text_transaction,
    owner_apply_text_transaction,
    owner_rollback_text_transaction,
    owner_write_text_file,
)
from .document_tools import read_document, search_document
from .safe_fetch import read_url
from .runtime_config import get_runtime_status, owner_update_runtime_config
from .tool_history import recent_tool_calls, record_tool_call
from .terminal_sessions import (
    owner_start_terminal_session,
    owner_list_terminal_sessions,
    owner_read_terminal_output,
    owner_write_terminal_session,
    owner_stop_terminal_session,
    owner_start_ssh_session,
)
from .owner_filesystem import (
    mkdir as owner_fs_mkdir,
    copy as owner_fs_copy,
    move as owner_fs_move,
    delete as owner_fs_delete,
)
from .owner_processes import (
    start as owner_process_start,
    terminate as owner_process_terminate,
)
from .owner_services import service as owner_service_action
from .software_admin import (
    list_installed as owner_software_list,
    search as owner_software_search,
    install as owner_software_install,
    uninstall as owner_software_uninstall,
    upgrade as owner_software_upgrade,
)
from .app_automation import (
    owner_find_control,
    owner_click_control,
)
from .owner_updates import self_update as owner_self_update
from .sandbox_exec import owner_sandbox_status, owner_sandbox_run
from .image_tools import owner_read_image
from .archive_tools import list_zip, owner_create_zip, owner_extract_zip
from .advanced_search import owner_search_content
from .search_sessions import (
    owner_start_search_session,
    owner_read_search_results,
    owner_list_search_sessions,
    owner_stop_search_session,
)
from .owner_tasks import owner_list_scheduled_tasks, owner_scheduled_task_action
from .capability_report import get_capability_report
from .system_diagnostics import owner_system_snapshot, owner_network_summary, owner_query_event_log
from .usage_stats import owner_usage_stats
from .ping import commandport_ping
from .fleet_health import workstation_health
from .owner_power import owner_power_action
from .owner_documents import (
    owner_write_csv,
    owner_write_xlsx,
    owner_update_xlsx_cells,
    owner_update_xlsx_range,
    owner_write_docx,
    owner_write_pdf,
    owner_rollback_document,
    owner_write_json,
    owner_replace_docx_text,
    owner_pdf_delete_pages,
    owner_pdf_insert_pdf,
)


def list_devices() -> dict[str, Any]:
    return {"devices": [d.to_dict() for d in discover_devices()]}


def get_device_status(device_id: str) -> dict[str, Any]:
    for device in discover_devices():
        if device.device_id == device_id:
            return {"device": device.to_dict()}
    raise KeyError(f"Unknown device_id: {device_id}")


def list_serial_ports() -> dict[str, Any]:
    return {"ports": [d.to_dict() for d in discover_devices() if d.kind == "serial"]}


def pending_approvals() -> dict[str, Any]:
    return {"approvals": [r.to_dict() for r in ApprovalStore().pending()]}


def commandport_owner_approve(approval_id: str) -> dict[str, Any]:
    """Remotely approve one exact pending request for the authenticated owner.

    This authorizes but does not execute the underlying action. The existing action
    must still consume the same ApprovalStore record once with its exact binding.
    """
    require_enabled()
    approval_id = str(approval_id).strip()
    if not approval_id:
        raise ValueError("approval_id is required")
    approvals = ApprovalStore()
    record = approvals.get(approval_id)
    now = time.time()
    if record.consumed_at is not None:
        raise PermissionError("approval already consumed")
    if now > record.expires_at:
        raise PermissionError("approval expired")
    if record.approved_at is not None:
        return {"approval": record.to_dict(), "remote_owner": True, "already_approved": True}
    exact = {"approval_id": record.approval_id, "action": record.action, "device_id": record.device_id, "arguments_digest": record.arguments_digest}
    grants = OwnerGrantStore()
    grant = grants.create("commandport_owner_approve", exact, ttl_seconds=60)
    grants.consume(grant.grant_id, action="commandport_owner_approve", arguments=exact)
    approved = approvals.approve(approval_id, now=now)
    AuditLog(state_dir() / "audit.jsonl").append("approval.granted_remote_owner", {"approval_id": approval_id, "action": record.action, "device_id": record.device_id, "grant_id": grant.grant_id})
    return {"approval": approved.to_dict(), "remote_owner": True, "already_approved": False}


def scan_preview(approval_id: str, device_id: str) -> dict[str, Any]:
    raise RuntimeError(
        "Scanner acquisition is disabled pending real-hardware WIA validation."
    )


def list_bridges_action() -> dict[str, Any]:
    from .capability_packs import list_bridges
    return {"bridges": list_bridges()}


def get_bridge_action(bridge_id: str) -> dict[str, Any]:
    from .capability_packs import get_bridge
    return {"bridge": get_bridge(bridge_id)}


def plan_bridge_action_action(
    bridge_id: str, action: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    from .capability_packs import plan_bridge_action
    return {"plan": plan_bridge_action(bridge_id, action, args)}


def execute_bridge_read_action(
    bridge_id: str, action: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    from .capability_packs import execute_bridge_read
    return {"result": execute_bridge_read(bridge_id, action, args)}


def commandport_hash_file(path: str) -> dict[str, Any]:
    return workspace_hash_file(path)


def commandport_read_url(
    url: str,
    timeout_seconds: int = 20,
    max_bytes: int = 256_000,
) -> dict[str, Any]:
    return read_url(url, timeout_seconds=timeout_seconds, max_bytes=max_bytes)


def commandport_get_runtime_config() -> dict[str, Any]:
    return get_runtime_status()


def commandport_owner_read_multiple_files(
    paths: list[str],
    offset: int = 0,
    length: int = 64_000,
) -> dict[str, Any]:
    require_enabled()
    return workspace_read_multiple_files(paths, offset=offset, length=length)


def commandport_owner_preview_text_replace(
    path: str,
    find: str,
    replace: str,
    regex: bool = False,
    count: int = 0,
) -> dict[str, Any]:
    require_enabled()
    return workspace_preview_text_replace(path, find, replace, regex=regex, count=count)


def commandport_owner_apply_text_replace(
    path: str,
    find: str,
    replace: str,
    regex: bool = False,
    count: int = 0,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    return owner_apply_text_replace(
        path, find, replace, regex=regex, count=count, expected_sha256=expected_sha256
    )


def commandport_owner_rollback_text_edit(checkpoint_id: str) -> dict[str, Any]:
    return owner_rollback_text_edit(checkpoint_id)


def commandport_owner_read_document(
    path: str,
    sheet: str | None = None,
    page_start: int = 0,
    page_count: int = 10,
) -> dict[str, Any]:
    require_enabled()
    return read_document(path, sheet=sheet, page_start=page_start, page_count=page_count)


def commandport_owner_search_document(
    path: str,
    query: str,
    case_sensitive: bool = False,
    sheet: str | None = None,
    max_results: int = 100,
) -> dict[str, Any]:
    require_enabled()
    return search_document(
        path,
        query,
        case_sensitive=case_sensitive,
        sheet=sheet,
        max_results=max_results,
    )


def commandport_owner_recent_tool_calls(limit: int = 50) -> dict[str, Any]:
    require_enabled()
    return recent_tool_calls(limit)


def commandport_owner_runtime_config(
    default_shell: str | None = None,
    blocked_commands: list[str] | None = None,
    max_output_chars: int | None = None,
    tool_history_enabled: bool | None = None,
) -> dict[str, Any]:
    return owner_update_runtime_config(
        default_shell=default_shell,
        blocked_commands=blocked_commands,
        max_output_chars=max_output_chars,
        tool_history_enabled=tool_history_enabled,
    )


_ACTIONS: dict[str, Callable[..., dict[str, Any]]] = {
    "commandport_ping": commandport_ping,
    "commandport_health_report": workstation_health,
    "commandport_browser_scroll_state": commandport_browser_scroll_state,
    "commandport_list_process_details": commandport_list_process_details,
    "commandport_prepare_power": commandport_prepare_power,
    "commandport_power": commandport_power,
    "commandport_list_services": commandport_list_services,
    "commandport_prepare_service": commandport_prepare_service,
    "commandport_service": commandport_service,
    "commandport_process_details": commandport_process_details,
    "commandport_owner_power": commandport_owner_power,
    "commandport_owner_service": commandport_owner_service,
    "commandport_owner_update": commandport_owner_update,
    "commandport_owner_run_command": commandport_owner_run_command,

    "supervised_list_apps": supervised_list_apps,
    "supervised_app_status": supervised_app_status,
    "supervised_owner_start": supervised_owner_start,
    "supervised_owner_restart": supervised_owner_restart,

    "commandport_prepare_launch_app": commandport_prepare_launch_app,
    "commandport_launch_app": commandport_launch_app,
    "commandport_find_target": commandport_find_target,
    "commandport_prepare_click_target": commandport_prepare_click_target,
    "commandport_click_target": commandport_click_target,
    "commandport_prepare_scroll": commandport_prepare_scroll,
    "commandport_scroll": commandport_scroll,
    "commandport_prepare_switch_tab": commandport_prepare_switch_tab,
    "commandport_switch_tab": commandport_switch_tab,

    "list_devices": list_devices,
    "get_device_status": get_device_status,
    "list_serial_ports": list_serial_ports,
    "prepare_serial_read": prepare_serial_read,
    "read_serial": read_serial,
    "prepare_scan_preview": prepare_scan_preview,
    "scan_preview": scan_preview,
    "prepare_document_print": prepare_document_print,
    "start_document_print": start_document_print,
    "pending_approvals": pending_approvals,
    "commandport_owner_approve": commandport_owner_approve,
    "list_bridges": list_bridges_action,
    "get_bridge": get_bridge_action,
    "plan_bridge_action": plan_bridge_action_action,
    "execute_bridge_read": execute_bridge_read_action,

    "commandport_get_file_info": commandport_get_file_info,
    "commandport_list_directory": commandport_list_directory,
    "commandport_read_text_file": commandport_read_text_file,
    "commandport_search_files": commandport_search_files,
    "commandport_search_text": commandport_search_text,
    "commandport_hash_file": commandport_hash_file,
    "commandport_read_url": commandport_read_url,
    "commandport_get_runtime_config": commandport_get_runtime_config,
    "commandport_capability_report": get_capability_report,

    "commandport_list_processes": commandport_list_processes,
    "commandport_list_windows": commandport_list_windows,
    "commandport_open_url": commandport_open_url,
    "commandport_focus_window": commandport_focus_window,
    "commandport_capture_screen": commandport_capture_screen,
    "commandport_prepare_click": commandport_prepare_click,
    "commandport_click": commandport_click,
    "commandport_prepare_type_text": commandport_prepare_type_text,
    "commandport_type_text": commandport_type_text,
    "commandport_prepare_write_file": commandport_prepare_write_file,
    "commandport_write_file": commandport_write_file,
    "commandport_prepare_run_command": commandport_prepare_run_command,
    "commandport_run_command": commandport_run_command,

    "commandport_owner_read_multiple_files": commandport_owner_read_multiple_files,
    "commandport_owner_read_file_lines": workspace_read_file_lines,
    "commandport_owner_preview_text_replace": commandport_owner_preview_text_replace,
    "commandport_owner_apply_text_replace": commandport_owner_apply_text_replace,
    "commandport_owner_rollback_text_edit": commandport_owner_rollback_text_edit,
    "commandport_owner_preview_text_transaction": preview_text_transaction,
    "commandport_owner_apply_text_transaction": owner_apply_text_transaction,
    "commandport_owner_rollback_text_transaction": owner_rollback_text_transaction,
    "commandport_owner_write_text_file": owner_write_text_file,
    "commandport_owner_read_document": commandport_owner_read_document,
    "commandport_owner_search_document": commandport_owner_search_document,
    "commandport_owner_recent_tool_calls": commandport_owner_recent_tool_calls,
    "commandport_owner_runtime_config": commandport_owner_runtime_config,

    "commandport_owner_terminal_start": owner_start_terminal_session,
    "commandport_owner_terminal_list": owner_list_terminal_sessions,
    "commandport_owner_terminal_read": owner_read_terminal_output,
    "commandport_owner_terminal_write": owner_write_terminal_session,
    "commandport_owner_terminal_stop": owner_stop_terminal_session,
    "commandport_owner_ssh_start": owner_start_ssh_session,

    "commandport_owner_fs_mkdir": owner_fs_mkdir,
    "commandport_owner_fs_copy": owner_fs_copy,
    "commandport_owner_fs_move": owner_fs_move,
    "commandport_owner_fs_delete": owner_fs_delete,
    "commandport_owner_process_start": owner_process_start,
    "commandport_owner_process_terminate": owner_process_terminate,
    "commandport_owner_service_action": owner_service_action,
    "commandport_owner_software_list": owner_software_list,
    "commandport_owner_software_search": owner_software_search,
    "commandport_owner_software_install": owner_software_install,
    "commandport_owner_software_uninstall": owner_software_uninstall,
    "commandport_owner_software_upgrade": owner_software_upgrade,
    "commandport_owner_ui_find_control": owner_find_control,
    "commandport_owner_ui_click_control": owner_click_control,
    "commandport_owner_self_update": owner_self_update,
    "commandport_owner_write_csv": owner_write_csv,
    "commandport_owner_write_xlsx": owner_write_xlsx,
    "commandport_owner_update_xlsx_cells": owner_update_xlsx_cells,
    "commandport_owner_update_xlsx_range": owner_update_xlsx_range,
    "commandport_owner_write_docx": owner_write_docx,
    "commandport_owner_write_pdf": owner_write_pdf,
    "commandport_owner_rollback_document": owner_rollback_document,
    "commandport_owner_sandbox_status": owner_sandbox_status,
    "commandport_owner_sandbox_run": owner_sandbox_run,
    "commandport_owner_read_image": owner_read_image,
    "commandport_owner_write_json": owner_write_json,
    "commandport_owner_replace_docx_text": owner_replace_docx_text,
    "commandport_owner_pdf_delete_pages": owner_pdf_delete_pages,
    "commandport_owner_pdf_insert_pdf": owner_pdf_insert_pdf,
    "commandport_owner_zip_list": list_zip,
    "commandport_owner_zip_create": owner_create_zip,
    "commandport_owner_zip_extract": owner_extract_zip,
    "commandport_owner_search_content": owner_search_content,
    "commandport_owner_search_start": owner_start_search_session,
    "commandport_owner_search_read": owner_read_search_results,
    "commandport_owner_search_list": owner_list_search_sessions,
    "commandport_owner_search_stop": owner_stop_search_session,
    "commandport_owner_scheduled_tasks_list": owner_list_scheduled_tasks,
    "commandport_owner_scheduled_task_action": owner_scheduled_task_action,
    "commandport_owner_system_snapshot": owner_system_snapshot,
    "commandport_owner_network_summary": owner_network_summary,
    "commandport_owner_event_log_query": owner_query_event_log,
    "commandport_owner_usage_stats": owner_usage_stats,
    "commandport_owner_power_action": owner_power_action,
}


def bridge_action_names() -> tuple[str, ...]:
    return tuple(_ACTIONS)


def execute_bridge_action(action: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    fn = _ACTIONS.get(action)
    if fn is None:
        raise KeyError(f"Bridge action not allowed: {action}")
    arguments = args or {}
    started = time.perf_counter()
    try:
        if action.startswith("commandport_owner_") or action.startswith("supervised_owner_"):
            require_enabled()
        result = fn(**arguments)
    except Exception as exc:
        record_tool_call(
            action,
            arguments,
            success=False,
            duration_ms=round((time.perf_counter() - started) * 1000),
            error_type=type(exc).__name__,
        )
        raise
    record_tool_call(
        action,
        arguments,
        success=True,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return result
