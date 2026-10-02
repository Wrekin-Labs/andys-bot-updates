from __future__ import annotations

import os
from typing import Any

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from . import __version__

from .approvals import ApprovalStore
from .bridge_actions import commandport_owner_approve as commandport_owner_approve_impl
from .capability_packs import (
    execute_bridge_read as execute_bridge_read_impl,
    get_bridge as get_bridge_impl,
    list_bridges as list_bridges_impl,
    plan_bridge_action as plan_bridge_action_impl,
)
from .commandport import (
    commandport_list_directory as commandport_list_directory_impl,
    commandport_list_processes as commandport_list_processes_impl,
    commandport_list_windows as commandport_list_windows_impl,
    commandport_open_url as commandport_open_url_impl,
    commandport_focus_window as commandport_focus_window_impl,
    commandport_capture_screen as commandport_capture_screen_impl,
    commandport_prepare_click as commandport_prepare_click_impl,
    commandport_click as commandport_click_impl,
    commandport_prepare_type_text as commandport_prepare_type_text_impl,
    commandport_type_text as commandport_type_text_impl,
    commandport_prepare_run_command as commandport_prepare_run_command_impl,
    commandport_prepare_write_file as commandport_prepare_write_file_impl,
    commandport_read_text_file as commandport_read_text_file_impl,
    commandport_run_command as commandport_run_command_impl,
    commandport_write_file as commandport_write_file_impl,
)
from .discovery import discover_devices
from .print_jobs import prepare_document_print as prepare_print_impl
from .print_jobs import start_document_print as start_print_impl
from .scanner import prepare_scan_preview as prepare_scan_preview_impl
from .serialio import prepare_serial_read as prepare_serial_read_impl
from .serialio import read_serial as read_serial_impl
from .workspace_files import hash_file as hash_file_impl
from .document_tools import read_document as read_document_impl, search_document as search_document_impl
from .safe_fetch import read_url as read_url_impl
from .runtime_config import get_runtime_status as get_runtime_status_impl
from .capability_report import get_capability_report as capability_report_impl

TOOL_READ = ToolAnnotations(read_only_hint=True, open_world_hint=False, destructive_hint=False)
TOOL_WRITE = ToolAnnotations(read_only_hint=False, open_world_hint=False, destructive_hint=False)
TOOL_OPEN_WORLD = ToolAnnotations(read_only_hint=False, open_world_hint=True, destructive_hint=False)
TOOL_DESKTOP_MUTATION = ToolAnnotations(read_only_hint=False, open_world_hint=True, destructive_hint=True)
TOOL_PHYSICAL = ToolAnnotations(read_only_hint=False, open_world_hint=False, destructive_hint=False)

mcp = MCPServer(
    "Project Relay",
    version=__version__,
    instructions=(
        "Expose narrow hardware and desktop capabilities from a paired local Relay Agent. "
        "Prefer read-only inspection. CommandPort reads stay inside approved roots. "
        "File writes, PowerShell commands, mouse clicks, keyboard input, sensitive reads and physical actions require exact local approval. "
        "Unknown capabilities fail closed. Never bypass the workstation approval gate."
    ),
)


def _by_id(device_id: str) -> dict[str, Any]:
    for device in discover_devices():
        if device.device_id == device_id:
            return device.to_dict()
    raise KeyError(f"Unknown device_id: {device_id}")


@mcp.tool(annotations=TOOL_READ)
def list_devices() -> dict[str, Any]:
    """List read-only device inventory visible to the local Relay Agent, including printers, scanners, serial, storage, audio/MIDI, USB peripherals and local-network neighbours."""
    return {"devices": [d.to_dict() for d in discover_devices()]}


@mcp.tool(annotations=TOOL_READ)
def get_device_status(device_id: str) -> dict[str, Any]:
    """Return current read-only metadata/status for one discovered device."""
    return {"device": _by_id(device_id)}


@mcp.tool(annotations=TOOL_READ)
def list_serial_ports() -> dict[str, Any]:
    """List discovered serial/COM devices without opening or writing them."""
    return {"ports": [d.to_dict() for d in discover_devices() if d.kind == "serial"]}


