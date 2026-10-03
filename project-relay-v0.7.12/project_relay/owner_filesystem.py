from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .owner_full_control import require_enabled
from .commandport import _contains_link_or_reparse


def _path(value: str) -> Path:
    candidate = Path(str(value or "")).expanduser()
    if not candidate.is_absolute():
        raise ValueError("absolute path required")
    if _contains_link_or_reparse(candidate):
        raise PermissionError("symbolic links and reparse-point traversal are not allowed")
    return candidate.resolve(strict=False)


def mkdir(path: str) -> dict[str, Any]:
    require_enabled(); p = _path(path); p.mkdir(parents=True, exist_ok=True)
    return {"created": True, "path": str(p)}


def move(source: str, destination: str) -> dict[str, Any]:
    require_enabled(); src, dst = _path(source), _path(destination)
    if not src.exists(): raise FileNotFoundError(str(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    result = shutil.move(str(src), str(dst))
    return {"moved": True, "path": str(result)}


def copy(source: str, destination: str) -> dict[str, Any]:
    require_enabled(); src, dst = _path(source), _path(destination)
    if not src.exists(): raise FileNotFoundError(str(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir(): shutil.copytree(src, dst, dirs_exist_ok=False)
    else: shutil.copy2(src, dst)
    return {"copied": True, "destination": str(dst)}


def delete(path: str, recursive: bool = False) -> dict[str, Any]:
    require_enabled(); p = _path(path)
    if not p.exists(): return {"deleted": False, "reason": "not-found"}
    if p.is_dir():
        if not recursive: p.rmdir()
        else: shutil.rmtree(p)
    else: p.unlink()
    return {"deleted": True, "path": str(p)}
