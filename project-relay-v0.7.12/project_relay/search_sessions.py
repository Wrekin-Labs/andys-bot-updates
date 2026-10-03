from __future__ import annotations

import fnmatch
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import regex as regexlib

from . import commandport
from .owner_full_control import require_enabled

MAX_SESSIONS = 8
MAX_RESULTS = 5_000
MAX_SCANNED_FILES = 50_000
MAX_FILE_BYTES = 5_000_000
MAX_RESULT_PREVIEW = 1_000


@dataclass
class _SearchSession:
    session_id: str
    search_type: str
    root: str
    created_at: float
    status: str = "running"
    results: list[dict[str, Any]] = field(default_factory=list)
    scanned_files: int = 0
    skipped_files: int = 0
    error: str | None = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.RLock = field(default_factory=threading.RLock)


_SESSIONS: dict[str, _SearchSession] = {}
_LOCK = threading.RLock()


def _append(session: _SearchSession, item: dict[str, Any]) -> bool:
    with session.lock:
        if len(session.results) >= MAX_RESULTS:
            session.status = "truncated"
            session.stop_event.set()
            return False
        session.results.append(item)
        return True


def _selected(name: str, globs: list[str]) -> bool:
    folded = name.casefold()
    return any(fnmatch.fnmatch(folded, pattern.casefold()) for pattern in globs)


def _walk(
    session: _SearchSession,
    root: Path,
    max_depth: int,
    globs: list[str],
):
    if root.is_file():
        yield root
        return
    for current_text, dirs, files in os.walk(root, topdown=True, followlinks=False):
        if session.stop_event.is_set():
            return
        current = Path(current_text)
        try:
            level = len(current.relative_to(root).parts)
        except ValueError:
            dirs[:] = []
            continue
        if level >= max_depth:
            dirs[:] = []
        else:
            safe_dirs = []
            for name in dirs:
                candidate = current / name
                try:
                    resolved = candidate.resolve(strict=False)
                except OSError:
                    continue
                if candidate.is_symlink():
                    continue
                if not any(commandport._inside(resolved, allowed) for allowed in commandport._allowed_roots()):
                    continue
                safe_dirs.append(name)
            dirs[:] = safe_dirs
        for name in files:
            if session.stop_event.is_set():
                return
            candidate = current / name
            if _selected(name, globs):
                yield candidate


def _files_worker(
    session: _SearchSession,
    root: Path,
    pattern: str,
    max_depth: int,
) -> None:
    try:
        for target in _walk(session, root, max_depth, ["*"]):
            if session.stop_event.is_set():
                break
            session.scanned_files += 1
            if session.scanned_files > MAX_SCANNED_FILES:
                session.status = "truncated"
                break
            if fnmatch.fnmatch(target.name.casefold(), pattern.casefold()):
                try:
                    stat = target.stat()
                    item = {
                        "path": str(target),
                        "name": target.name,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                    }
                except OSError:
                    session.skipped_files += 1
                    continue
                if not _append(session, item):
                    break
        if session.status in {"running", "stopping"}:
            session.status = "stopped" if session.stop_event.is_set() else "completed"
    except Exception as exc:
        session.error = type(exc).__name__
        session.status = "error"


def _content_worker(
    session: _SearchSession,
    root: Path,
    query: str,
    regex: bool,
    case_sensitive: bool,
    globs: list[str],
    max_depth: int,
    max_file_bytes: int,
) -> None:
    flags = 0 if case_sensitive else regexlib.IGNORECASE
    pattern = regexlib.compile(query, flags) if regex else None
    folded = query if case_sensitive else query.casefold()
    try:
        for target in _walk(session, root, max_depth, globs):
            if session.stop_event.is_set():
                break
            session.scanned_files += 1
            if session.scanned_files > MAX_SCANNED_FILES:
                session.status = "truncated"
                break
            try:
                if target.is_symlink() or not target.is_file():
                    continue
                stat = target.stat()
                if stat.st_size > max_file_bytes:
                    session.skipped_files += 1
                    continue
                data = target.read_bytes()
            except OSError:
                session.skipped_files += 1
                continue
            if b"\x00" in data[:8192]:
                session.skipped_files += 1
                continue
            lines = data.decode("utf-8", errors="replace").splitlines()
            for index, line in enumerate(lines):
                if session.stop_event.is_set():
                    break
                if regex:
                    try:
                        match = pattern.search(line, timeout=0.05) if pattern else None
                    except TimeoutError:
                        session.error = "RegexTimeout"
                        session.status = "error"
                        session.stop_event.set()
                        return
                    if not match:
                        continue
                    column = match.start()
                    matched = match.group(0)
                else:
                    haystack = line if case_sensitive else line.casefold()
                    column = haystack.find(folded)
                    if column < 0:
                        continue
                    matched = line[column:column + len(query)]
                if not _append(
                    session,
                    {
                        "path": str(target),
                        "line": index + 1,
                        "column": column + 1,
                        "match": matched[:500],
                        "preview": line[:MAX_RESULT_PREVIEW],
                    },
                ):
                    break
            if session.stop_event.is_set():
                break
        if session.status in {"running", "stopping"}:
            session.status = "stopped" if session.stop_event.is_set() else "completed"
    except Exception as exc:
        session.error = type(exc).__name__
        session.status = "error"


