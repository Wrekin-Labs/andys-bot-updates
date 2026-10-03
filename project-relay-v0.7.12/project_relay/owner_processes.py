from __future__ import annotations

import os
import subprocess
from typing import Any

from .owner_full_control import require_enabled


def terminate(pid: int, tree: bool = False, force: bool = False) -> dict[str, Any]:
    require_enabled()
    pid = int(pid)
    if pid <= 4 or pid == os.getpid():
        raise PermissionError("protected process")
    args = ["taskkill.exe", "/PID", str(pid)]
    if tree: args.append("/T")
    if force: args.append("/F")
    proc = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
    return {"pid": pid, "terminated": proc.returncode == 0, "returncode": proc.returncode}


def start(executable: str, args: list[str] | None = None, cwd: str | None = None) -> dict[str, Any]:
    require_enabled()
    argv = [str(executable), *[str(x) for x in (args or [])]]
    if len(argv) > 65 or any(len(x) > 4096 for x in argv):
        raise ValueError("process arguments exceed limits")
    proc = subprocess.Popen(argv, cwd=cwd or None, close_fds=True)
    return {"started": True, "pid": proc.pid}