@mcp.tool(annotations=TOOL_WRITE)
def prepare_serial_read(device_id: str, seconds: float = 2.0, baudrate: int = 115200, max_bytes: int = 4096) -> dict[str, Any]:
    """Prepare a bounded serial read and return a local approval id. Does not open the port."""
    return prepare_serial_read_impl(device_id, seconds, baudrate, max_bytes)


@mcp.tool(annotations=TOOL_WRITE)
def read_serial(approval_id: str, device_id: str, seconds: float = 2.0, baudrate: int = 115200, max_bytes: int = 4096) -> dict[str, Any]:
    """Read a bounded serial sample only after the exact request has been approved locally."""
    return read_serial_impl(approval_id, device_id, seconds, baudrate, max_bytes)


@mcp.tool(annotations=TOOL_WRITE)
def prepare_scan_preview(device_id: str) -> dict[str, Any]:
    """Prepare a low-resolution scanner preview approval. Does not move or acquire from the scanner."""
    return prepare_scan_preview_impl(device_id)


@mcp.tool(annotations=TOOL_PHYSICAL)
def scan_preview(approval_id: str, device_id: str) -> dict[str, Any]:
    """Scanner acquisition remains deliberately disabled until a WIA adapter is tested on real hardware."""
    raise RuntimeError("Scanner acquisition is disabled pending real-hardware WIA validation.")


@mcp.tool(annotations=TOOL_WRITE)
def prepare_document_print(device_id: str, file_ref: str, copies: int = 1) -> dict[str, Any]:
    """Inspect the local file and prepare an exact printer approval record. Never prints."""
    return prepare_print_impl(device_id, file_ref, copies)


@mcp.tool(annotations=TOOL_PHYSICAL)
def start_document_print(approval_id: str, device_id: str, file_ref: str, copies: int = 1) -> dict[str, Any]:
    """Start a prepared job only after local approval. The physical adapter remains disabled by default."""
    return start_print_impl(approval_id, device_id, file_ref, copies)


@mcp.tool(annotations=TOOL_READ)
def pending_approvals() -> dict[str, Any]:
    """List unexpired actions waiting for local workstation approval."""
    return {"approvals": [r.to_dict() for r in ApprovalStore().pending()]}


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_owner_approve(approval_id: str) -> dict[str, Any]:
    """Owner Full Control: remotely approve one existing exact pending approval. Does not execute it."""
    return commandport_owner_approve_impl(approval_id)


@mcp.tool(annotations=TOOL_READ)
def list_bridges() -> dict[str, Any]:
    """List trusted built-in capability bridges plus untrusted manifest-only packs."""
    return {"bridges": list_bridges_impl()}


@mcp.tool(annotations=TOOL_READ)
def get_bridge(bridge_id: str) -> dict[str, Any]:
    """Inspect one bridge, its trust state and declared capability risk levels."""
    return {"bridge": get_bridge_impl(bridge_id)}


