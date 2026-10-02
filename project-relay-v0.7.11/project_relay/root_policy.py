from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .state import atomic_write_json, state_dir

CONFIG = "allowed-roots.json"


def _path() -> Path:
    return state_dir() / CONFIG


def _normalize(value: str, *, must_exist: bool = True) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("root path is required")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ValueError("approved roots must be absolute paths")
    resolved = path.resolve(strict=False)
    if must_exist and not resolved.is_dir():
        raise NotADirectoryError(str(resolved))
    return resolved


def configured_roots() -> list[Path]:
    path = _path()
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return []
    values = raw.get("roots", []) if isinstance(raw, dict) else []
    if not isinstance(values, list):
        return []
    roots: list[Path] = []
    seen: set[str] = set()
    for value in values:
        try:
            root = _normalize(str(value), must_exist=False)
        except ValueError:
            continue
        key = os.path.normcase(str(root))
        if key not in seen:
            seen.add(key)
            roots.append(root)
    return roots


def local_list_roots() -> dict[str, Any]:
    roots = configured_roots()
    return {"count": len(roots), "roots": [str(root) for root in roots]}


def local_add_root(path: str) -> dict[str, Any]:
    root = _normalize(path, must_exist=True)
    roots = configured_roots()
    keys = {os.path.normcase(str(item)) for item in roots}
    key = os.path.normcase(str(root))
    if key not in keys:
        roots.append(root)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, {"roots": [str(item) for item in roots]})
    return {"added": key not in keys, "root": str(root), "roots": [str(item) for item in roots]}


def local_remove_root(path: str) -> dict[str, Any]:
    root = _normalize(path, must_exist=False)
    key = os.path.normcase(str(root))
    roots = configured_roots()
    kept = [item for item in roots if os.path.normcase(str(item)) != key]
    removed = len(kept) != len(roots)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, {"roots": [str(item) for item in kept]})
    return {"removed": removed, "root": str(root), "roots": [str(item) for item in kept]}
