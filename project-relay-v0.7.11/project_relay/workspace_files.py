from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from .commandport import _resolve
from .owner_full_control import require_enabled
from .state import state_dir

MAX_READ_BYTES = 256_000
MAX_EDIT_BYTES = 2_000_000
MAX_MULTI_FILES = 20
MAX_MULTI_BYTES = 1_000_000
MAX_DIFF_CHARS = 64_000


def _target_file(path: str, *, max_bytes: int | None = None) -> Path:
    target = _resolve(path, must_exist=True)
    if not target.is_file():
        raise IsADirectoryError(str(target))
    if target.is_symlink():
        raise PermissionError("symbolic-link files are not editable")
    if max_bytes is not None and target.stat().st_size > max_bytes:
        raise ValueError("file exceeds Project Relay size limit")
    return target


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_file(path: str) -> dict[str, Any]:
    target = _target_file(path)
    digest = hashlib.sha256()
    size = 0
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return {"path": str(target), "algorithm": "sha256", "sha256": digest.hexdigest(), "size": size}


def read_file(path: str, offset: int = 0, length: int = 64_000) -> dict[str, Any]:
    target = _target_file(path)
    length = max(1, min(int(length), MAX_READ_BYTES))
    data = target.read_bytes()
    requested_offset = int(offset)
    start = requested_offset if requested_offset >= 0 else max(0, len(data) + requested_offset)
    start = min(start, len(data))
    chunk = data[start : start + length]
    return {
        "path": str(target),
        "offset": start,
        "requested_offset": requested_offset,
        "length": len(chunk),
        "total_bytes": len(data),
        "text": chunk.decode("utf-8", errors="replace"),
        "has_more": start + len(chunk) < len(data),
        "next_offset": start + len(chunk),
    }


def read_file_lines(
    path: str,
    offset: int = 0,
    length: int = 1_000,
) -> dict[str, Any]:
    target = _target_file(path, max_bytes=20_000_000)
    data = target.read_bytes()
    if b"\x00" in data[:8192]:
        raise ValueError("binary files cannot be read with the line reader")
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    total = len(lines)
    requested = int(offset)
    if requested < 0:
        count = min(abs(requested), 5_000)
        start = max(0, total - count)
        selected = lines[start:]
    else:
        start = min(requested, total)
        count = max(1, min(int(length), 5_000))
        selected = lines[start:start + count]
    returned = len(selected)
    next_offset = start + returned
    return {
        "path": str(target),
        "requested_offset": requested,
        "start_line": start,
        "line_count": returned,
        "total_lines": total,
        "next_offset": next_offset,
        "has_more": next_offset < total,
        "text": "\n".join(selected),
    }


def read_multiple_files(
    paths: list[str],
    offset: int = 0,
    length: int = 64_000,
) -> dict[str, Any]:
    if not isinstance(paths, list) or not paths:
        raise ValueError("paths must contain at least one file")
    if len(paths) > MAX_MULTI_FILES:
        raise ValueError(f"at most {MAX_MULTI_FILES} files may be read at once")
    per_file = max(1, min(int(length), MAX_READ_BYTES))
    items: list[dict[str, Any]] = []
    total = 0
    for path in paths:
        remaining = MAX_MULTI_BYTES - total
        if remaining <= 0:
            break
        item = read_file(path, offset=offset, length=min(per_file, remaining))
        total += int(item["length"])
        items.append(item)
    return {
        "count": len(items),
        "requested_count": len(paths),
        "total_returned_bytes": total,
        "truncated": len(items) < len(paths) or total >= MAX_MULTI_BYTES,
        "files": items,
    }


def _read_editable(target: Path) -> tuple[bytes, str]:
    data = target.read_bytes()
    if len(data) > MAX_EDIT_BYTES:
        raise ValueError("file exceeds editable size limit")
    if b"\x00" in data[:8192]:
        raise ValueError("binary files cannot be edited with text tools")
    try:
        return data, data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("text editing requires valid UTF-8") from exc


