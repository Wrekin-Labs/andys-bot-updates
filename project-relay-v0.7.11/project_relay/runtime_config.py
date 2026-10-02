from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from .commandport import _allowed_roots
from .owner_full_control import require_enabled, status as owner_status
from .state import atomic_write_json, state_dir

CONFIG = "runtime-config.json"
DEFAULTS: dict[str, Any] = {
    "default_shell": "powershell",
    "blocked_commands": [],
    "max_output_chars": 128_000,
    "tool_history_enabled": True,
}
SHELLS = {"powershell", "cmd", "wsl", "python", "node", "r"}


def _path() -> Path:
    return state_dir() / CONFIG


def load_runtime_config() -> dict[str, Any]:
    value = dict(DEFAULTS)
    raw: dict[str, Any] = {}
    path = _path()
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
        except (OSError, ValueError, json.JSONDecodeError):
            raw = {}
    value.update({key: raw[key] for key in DEFAULTS if key in raw})
    shell = str(value.get("default_shell") or "powershell").lower()
    if shell not in SHELLS:
        shell = "powershell"
    blocked = value.get("blocked_commands")
    if not isinstance(blocked, list):
        blocked = []
    blocked = [str(item).strip().casefold() for item in blocked if str(item).strip()][:100]
    max_output = max(8_000, min(int(value.get("max_output_chars") or 128_000), 1_000_000))
    return {
        "default_shell": shell,
        "blocked_commands": blocked,
        "max_output_chars": max_output,
        "tool_history_enabled": value.get("tool_history_enabled") is not False,
    }


def owner_update_runtime_config(
    default_shell: str | None = None,
    blocked_commands: list[str] | None = None,
    max_output_chars: int | None = None,
    tool_history_enabled: bool | None = None,
) -> dict[str, Any]:
    require_enabled()
    value = load_runtime_config()
    if default_shell is not None:
        shell = str(default_shell).lower().strip()
        if shell not in SHELLS:
            raise ValueError("unsupported default shell")
        value["default_shell"] = shell
    if blocked_commands is not None:
        if not isinstance(blocked_commands, list) or len(blocked_commands) > 100:
            raise ValueError("blocked_commands must be a list of at most 100 names")
        clean = []
        for item in blocked_commands:
            name = str(item).strip().casefold()
            if not name or len(name) > 120 or any(ch in name for ch in "\r\n\x00"):
                raise ValueError("invalid blocked command name")
            clean.append(name)
        value["blocked_commands"] = clean
    if max_output_chars is not None:
        value["max_output_chars"] = max(8_000, min(int(max_output_chars), 1_000_000))
    if tool_history_enabled is not None:
        value["tool_history_enabled"] = bool(tool_history_enabled)
    atomic_write_json(_path(), value)
    return value


def command_is_blocked(command: str) -> bool:
    value = str(command or "").lstrip().casefold()
    if not value:
        return False
    for blocked in load_runtime_config()["blocked_commands"]:
        if value == blocked or value.startswith(blocked + " ") or value.startswith(blocked + "\t"):
            return True
    return False


def get_runtime_status() -> dict[str, Any]:
    cfg = load_runtime_config()
    commands = {
        "powershell": shutil.which("powershell.exe" if os.name == "nt" else "pwsh"),
        "cmd": shutil.which("cmd.exe") if os.name == "nt" else None,
        "wsl": shutil.which("wsl.exe") if os.name == "nt" else None,
        "python": sys.executable,
        "node": shutil.which("node"),
        "r": shutil.which("R"),
        "docker": shutil.which("docker"),
    }
    return {
        **cfg,
        "owner_full_control": owner_status(),
        "allowed_roots": [str(path) for path in _allowed_roots()],
        "executables": {name: bool(path) for name, path in commands.items()},
        "isolation": {
            "docker_available": bool(commands["docker"]),
            "sandboxed": False,
            "note": "Project Relay does not claim process isolation unless a dedicated sandbox adapter is explicitly used.",
        },
    }
