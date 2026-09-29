#!/usr/bin/env python3
"""Local-only Project Relay supervised-app registration for Andy's Bot R7.6.

Run this with Project Relay's own venv Python so it writes to the correct
per-user Relay state. It does not enable Owner Full Control or alter approvals.
"""
from __future__ import annotations
import os
from pathlib import Path

from project_relay.supervised_apps import register_local

ROOT = Path(r"C:\AndysBot\Andys_Bot_Desktop_Current")
R76 = ROOT / "r7_6_execution_quality_shadow"
LOCAL = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
PYTHON = LOCAL / "Programs" / "Python" / "Python312" / "python.exe"
PYTHONW = LOCAL / "Programs" / "Python" / "Python312" / "pythonw.exe"


def main() -> int:
    if not PYTHON.is_file():
        raise RuntimeError(f"Andy Bot Python not found: {PYTHON}")
    if not PYTHONW.is_file():
        raise RuntimeError(f"Andy Bot pythonw not found: {PYTHONW}")
    server = ROOT / "server.py"
    overlay = R76 / "r76_shadow_overlay.py"
    tca = R76 / "live_tca_daemon.py"
    for path in (server, overlay, tca):
        if not path.is_file():
            raise RuntimeError(f"Supervised target missing: {path}")

    results = [
        register_local("Andy Bot", str(PYTHON), [str(server)]),
        register_local("R7.6 Shadow Overlay", str(PYTHONW), [str(overlay)]),
        register_local("R7.6 Live TCA", str(PYTHONW), [str(tca)]),
    ]
    for item in results:
        print(item["name"], "registered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
