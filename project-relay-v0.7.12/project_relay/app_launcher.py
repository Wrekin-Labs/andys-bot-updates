"""Allowlisted app launches, with exact single-use local approval."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import sys

from .approvals import ApprovalStore

APPS = {"notepad": "Notepad", "calculator": "Calculator", "relay": "Project Relay approvals"}
DEVICE = "commandport:applications"


def _resolve(app: str) -> list[str]:
    if app not in APPS:
        raise ValueError("Choose notepad, calculator or relay")
    if os.name != "nt":
        raise RuntimeError("App launching requires Windows")
    if app == "relay":
        exe = Path(sys.executable).with_name("pythonw.exe")
        return [str(exe), "-I", "-m", "project_relay.gui"]
    import ctypes
    buf = ctypes.create_unicode_buffer(32768)
    size = ctypes.windll.kernel32.GetSystemDirectoryW(buf, len(buf))
    if not size or size >= len(buf):
        raise RuntimeError("Cannot locate Windows system directory")
    return [str(Path(buf.value) / ("notepad.exe" if app == "notepad" else "calc.exe"))]


def _arguments(app: str) -> dict:
    command = _resolve(app)
    path = Path(command[0])
    if not path.is_file():
        raise RuntimeError("The selected application is unavailable")
    # Bind approval to the installed executable as well as its fixed arguments.
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"app": app, "command": command, "executable_digest": digest}


def commandport_prepare_launch_app(app: str) -> dict:
    args = _arguments(app)
    record = ApprovalStore().create("commandport_launch_app", DEVICE, args,
                                   "Open " + APPS[app] + " (no document or custom arguments)", ttl_seconds=120)
    return {"approval": record.to_dict()}


def commandport_launch_app(approval_id: str, app: str) -> dict:
    args = _arguments(app)
    ApprovalStore().consume(approval_id, action="commandport_launch_app", device_id=DEVICE, arguments=args)
    proc = subprocess.Popen(args["command"], shell=False, cwd=str(Path(args["command"][0]).parent),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"app": app, "launch_requested": True, "process_id": proc.pid,
            "note": "Process started; window readiness must be checked separately."}
