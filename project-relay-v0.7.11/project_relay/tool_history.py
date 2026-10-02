from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from .state import state_dir

MAX_HISTORY_BYTES = 1_000_000
MAX_LINES = 2_000
_LOCK = threading.RLock()


def _path() -> Path:
    return state_dir() / "tool-history.jsonl"


def _safe_shape(arguments: dict[str, Any] | None) -> dict[str, str]:
    safe: dict[str, str] = {}
    for key, value in (arguments or {}).items():
        name = str(key)
        if any(mark in name.casefold() for mark in ("password", "secret", "token", "credential", "card", "otp", "2fa")):
            safe[name] = "redacted"
        elif value is None:
            safe[name] = "null"
        elif isinstance(value, bool):
            safe[name] = "bool"
        elif isinstance(value, int):
            safe[name] = "int"
        elif isinstance(value, float):
            safe[name] = "float"
        elif isinstance(value, str):
            safe[name] = f"str[{len(value)}]"
        elif isinstance(value, list):
            safe[name] = f"list[{len(value)}]"
        elif isinstance(value, dict):
            safe[name] = f"object[{len(value)}]"
        else:
            safe[name] = type(value).__name__
    return safe


def _rotate(path: Path) -> None:
    try:
        if path.stat().st_size <= MAX_HISTORY_BYTES:
            return
    except FileNotFoundError:
        return
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    keep = lines[-MAX_LINES:]
    temp = path.with_suffix(".jsonl.tmp")
    temp.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")
    os.replace(temp, path)


def record_tool_call(
    action: str,
    arguments: dict[str, Any] | None,
    *,
    success: bool,
    duration_ms: int,
    error_type: str | None = None,
) -> None:
    try:
        from .runtime_config import load_runtime_config
        if not load_runtime_config()["tool_history_enabled"]:
            return
    except Exception:
        pass
    event = {
        "ts": time.time(),
        "action": str(action),
        "success": bool(success),
        "duration_ms": max(0, int(duration_ms)),
        "argument_shape": _safe_shape(arguments),
        **({"error_type": str(error_type)} if error_type else {}),
    }
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, separators=(",", ":"), sort_keys=True) + "\n")
        _rotate(path)


def recent_tool_calls(limit: int = 50) -> dict[str, Any]:
    limit = max(1, min(int(limit), 200))
    path = _path()
    if not path.is_file():
        return {"count": 0, "calls": []}
    with _LOCK:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    rows = []
    for line in lines[-limit:]:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return {"count": len(rows), "calls": rows}