def _prune() -> None:
    now = time.time()
    with _LOCK:
        old = [
            key for key, value in _SESSIONS.items()
            if value.status != "running" and now - value.created_at > 600
        ]
        for key in old:
            _SESSIONS.pop(key, None)


def owner_start_search_session(
    path: str,
    search_type: str,
    query: str,
    regex: bool = False,
    case_sensitive: bool = False,
    globs: list[str] | None = None,
    max_depth: int = 12,
    max_file_bytes: int = 1_000_000,
) -> dict[str, Any]:
    require_enabled()
    _prune()
    selected_type = str(search_type or "").lower().strip()
    if selected_type not in {"files", "content"}:
        raise ValueError("search_type must be files or content")
    needle = str(query or "")
    if not needle or len(needle) > 10_000:
        raise ValueError("query is empty or exceeds limit")
    patterns = [str(value or "*").strip() or "*" for value in (globs or ["*"])]
    if len(patterns) > 20 or any(len(value) > 260 for value in patterns):
        raise ValueError("glob list exceeds limits")
    depth = max(0, min(int(max_depth), 32))
    file_limit = max(1, min(int(max_file_bytes), MAX_FILE_BYTES))
    root = commandport._resolve(path, must_exist=True)
    if regex:
        try:
            regexlib.compile(needle, 0 if case_sensitive else regexlib.IGNORECASE)
        except regexlib.error as exc:
            raise ValueError("invalid regular expression") from exc

    with _LOCK:
        running = [value for value in _SESSIONS.values() if value.status == "running"]
        if len(running) >= MAX_SESSIONS:
            raise RuntimeError("maximum search session count reached")
        session_id = "search-" + uuid.uuid4().hex
        session = _SearchSession(
            session_id=session_id,
            search_type=selected_type,
            root=str(root),
            created_at=time.time(),
        )
        _SESSIONS[session_id] = session

    if selected_type == "files":
        worker = threading.Thread(
            target=_files_worker,
            args=(session, root, needle, depth),
            daemon=True,
        )
    else:
        worker = threading.Thread(
            target=_content_worker,
            args=(session, root, needle, bool(regex), bool(case_sensitive), patterns, depth, file_limit),
            daemon=True,
        )
    worker.start()
    return {
        "session_id": session_id,
        "search_type": selected_type,
        "status": "running",
        "root": str(root),
    }


def _get(session_id: str) -> _SearchSession:
    value = str(session_id or "").strip()
    with _LOCK:
        session = _SESSIONS.get(value)
    if not session:
        raise KeyError("unknown search session")
    return session


def owner_read_search_results(
    session_id: str,
    offset: int = 0,
    length: int = 100,
) -> dict[str, Any]:
    require_enabled()
    session = _get(session_id)
    count = max(1, min(int(length), 500))
    with session.lock:
        total = len(session.results)
        requested = int(offset)
        start = requested if requested >= 0 else max(0, total + requested)
        start = min(start, total)
        rows = list(session.results[start:start + count])
        next_offset = start + len(rows)
        return {
            "session_id": session.session_id,
            "search_type": session.search_type,
            "status": session.status,
            "error_type": session.error,
            "scanned_files": session.scanned_files,
            "skipped_files": session.skipped_files,
            "total_results": total,
            "offset": start,
            "next_offset": next_offset,
            "has_more": next_offset < total or session.status == "running",
            "results": rows,
        }


def owner_list_search_sessions() -> dict[str, Any]:
    require_enabled()
    _prune()
    with _LOCK:
        rows = [
            {
                "session_id": value.session_id,
                "search_type": value.search_type,
                "root": value.root,
                "status": value.status,
                "results": len(value.results),
                "scanned_files": value.scanned_files,
                "created_at": value.created_at,
            }
            for value in _SESSIONS.values()
        ]
    return {"count": len(rows), "searches": rows}


def owner_stop_search_session(session_id: str) -> dict[str, Any]:
    require_enabled()
    session = _get(session_id)
    session.stop_event.set()
    with session.lock:
        if session.status == "running":
            session.status = "stopping"
        return {
            "session_id": session.session_id,
            "stop_requested": True,
            "status": session.status,
            "results": len(session.results),
        }