def _replacement(
    text: str,
    find: str,
    replace: str,
    *,
    regex: bool,
    count: int,
) -> tuple[str, int]:
    if not find:
        raise ValueError("find text is required")
    if len(find) > 20_000 or len(replace) > 200_000:
        raise ValueError("replacement input exceeds limit")
    count = max(0, min(int(count), 10_000))
    if regex:
        pattern = re.compile(find)
        return pattern.subn(replace, text, count=count)
    occurrences = text.count(find)
    if count:
        occurrences = min(occurrences, count)
        return text.replace(find, replace, count), occurrences
    return text.replace(find, replace), occurrences


def preview_text_replace(
    path: str,
    find: str,
    replace: str,
    regex: bool = False,
    count: int = 0,
) -> dict[str, Any]:
    target = _target_file(path, max_bytes=MAX_EDIT_BYTES)
    before_bytes, before = _read_editable(target)
    after, replacements = _replacement(before, find, replace, regex=bool(regex), count=count)
    diff = "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=str(target),
            tofile=str(target),
            n=3,
        )
    )
    diff_truncated = len(diff) > MAX_DIFF_CHARS
    if diff_truncated:
        diff = diff[:MAX_DIFF_CHARS] + "\n... diff truncated by Project Relay ...\n"
    return {
        "path": str(target),
        "before_sha256": _sha256_bytes(before_bytes),
        "after_sha256": _sha256_bytes(after.encode("utf-8")),
        "replacements": replacements,
        "changed": before != after,
        "diff": diff,
        "diff_truncated": diff_truncated,
    }


def _checkpoint_dir() -> Path:
    root = state_dir() / "checkpoints"
    root.mkdir(parents=True, exist_ok=True)
    return root


def owner_apply_text_replace(
    path: str,
    find: str,
    replace: str,
    regex: bool = False,
    count: int = 0,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    require_enabled()
    target = _target_file(path, max_bytes=MAX_EDIT_BYTES)
    before_bytes, before = _read_editable(target)
    before_sha = _sha256_bytes(before_bytes)
    if expected_sha256 and before_sha.lower() != str(expected_sha256).lower():
        raise RuntimeError("file changed since preview; replacement aborted")
    after, replacements = _replacement(before, find, replace, regex=bool(regex), count=count)
    if after == before:
        return {
            "changed": False,
            "path": str(target),
            "before_sha256": before_sha,
            "after_sha256": before_sha,
            "replacements": 0,
        }

    checkpoint_id = "cp-" + uuid.uuid4().hex
    checkpoint_root = _checkpoint_dir()
    backup = checkpoint_root / f"{checkpoint_id}.bak"
    meta = checkpoint_root / f"{checkpoint_id}.json"
    backup.write_bytes(before_bytes)

    after_bytes = after.encode("utf-8")
    after_sha = _sha256_bytes(after_bytes)
    metadata = {
        "checkpoint_id": checkpoint_id,
        "target": str(target),
        "before_sha256": before_sha,
        "after_sha256": after_sha,
        "created_at": time.time(),
    }
    meta.write_text(json.dumps(metadata, separators=(",", ":"), sort_keys=True), encoding="utf-8")

    mode = target.stat().st_mode
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, dir=str(target.parent), prefix=f".{target.name}.relay-"
        ) as handle:
            temp_name = handle.name
            handle.write(after_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, target)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)

    return {
        "changed": True,
        "path": str(target),
        "before_sha256": before_sha,
        "after_sha256": after_sha,
        "replacements": replacements,
        "checkpoint_id": checkpoint_id,
    }


def owner_rollback_text_edit(checkpoint_id: str) -> dict[str, Any]:
    require_enabled()
    value = str(checkpoint_id or "").strip()
    if not re.fullmatch(r"cp-[0-9a-f]{32}", value):
        raise ValueError("invalid checkpoint id")
    root = _checkpoint_dir()
    meta_path = root / f"{value}.json"
    backup_path = root / f"{value}.bak"
    if not meta_path.is_file() or not backup_path.is_file():
        raise KeyError("checkpoint not found")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    target = _resolve(str(meta["target"]), must_exist=True)
    current = target.read_bytes()
    if _sha256_bytes(current) != str(meta["after_sha256"]):
        raise RuntimeError("file changed after edit; rollback refused")
    before = backup_path.read_bytes()
    if _sha256_bytes(before) != str(meta["before_sha256"]):
        raise RuntimeError("checkpoint integrity check failed")

    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, dir=str(target.parent), prefix=f".{target.name}.rollback-"
        ) as handle:
            temp_name = handle.name
            handle.write(before)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)

    return {
        "rolled_back": True,
        "checkpoint_id": value,
        "path": str(target),
        "sha256": _sha256_bytes(before),
    }


