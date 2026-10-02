from __future__ import annotations

import fnmatch
import os
import regex as regexlib
from pathlib import Path
from typing import Any

from . import commandport
from .owner_full_control import require_enabled

MAX_RESULTS = 500
MAX_SCANNED_FILES = 10_000
MAX_FILE_BYTES = 5_000_000


def owner_search_content(
    path: str,
    query: str,
    regex: bool = False,
    case_sensitive: bool = False,
    globs: list[str] | None = None,
    max_results: int = 100,
    max_depth: int = 12,
    max_file_bytes: int = 1_000_000,
    context_lines: int = 1,
) -> dict[str, Any]:
    require_enabled()
    root = commandport._resolve(path, must_exist=True)
    needle = str(query or "")
    if not needle or len(needle) > 10_000:
        raise ValueError("query is empty or exceeds limit")
    patterns = [str(value or "*").strip() or "*" for value in (globs or ["*"])]
    if len(patterns) > 20 or any(len(value) > 260 for value in patterns):
        raise ValueError("glob list exceeds limits")
    result_limit = max(1, min(int(max_results), MAX_RESULTS))
    depth_limit = max(0, min(int(max_depth), 32))
    file_limit = max(1, min(int(max_file_bytes), MAX_FILE_BYTES))
    context = max(0, min(int(context_lines), 5))
    allowed = commandport._allowed_roots()

    flags = 0 if case_sensitive else regexlib.IGNORECASE
    try:
        pattern = regexlib.compile(needle, flags) if regex else None
    except regexlib.error as exc:
        raise ValueError("invalid regular expression") from exc
    folded = needle if case_sensitive else needle.casefold()

    results: list[dict[str, Any]] = []
    scanned_files = 0
    skipped_files = 0
    truncated = False

    def selected(target: Path) -> bool:
        name = target.name.casefold()
        return any(fnmatch.fnmatch(name, glob.casefold()) for glob in patterns)

    def search_file(target: Path) -> None:
        nonlocal scanned_files, skipped_files, truncated
        if truncated or not selected(target):
            return
        try:
            if target.is_symlink() or not target.is_file():
                return
            resolved = target.resolve(strict=False)
            if not any(commandport._inside(resolved, allowed_root) for allowed_root in allowed):
                return
            size = target.stat().st_size
            if size > file_limit:
                skipped_files += 1
                return
            data = target.read_bytes()
        except OSError:
            skipped_files += 1
            return
        scanned_files += 1
        if b"\x00" in data[:8192]:
            skipped_files += 1
            return
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if regex:
                try:
                    match = pattern.search(line, timeout=0.05) if pattern else None
                except TimeoutError as exc:
                    raise ValueError("regular expression exceeded the per-line time limit") from exc
                if not match:
                    continue
                column = match.start()
                matched = match.group(0)
            else:
                haystack = line if case_sensitive else line.casefold()
                column = haystack.find(folded)
                if column < 0:
                    continue
                matched = line[column:column + len(needle)]
            before = lines[max(0, index-context):index]
            after = lines[index+1:index+1+context]
            results.append({
                "path": str(target),
                "line": index + 1,
                "column": column + 1,
                "match": matched[:500],
                "preview": line[:1000],
                "context_before": [value[:1000] for value in before],
                "context_after": [value[:1000] for value in after],
            })
            if len(results) >= result_limit:
                truncated = True
                return

    if root.is_file():
        search_file(root)
    else:
        for current_text, dirs, files in os.walk(root, topdown=True, followlinks=False):
            current = Path(current_text)
            try:
                level = len(current.relative_to(root).parts)
            except ValueError:
                dirs[:] = []
                continue
            if level >= depth_limit:
                dirs[:] = []
            else:
                dirs[:] = [
                    name for name in dirs
                    if not (current / name).is_symlink()
                ]
            for name in files:
                if scanned_files >= MAX_SCANNED_FILES:
                    truncated = True
                    break
                search_file(current / name)
                if truncated:
                    break
            if truncated:
                break

    return {
        "path": str(root),
        "query": needle,
        "regex": bool(regex),
        "case_sensitive": bool(case_sensitive),
        "globs": patterns,
        "count": len(results),
        "scanned_files": scanned_files,
        "skipped_files": skipped_files,
        "truncated": truncated,
        "matches": results,
    }
