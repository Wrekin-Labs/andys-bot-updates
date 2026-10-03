from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .bridge_actions import execute_bridge_action as execute_native_action
from .mcp_bridge import call_tool, list_tools
from .state import state_dir

RISK_ORDER = {"read": 0, "prepare": 1, "write": 2, "physical": 3, "destructive": 4}

WINDOWS_RISKS = {
    "list_devices": "read",
    "get_device_status": "read",
    "list_serial_ports": "read",
    "prepare_serial_read": "prepare",
    "read_serial": "physical",
    "prepare_scan_preview": "prepare",
    "scan_preview": "physical",
    "prepare_document_print": "prepare",
    "start_document_print": "physical",
    "pending_approvals": "read",
}

CADBRIDGE_READ = {
    "validate_cad_part", "inspect_cad_part", "part_checkpoints", "printer_profiles",
    "slicer_status", "analyze_3d_printability", "printer_calibrations",
    "remote_printer_hosts", "remote_printer_state", "get_part", "list_parts",
    "list_cad_reference_sources", "search_cad_reference", "universal_cad_operations",
    "resolve_cad_operation", "prepare_cad_operation", "cad_capability_matrix",
    "plan_cad_task", "compare_cad_backends", "cadbridge_backend_summary",
    "visual_evidence_status", "visual_revision_status", "engineering_solver_status",
    "analysis_case_status", "recommend_analysis_solver", "cad_backend_resilience_status",
    "analyze_assembly_motion", "visual_inspection_plan", "fdm_print_adviser",
    "requirement_status", "explain_print_setting", "print_settings_for_goal",
    "large_print_split_plan",
}


CADBRIDGE_CONTROL = {
    "revise_part": "write",
    "checkpoint_part": "write",
    "rollback_part": "destructive",
    "export_cad": "write",
    "save_printer_calibration": "write",
    "prepare_3d_print": "prepare",
    "generate_gcode": "write",
    "validate_gcode": "read",
    "execute_cad_operation": "destructive",
    "learn_all_cad_backends": "write",
    "reset_cad_backend_circuit": "write",
    "capture_cad_view": "prepare",
    "split_large_part_for_printing": "write",
    "slice_split_print_job": "write",
    "send_gcode_to_printer": "physical",
    "start_printer_job": "physical",
}

BUILTIN_BRIDGES: dict[str, dict[str, Any]] = {
    "windows-native": {
        "id": "windows-native",
        "title": "Windows Native Devices",
        "kind": "native",
        "trusted": True,
        "status": "connected",
        "capabilities": {name: {"risk": risk} for name, risk in WINDOWS_RISKS.items()},
    },
    "cadbridge": {
        "id": "cadbridge",
        "title": "CADBridge AI",
        "kind": "mcp",
        "trusted": True,
        "status": "configured",
        "endpoint": "http://127.0.0.1:8000/mcp",
        "capabilities": {
            **{name: {"risk": "read"} for name in CADBRIDGE_READ},
            **{name: {"risk": risk} for name, risk in CADBRIDGE_CONTROL.items()},
        },
    },
}


def _pack_dir() -> Path:
    path = state_dir() / "bridge_packs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_untrusted_pack(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("id") or not data.get("title"):
        return None
    capabilities = data.get("capabilities")
    if not isinstance(capabilities, dict):
        return None
    clean: dict[str, dict[str, str]] = {}
    for name, spec in capabilities.items():
        if not isinstance(name, str) or not isinstance(spec, dict):
            continue
        risk = str(spec.get("risk", "read"))
        if risk in RISK_ORDER:
            clean[name] = {"risk": risk}
    return {
        "id": str(data["id"]),
        "title": str(data["title"]),
        "kind": str(data.get("kind", "mcp")),
        "trusted": False,
        "status": "manifest-only",
        "capabilities": clean,
    }


def registry() -> dict[str, dict[str, Any]]:
    result = {key: dict(value) for key, value in BUILTIN_BRIDGES.items()}
    for path in _pack_dir().glob("*.json"):
        pack = _load_untrusted_pack(path)
        if pack and pack["id"] not in result:
            result[pack["id"]] = pack
    return result


def list_bridges() -> list[dict[str, Any]]:
    return list(registry().values())


def get_bridge(bridge_id: str) -> dict[str, Any]:
    bridge = registry().get(bridge_id)
    if bridge is None:
        raise KeyError(f"Unknown bridge: {bridge_id}")
    return bridge


def plan_bridge_action(
    bridge_id: str, action: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    bridge = get_bridge(bridge_id)
    spec = bridge.get("capabilities", {}).get(action)
    if spec is None:
        raise KeyError(f"Bridge {bridge_id} does not expose {action}")
    risk = str(spec["risk"])
    is_read = risk == "read"
    executable = bool(
        bridge.get("trusted") is True
        and (
            bridge.get("kind") == "native"
            or (bridge.get("kind") == "mcp" and is_read)
        )
    )
    return {
        "bridge_id": bridge_id,
        "action": action,
        "args": args or {},
        "risk": risk,
        "requires_approval": RISK_ORDER[risk] >= RISK_ORDER["write"],
        "executable": executable,
    }


def execute_bridge_read(
    bridge_id: str, action: str, args: dict[str, Any] | None = None
) -> Any:
    plan = plan_bridge_action(bridge_id, action, args)
    if plan["risk"] != "read":
        raise PermissionError("Generic bridge execution is read-only in Project Relay v0.3.1")
    if not plan["executable"]:
        raise PermissionError("Bridge is not backed by a trusted read-only adapter")
    bridge = get_bridge(bridge_id)
    if bridge["kind"] == "native":
        return execute_native_action(action, args or {})
    if bridge["kind"] == "mcp":
        return call_tool(str(bridge["endpoint"]), action, args or {})
    raise PermissionError("Unsupported bridge kind")
