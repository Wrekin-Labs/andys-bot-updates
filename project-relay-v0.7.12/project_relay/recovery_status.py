from __future__ import annotations

import os
import subprocess
from typing import Any


REQUIRED_TASKS = ("Project Relay MCP", "Project Relay Cloud Agent")
OPTIONAL_TASKS = (
    "Project Relay Cloud Watchdog",
    "Project Relay MCP Watchdog",
    "Project Relay Unattended Recovery",
)


def _query_task(name: str) -> dict[str, Any]:
    proc = subprocess.run(
        ["schtasks.exe", "/Query", "/TN", name, "/FO", "LIST", "/V"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    return {
        "task": name,
        "installed": proc.returncode == 0,
        "query_ok": proc.returncode == 0,
    }


def recovery_status() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Recovery status requires Windows")
    required = [_query_task(name) for name in REQUIRED_TASKS]
    optional = [_query_task(name) for name in OPTIONAL_TASKS]
    return {
        "tasks": required + optional,
        "all_installed": all(row["installed"] for row in required),
        "watchdogs_installed": all(
            row["installed"]
            for row in optional
            if row["task"] in {"Project Relay Cloud Watchdog", "Project Relay MCP Watchdog"}
        ),
        "unattended_recovery_installed": any(
            row["task"] == "Project Relay Unattended Recovery" and row["installed"]
            for row in optional
        ),
    }