@mcp.tool(annotations=TOOL_READ)
def plan_bridge_action(bridge_id: str, action: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Plan one bridge action without executing it and report risk/approval/executability."""
    return {"plan": plan_bridge_action_impl(bridge_id, action, args)}


@mcp.tool(annotations=TOOL_READ)
def execute_bridge_read(bridge_id: str, action: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute only a curated read-only action on a trusted bridge. Writes and physical actions fail closed."""
    return {"result": execute_bridge_read_impl(bridge_id, action, args)}


@mcp.tool(annotations=TOOL_READ)
def commandport_list_directory(path: str, depth: int = 1, max_entries: int = 500) -> dict[str, Any]:
    """List files and folders inside approved workstation roots."""
    return commandport_list_directory_impl(path, depth, max_entries)


@mcp.tool(annotations=TOOL_READ)
def commandport_read_text_file(path: str, offset: int = 0, length: int = 64_000) -> dict[str, Any]:
    """Read a bounded UTF-8 range from a file inside approved workstation roots."""
    return commandport_read_text_file_impl(path, offset, length)


@mcp.tool(annotations=TOOL_READ)
def commandport_list_processes(limit: int = 250) -> dict[str, Any]:
    """List local Windows processes without changing them."""
    return commandport_list_processes_impl(limit)




@mcp.tool(annotations=TOOL_READ)
def commandport_list_windows(limit: int = 200) -> dict[str, Any]:
    """List visible top-level Windows application windows without changing focus."""
    return commandport_list_windows_impl(limit)


@mcp.tool(annotations=TOOL_OPEN_WORLD)
def commandport_open_url(url: str) -> dict[str, Any]:
    """Open one validated http(s) URL in the default browser. Does not type or submit a form."""
    return commandport_open_url_impl(url)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_focus_window(window_handle: int) -> dict[str, Any]:
    """Bring one existing top-level Windows window to the foreground without clicking or typing."""
    return commandport_focus_window_impl(window_handle)


@mcp.tool(annotations=TOOL_READ)
def commandport_capture_screen(max_width: int = 1024, jpeg_quality: int = 50) -> dict[str, Any]:
    """Disabled until a privacy-safe capture adapter is available; no pixels are read."""
    return commandport_capture_screen_impl(max_width, jpeg_quality)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_prepare_click(x: int, y: int, button: str = "left", clicks: int = 1) -> dict[str, Any]:
    """Create an exact local approval request for one mouse click."""
    return commandport_prepare_click_impl(x, y, button, clicks)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_click(approval_id: str, x: int, y: int, button: str = "left", clicks: int = 1) -> dict[str, Any]:
    """Execute only the exact mouse click approved locally."""
    return commandport_click_impl(approval_id, x, y, button, clicks)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_prepare_type_text(text: str, press_enter: bool = False) -> dict[str, Any]:
    """Create an exact local approval request for typing text; the approval summary omits the text itself."""
    return commandport_prepare_type_text_impl(text, press_enter)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_type_text(approval_id: str, text: str, press_enter: bool = False) -> dict[str, Any]:
    """Type only the exact Unicode text approved locally, optionally followed by Enter."""
    return commandport_type_text_impl(approval_id, text, press_enter)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_prepare_write_file(path: str, content: str, mode: str = "rewrite") -> dict[str, Any]:
    """Create an exact local approval request for a bounded UTF-8 file write."""
    return commandport_prepare_write_file_impl(path, content, mode)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_write_file(approval_id: str, path: str, content: str, mode: str = "rewrite") -> dict[str, Any]:
    """Write only the exact path, content and mode approved locally."""
    return commandport_write_file_impl(approval_id, path, content, mode)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_prepare_run_command(command: str, cwd: str | None = None, timeout_seconds: int = 60) -> dict[str, Any]:
    """Create an exact local approval request for one bounded PowerShell command."""
    return commandport_prepare_run_command_impl(command, cwd, timeout_seconds)


@mcp.tool(annotations=TOOL_WRITE)
def commandport_run_command(approval_id: str, command: str, cwd: str | None = None, timeout_seconds: int = 60) -> dict[str, Any]:
    """Run only the exact PowerShell command, cwd and timeout approved locally."""
    return commandport_run_command_impl(approval_id, command, cwd, timeout_seconds)


from . import desktop_controls as desktop_controls_impl


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_prepare_scroll(ticks: int) -> dict[str, Any]:
    """Prepare local approval for scroll in the same active window."""
    return desktop_controls_impl.commandport_prepare_scroll(ticks)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_scroll(approval_id: str, ticks: int) -> dict[str, Any]:
    """Execute locally approved scroll in the same active window."""
    return desktop_controls_impl.commandport_scroll(approval_id, ticks)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_prepare_switch_tab(direction: str) -> dict[str, Any]:
    """Prepare local approval for switch tab in the same active window."""
    return desktop_controls_impl.commandport_prepare_switch_tab(direction)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_switch_tab(approval_id: str, direction: str) -> dict[str, Any]:
    """Execute locally approved switch tab in the same active window."""
    return desktop_controls_impl.commandport_switch_tab(approval_id, direction)


from . import browser_targets as browser_targets_impl
from . import browser_state as browser_state_impl


@mcp.tool(annotations=TOOL_READ)
def commandport_browser_scroll_state() -> dict[str, Any]:
    """Read browser scroll position without page text, form data, URL or pixels."""
    return browser_state_impl.commandport_browser_scroll_state()

@mcp.tool(annotations=TOOL_READ)
def commandport_find_target(label: str, role: str = "button") -> dict[str, Any]:
    """Exact public-label browser targeting; never pass secrets as labels. Clicks need local approval."""
    return browser_targets_impl.commandport_find_target(label, role)

@mcp.tool(annotations=TOOL_WRITE)
def commandport_prepare_click_target(label: str, role: str = "button") -> dict[str, Any]:
    """Exact public-label browser targeting; never pass secrets as labels. Clicks need local approval."""
    return browser_targets_impl.commandport_prepare_click_target(label, role)

@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_click_target(approval_id: str, label: str, role: str = "button") -> dict[str, Any]:
    """Exact public-label browser targeting; never pass secrets as labels. Clicks need local approval."""
    return browser_targets_impl.commandport_click_target(approval_id, label, role)


from . import app_launcher as app_launcher_impl


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_prepare_launch_app(app: str) -> dict[str, Any]:
    """Prepare local approval to launch notepad, calculator or relay. No custom arguments."""
    return app_launcher_impl.commandport_prepare_launch_app(app)


@mcp.tool(annotations=TOOL_DESKTOP_MUTATION)
def commandport_launch_app(approval_id: str, app: str) -> dict[str, Any]:
    """Launch only the exact allowlisted app approved locally. Window readiness is separate."""
    return app_launcher_impl.commandport_launch_app(approval_id, app)


@mcp.tool(annotations=TOOL_READ)
def commandport_hash_file(path: str) -> dict[str, Any]:
    """Compute SHA-256 metadata for one file inside approved local roots without returning file content."""
    return hash_file_impl(path)


@mcp.tool(annotations=TOOL_READ)
def commandport_read_document(
    path: str,
    sheet: str | None = None,
    page_start: int = 0,
    page_count: int = 10,
) -> dict[str, Any]:
    """Format-aware bounded local read of CSV/TSV/JSON/XLSX/XLSM/PDF/DOCX/text inside approved roots."""
    return read_document_impl(path, sheet=sheet, page_start=page_start, page_count=page_count)


@mcp.tool(annotations=TOOL_READ)
def commandport_search_document(
    path: str,
    query: str,
    case_sensitive: bool = False,
    sheet: str | None = None,
    max_results: int = 100,
) -> dict[str, Any]:
    """Search bounded text extracted from a supported document inside approved roots."""
    return search_document_impl(
        path,
        query,
        case_sensitive=case_sensitive,
        sheet=sheet,
        max_results=max_results,
    )


@mcp.tool(annotations=TOOL_OPEN_WORLD)
def commandport_read_url(
    url: str,
    timeout_seconds: int = 20,
    max_bytes: int = 256_000,
) -> dict[str, Any]:
    """Fetch a bounded public HTTP(S) resource with SSRF and credential-URL protections."""
    return read_url_impl(url, timeout_seconds=timeout_seconds, max_bytes=max_bytes)


@mcp.tool(annotations=TOOL_READ)
def commandport_get_runtime_config() -> dict[str, Any]:
    """Read non-secret local Relay runtime preferences, approved roots and dependency availability."""
    return get_runtime_status_impl()


@mcp.tool(annotations=TOOL_READ)
def commandport_capability_report() -> dict[str, Any]:
    """Return a non-mutating local capability/dependency report."""
    return capability_report_impl()


def create_app():
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
        allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
    )
    return mcp.streamable_http_app(transport_security=security)


app = create_app()


def main() -> int:
    import uvicorn

    host = os.getenv("RELAY_MCP_HOST", "127.0.0.1")
    port = int(os.getenv("RELAY_MCP_PORT", "8788"))
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Project Relay refuses non-loopback MCP binds")
    uvicorn.run("project_relay.mcp_server:app", host=host, port=port, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
