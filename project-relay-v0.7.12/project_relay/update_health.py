from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .state import atomic_write_json, state_dir

STATE_FILE = "update-health.json"
MAX_FAILURES = 3
BACKOFF_SECONDS = 6 * 60 * 60


def _path() -> Path:
    return state_dir() / STATE_FILE


def load_state() -> dict[str, Any]:
    defaults = {
        "consecutive_failures": 0,
        "last_attempt": None,
        "last_success": None,
        "last_version": None,
        "backoff_until": None,
    }
    path = _path()
    if not path.is_file():
        return defaults
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return defaults
    for key in defaults:
        if key in raw:
            defaults[key] = raw[key]
    return defaults


def can_attempt(now: float | None = None) -> bool:
    now = time.time() if now is None else float(now)
    state = load_state()
    until = state.get("backoff_until")
    return until is None or now >= float(until)


def record_attempt(version: str, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    state = load_state()
    state["last_attempt"] = now
    state["last_version"] = str(version)
    atomic_write_json(_path(), state)
    return state


def record_success(version: str, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    state = load_state()
    state.update({
        "consecutive_failures": 0,
        "last_success": now,
        "last_version": str(version),
        "backoff_until": None,
    })
    atomic_write_json(_path(), state)
    return state


def record_failure(version: str, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    state = load_state()
    failures = min(int(state.get("consecutive_failures") or 0) + 1, MAX_FAILURES)
    state["consecutive_failures"] = failures
    state["last_attempt"] = now
    state["last_version"] = str(version)
    if failures >= MAX_FAILURES:
        state["backoff_until"] = now + BACKOFF_SECONDS
    atomic_write_json(_path(), state)
    return state


def public_status(now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else float(now)
    state = load_state()
    return {
        "consecutive_failures": int(state.get("consecutive_failures") or 0),
        "last_attempt": state.get("last_attempt"),
        "last_success": state.get("last_success"),
        "last_version": state.get("last_version"),
        "backoff_active": not can_attempt(now),
    }