def owner_write_text_file(
    path: str,
    content: str,
    mode: str = "rewrite",
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    require_enabled()
    selected_mode = str(mode or "rewrite").lower().strip()
    if selected_mode not in {"rewrite", "append"}:
        raise ValueError("mode must be rewrite or append")
    value = str(content)
    encoded = value.encode("utf-8")
    if len(encoded) > MAX_EDIT_BYTES:
        raise ValueError("text content exceeds write limit")

    target = _resolve(path, must_exist=False)
    if target.exists() and not target.is_file():
        raise IsADirectoryError(str(target))
    before = target.read_bytes() if target.is_file() else b""
    if before and b"\x00" in before[:8192]:
        raise ValueError("refusing to replace or append to a binary file with text")
    before_sha = _sha256_bytes(before) if before else None
    if expected_sha256 is not None:
        if before_sha is None:
            raise RuntimeError("expected_sha256 was provided but target does not exist")
        if before_sha.lower() != str(expected_sha256).lower():
            raise RuntimeError("file changed since preview/read; write aborted")

    after = before + encoded if selected_mode == "append" else encoded
    if len(after) > MAX_EDIT_BYTES:
        raise ValueError("resulting text file exceeds write limit")
    after_sha = _sha256_bytes(after)
    if before == after:
        return {
            "changed": False,
            "path": str(target),
            "mode": selected_mode,
            "before_sha256": before_sha,
            "after_sha256": after_sha,
            "bytes_written": 0,
        }

    target.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_id: str | None = None
    if before:
        checkpoint_id = "cp-" + uuid.uuid4().hex
        root = _checkpoint_dir()
        (root / f"{checkpoint_id}.bak").write_bytes(before)
        (root / f"{checkpoint_id}.json").write_text(
            json.dumps(
                {
                    "checkpoint_id": checkpoint_id,
                    "target": str(target),
                    "before_sha256": before_sha,
                    "after_sha256": after_sha,
                    "created_at": time.time(),
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    _atomic_replace_bytes(target, after)
    return {
        "changed": True,
        "path": str(target),
        "mode": selected_mode,
        "before_sha256": before_sha,
        "after_sha256": after_sha,
        "bytes_written": len(encoded),
        **({"checkpoint_id": checkpoint_id} if checkpoint_id else {}),
    }


def preview_text_transaction(edits: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(edits, list) or not edits or len(edits) > 20:
        raise ValueError("edits must contain 1 to 20 file edits")
    seen: set[str] = set()
    previews = []
    for edit in edits:
        if not isinstance(edit, dict):
            raise ValueError("each edit must be an object")
        path = str(edit.get("path") or "")
        target = _target_file(path, max_bytes=MAX_EDIT_BYTES)
        key = os.path.normcase(str(target))
        if key in seen:
            raise ValueError("transaction cannot edit the same file twice")
        seen.add(key)
        preview = preview_text_replace(
            str(target),
            str(edit.get("find") or ""),
            str(edit.get("replace") or ""),
            regex=bool(edit.get("regex", False)),
            count=int(edit.get("count", 0) or 0),
        )
        previews.append(preview)
    return {
        "count": len(previews),
        "changed_files": sum(1 for item in previews if item["changed"]),
        "files": previews,
    }


def _atomic_replace_bytes(target: Path, data: bytes) -> None:
    mode = target.stat().st_mode if target.exists() else None
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, dir=str(target.parent), prefix=f".{target.name}.relay-tx-"
        ) as handle:
            temp_name = handle.name
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(temp_name, mode)
        os.replace(temp_name, target)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def owner_apply_text_transaction(edits: list[dict[str, Any]]) -> dict[str, Any]:
    require_enabled()
    if not isinstance(edits, list) or not edits or len(edits) > 20:
        raise ValueError("edits must contain 1 to 20 file edits")

    prepared: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edit in edits:
        if not isinstance(edit, dict):
            raise ValueError("each edit must be an object")
        target = _target_file(str(edit.get("path") or ""), max_bytes=MAX_EDIT_BYTES)
        key = os.path.normcase(str(target))
        if key in seen:
            raise ValueError("transaction cannot edit the same file twice")
        seen.add(key)

        before_bytes, before_text = _read_editable(target)
        before_sha = _sha256_bytes(before_bytes)
        expected = edit.get("expected_sha256")
        if expected and before_sha.lower() != str(expected).lower():
            raise RuntimeError(f"file changed since preview: {target}")
        after_text, replacements = _replacement(
            before_text,
            str(edit.get("find") or ""),
            str(edit.get("replace") or ""),
            regex=bool(edit.get("regex", False)),
            count=int(edit.get("count", 0) or 0),
        )
        after_bytes = after_text.encode("utf-8")
        prepared.append({
            "target": target,
            "before": before_bytes,
            "after": after_bytes,
            "before_sha256": before_sha,
            "after_sha256": _sha256_bytes(after_bytes),
            "replacements": replacements,
            "changed": before_bytes != after_bytes,
        })

    changed = [item for item in prepared if item["changed"]]
    if not changed:
        return {"changed": False, "changed_files": 0, "files": []}

    transaction_id = "tx-" + uuid.uuid4().hex
    root = _checkpoint_dir() / transaction_id
    root.mkdir(parents=True, exist_ok=False)

    metadata: list[dict[str, Any]] = []
    for index, item in enumerate(changed):
        backup_name = f"{index:02d}.bak"
        (root / backup_name).write_bytes(item["before"])
        metadata.append({
            "target": str(item["target"]),
            "before_sha256": item["before_sha256"],
            "after_sha256": item["after_sha256"],
            "backup": backup_name,
            "replacements": item["replacements"],
        })

    (root / "transaction.json").write_text(
        json.dumps(
            {
                "transaction_id": transaction_id,
                "created_at": time.time(),
                "files": metadata,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    written: list[dict[str, Any]] = []
    try:
        for item in changed:
            _atomic_replace_bytes(item["target"], item["after"])
            written.append(item)
    except Exception:
        for item in reversed(written):
            try:
                _atomic_replace_bytes(item["target"], item["before"])
            except Exception:
                pass
        raise

    return {
        "changed": True,
        "transaction_id": transaction_id,
        "changed_files": len(changed),
        "files": [
            {
                "path": str(item["target"]),
                "before_sha256": item["before_sha256"],
                "after_sha256": item["after_sha256"],
                "replacements": item["replacements"],
            }
            for item in changed
        ],
    }


def owner_rollback_text_transaction(transaction_id: str) -> dict[str, Any]:
    require_enabled()
    value = str(transaction_id or "").strip()
    if not re.fullmatch(r"tx-[0-9a-f]{32}", value):
        raise ValueError("invalid transaction id")
    root = _checkpoint_dir() / value
    meta_path = root / "transaction.json"
    if not meta_path.is_file():
        raise KeyError("transaction checkpoint not found")
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    files = metadata.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("transaction checkpoint is invalid")

    prepared: list[tuple[Path, bytes]] = []
    for item in files:
        target = _resolve(str(item["target"]), must_exist=True)
        current = target.read_bytes()
        if _sha256_bytes(current) != str(item["after_sha256"]):
            raise RuntimeError(f"file changed after transaction; rollback refused: {target}")
        backup = root / str(item["backup"])
        before = backup.read_bytes()
        if _sha256_bytes(before) != str(item["before_sha256"]):
            raise RuntimeError("transaction checkpoint integrity check failed")
        prepared.append((target, before))

    for target, before in prepared:
        _atomic_replace_bytes(target, before)

    return {
        "rolled_back": True,
        "transaction_id": value,
        "files_restored": len(prepared),
        "paths": [str(target) for target, _ in prepared],
    }
