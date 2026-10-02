from __future__ import annotations

import os
import subprocess
from typing import Any


TASKS = ("Project Relay MCP", "Project Relay Cloud Agent")


def recovery_status() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Recovery status requires Windows")
    rows = []
    for name in TASKS:
        proc = subprocess.run(
            ["schtasks.exe", "/Query", "/TN", name, "/FO", "LIST", "/V"],
            capture_output=True, text=True, timeout=15, check=False,
        )
        rows.append({
            "task": name,
            "installed": proc.returncode == 0,
            "query_ok": proc.returncode == 0,
        })
    return {"tasks": rows, "all_installed": all(r["installed"] for r in rows)}
