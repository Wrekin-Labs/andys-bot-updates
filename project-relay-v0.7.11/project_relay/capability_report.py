from __future__ import annotations

import importlib.util
import os
import shutil
import sys
from typing import Any

from .owner_full_control import status as owner_status


def get_capability_report() -> dict[str, Any]:
    executables = {
        "powershell": bool(shutil.which("powershell.exe" if os.name == "nt" else "pwsh")),
        "cmd": bool(shutil.which("cmd.exe")) if os.name == "nt" else False,
        "wsl": bool(shutil.which("wsl.exe")) if os.name == "nt" else False,
        "ssh": bool(shutil.which("ssh.exe" if os.name == "nt" else "ssh")),
        "node": bool(shutil.which("node")),
        "r": bool(shutil.which("R")),
        "docker": bool(shutil.which("docker")),
        "winget": bool(shutil.which("winget.exe")) if os.name == "nt" else False,
        "python": True,
    }
    python_modules = {
        "xlsx": importlib.util.find_spec("openpyxl") is not None,
        "docx": importlib.util.find_spec("docx") is not None,
        "pdf_read": importlib.util.find_spec("pypdf") is not None,
        "pdf_write": importlib.util.find_spec("reportlab") is not None,
        "images": importlib.util.find_spec("PIL") is not None,
        "windows_uia": importlib.util.find_spec("pywinauto") is not None if os.name == "nt" else False,
    }
    features = {
        "filesystem": {
            "list": True, "recursive": True, "search_names": True,
            "search_text": True, "regex_search": True, "hash_sha256": True,
            "multi_file_read": True, "negative_offsets": True,
            "owner_create_copy_move_delete": True,
        },
        "editing": {
            "exact_replace": True, "regex_replace": True, "diff_preview": True,
            "optimistic_hash": True, "checkpoint_rollback": True,
            "multi_file_transaction": True,
        },
        "terminal": {
            "powershell": executables["powershell"],
            "cmd": executables["cmd"], "wsl": executables["wsl"],
            "python": True, "node": executables["node"], "r": executables["r"],
            "ssh": executables["ssh"], "interactive_sessions": True,
            "output_pagination": True,
        },
        "documents": {
            "csv_json": True, "xlsx": python_modules["xlsx"],
            "pdf": python_modules["pdf_read"], "docx": python_modules["docx"],
            "format_aware_writes": bool(
                python_modules["xlsx"] and python_modules["docx"]
                and python_modules["pdf_write"]
            ),
        },
        "isolation": {
            "docker_available": executables["docker"],
            "docker_networkless_runner": executables["docker"],
            "default_process_sandboxed": False,
        },
        "windows_admin": {
            "services": os.name == "nt",
            "scheduled_tasks": os.name == "nt",
            "winget": executables["winget"],
            "process_start_terminate": os.name == "nt",
            "uia": python_modules["windows_uia"],
        },
        "hardware": {
            "printer_discovery": os.name == "nt",
            "scanner_discovery": os.name == "nt",
            "serial": True,
            "usb_storage_audio_midi": os.name == "nt",
            "capability_bridges": True,
        },
        "security": {
            "normal_mode_local_approval": True,
            "owner_local_revoke": True,
            "oauth_owner_routing": True,
            "approved_root_reads": True,
            "symlink_reparse_rejection": True,
            "checksum_update": True,
            "rollback_update": True,
            "tool_history_argument_values": False,
        },
    }
    return {
        "platform": sys.platform,
        "executables": executables,
        "python_modules": python_modules,
        "owner_full_control": owner_status(),
        "features": features,
    }
