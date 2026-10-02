from __future__ import annotations

import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from .commandport import _resolve
from .owner_full_control import require_enabled

MAX_ARCHIVE_FILES = 5000
MAX_ARCHIVE_BYTES = 500_000_000
MAX_SINGLE_FILE = 100_000_000
MAX_RATIO = 200


def _safe_member_name(name: str) -> Path:
    normalized = name.replace("\\", "/")
    if not normalized or normalized.startswith("/"):
        raise ValueError("archive contains an absolute or empty path")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if not parts or ".." in parts:
        raise ValueError("archive contains path traversal")
    candidate = Path(*parts)
    if candidate.is_absolute():
        raise ValueError("archive contains an absolute path")
    return candidate


def _member_is_link(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return mode == stat.S_IFLNK


def list_zip(path: str, max_entries: int = 1000) -> dict[str, Any]:
    target = _resolve(path, must_exist=True)
    if not target.is_file():
        raise IsADirectoryError(str(target))
    limit = max(1, min(int(max_entries), MAX_ARCHIVE_FILES))
    rows: list[dict[str, Any]] = []
    total = 0
    with zipfile.ZipFile(target) as archive:
        for index, info in enumerate(archive.infolist()):
            if index >= limit:
                break
            safe = _safe_member_name(info.filename)
            if _member_is_link(info):
                raise PermissionError("archive contains symbolic-link entries")
            total += int(info.file_size)
            rows.append({
                "name": safe.as_posix(),
                "directory": info.is_dir(),
                "size": int(info.file_size),
                "compressed_size": int(info.compress_size),
            })
    return {
        "path": str(target),
        "count": len(rows),
        "entries": rows,
        "uncompressed_bytes_seen": total,
        "truncated": len(rows) >= limit,
    }


def owner_create_zip(
    destination: str,
    sources: list[str],
    compression: int = 6,
) -> dict[str, Any]:
    require_enabled()
    if not isinstance(sources, list) or not sources or len(sources) > 200:
        raise ValueError("sources must contain 1 to 200 approved-root paths")
    target = _resolve(destination, must_exist=False)
    if target.suffix.casefold() != ".zip":
        raise ValueError("destination must use .zip")
    compression = max(0, min(int(compression), 9))

    resolved: list[Path] = []
    total_bytes = 0
    total_files = 0
    for source in sources:
        item = _resolve(source, must_exist=True)
        resolved.append(item)
        if item.is_file():
            total_files += 1
            total_bytes += item.stat().st_size
        else:
            for root, dirs, files in os.walk(item, topdown=True, followlinks=False):
                current = Path(root)
                dirs[:] = [
                    name for name in dirs
                    if not (current / name).is_symlink()
                ]
                for name in files:
                    candidate = current / name
                    if candidate.is_symlink():
                        raise PermissionError("symbolic-link sources are not archived")
                    total_files += 1
                    total_bytes += candidate.stat().st_size
                    if total_files > MAX_ARCHIVE_FILES or total_bytes > MAX_ARCHIVE_BYTES:
                        raise ValueError("archive source exceeds file or byte limit")
    if total_files > MAX_ARCHIVE_FILES or total_bytes > MAX_ARCHIVE_BYTES:
        raise ValueError("archive source exceeds file or byte limit")

    target.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    method = zipfile.ZIP_STORED if compression == 0 else zipfile.ZIP_DEFLATED
    try:
        with tempfile.NamedTemporaryFile(delete=False, dir=str(target.parent), suffix=".zip") as handle:
            temp_name = handle.name
        with zipfile.ZipFile(temp_name, "w", compression=method, compresslevel=compression if method == zipfile.ZIP_DEFLATED else None) as archive:
            used: set[str] = set()
            for item in resolved:
                base = item.parent
                if item.is_file():
                    arc = item.name
                    if arc in used:
                        raise ValueError("archive member name collision")
                    used.add(arc)
                    archive.write(item, arc)
                    continue
                for root, dirs, files in os.walk(item, topdown=True, followlinks=False):
                    current = Path(root)
                    dirs[:] = [name for name in dirs if not (current / name).is_symlink()]
                    for name in files:
                        candidate = current / name
                        if candidate.is_symlink():
                            raise PermissionError("symbolic-link sources are not archived")
                        arc = str(candidate.relative_to(base)).replace("\\", "/")
                        _safe_member_name(arc)
                        if arc in used:
                            raise ValueError("archive member name collision")
                        used.add(arc)
                        archive.write(candidate, arc)
        os.replace(temp_name, target)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
    return {
        "created": True,
        "path": str(target),
        "files": total_files,
        "source_bytes": total_bytes,
        "archive_bytes": target.stat().st_size,
    }


def owner_extract_zip(
    path: str,
    destination: str,
    overwrite: bool = False,
) -> dict[str, Any]:
    require_enabled()
    source = _resolve(path, must_exist=True)
    target = _resolve(destination, must_exist=False)
    target.mkdir(parents=True, exist_ok=True)
    extracted = 0
    total_bytes = 0

    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ARCHIVE_FILES:
            raise ValueError("archive contains too many entries")
        plans: list[tuple[zipfile.ZipInfo, Path]] = []
        for info in infos:
            safe = _safe_member_name(info.filename)
            if _member_is_link(info):
                raise PermissionError("archive contains symbolic-link entries")
            size = int(info.file_size)
            compressed = max(1, int(info.compress_size))
            if size > MAX_SINGLE_FILE:
                raise ValueError("archive member exceeds single-file limit")
            if size > compressed * MAX_RATIO and size > 1_000_000:
                raise ValueError("archive member exceeds compression-ratio limit")
            total_bytes += size
            if total_bytes > MAX_ARCHIVE_BYTES:
                raise ValueError("archive exceeds uncompressed-byte limit")
            output = _resolve(str(target / safe), must_exist=False)
            if output.exists() and not overwrite and not info.is_dir():
                raise FileExistsError(str(output))
            plans.append((info, output))

        for info, output in plans:
            if info.is_dir():
                output.mkdir(parents=True, exist_ok=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as src, output.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            extracted += 1

    return {
        "extracted": True,
        "archive": str(source),
        "destination": str(target),
        "files": extracted,
        "uncompressed_bytes": total_bytes,
    }
