from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
import json
import secrets
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .state import atomic_write_json, state_dir
from .audit import AuditLog


@dataclass
class ApprovalRecord:
    approval_id: str
    action: str
    device_id: str
    arguments_digest: str
    summary: str
    created_at: float
    expires_at: float
    approved_at: float | None = None
    consumed_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _digest(arguments: dict[str, Any]) -> str:
    body = json.dumps(arguments, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


class ApprovalStore:
    def __init__(self, path: Path | None = None):
        self.path = path or (state_dir() / "approvals.json")
        self.audit = AuditLog(self.path.with_name("audit.jsonl"))

    @contextmanager
    def _transaction(self):
        """Serialize approval mutations across MCP threads and UIA workers."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_suffix(self.path.suffix + ".lock")
        with lock_path.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            deadline = time.monotonic() + 5
            while True:
                try:
                    handle.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Approval store is busy; no action was authorized") from None
                    time.sleep(0.01)
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self, records: dict[str, dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(self.path, records)

    def create(self, action: str, device_id: str, arguments: dict[str, Any], summary: str, ttl_seconds: int = 600) -> ApprovalRecord:
        with self._transaction():
            now = time.time()
            record = ApprovalRecord(
                approval_id="approval-" + secrets.token_urlsafe(12),
                action=action,
                device_id=device_id,
                arguments_digest=_digest(arguments),
                summary=summary,
                created_at=now,
                expires_at=now + max(30, min(ttl_seconds, 3600)),
            )
            records = self._load()
            records[record.approval_id] = record.to_dict()
            self._save(records)
            self.audit.append("approval.created", {"approval_id": record.approval_id, "action": action, "device_id": device_id})
            return record

    def get(self, approval_id: str) -> ApprovalRecord:
        raw = self._load().get(approval_id)
        if not raw:
            raise KeyError("unknown approval id")
        return ApprovalRecord(**raw)

    def approve(self, approval_id: str, now: float | None = None) -> ApprovalRecord:
        with self._transaction():
            now = time.time() if now is None else now
            records = self._load()
            raw = records.get(approval_id)
            if not raw:
                raise KeyError("unknown approval id")
            record = ApprovalRecord(**raw)
            if now > record.expires_at:
                raise ValueError("approval expired")
            if record.consumed_at is not None:
                raise ValueError("approval already consumed")
            record.approved_at = now
            records[approval_id] = record.to_dict()
            self._save(records)
            self.audit.append("approval.granted", {"approval_id": approval_id, "action": record.action, "device_id": record.device_id})
            return record

    def consume(self, approval_id: str, *, action: str, device_id: str, arguments: dict[str, Any], now: float | None = None) -> ApprovalRecord:
        with self._transaction():
            now = time.time() if now is None else now
            records = self._load()
            raw = records.get(approval_id)
            if not raw:
                raise KeyError("unknown approval id")
            record = ApprovalRecord(**raw)
            if record.approved_at is None:
                raise PermissionError("approval has not been granted locally")
            if now > record.expires_at:
                raise PermissionError("approval expired")
            if record.consumed_at is not None:
                raise PermissionError("approval already consumed")
            if record.action != action or record.device_id != device_id or record.arguments_digest != _digest(arguments):
                raise PermissionError("approval does not match requested action")
            record.consumed_at = now
            records[approval_id] = record.to_dict()
            self._save(records)
            self.audit.append("approval.consumed", {"approval_id": approval_id, "action": action, "device_id": device_id})
            return record

    def pending(self, now: float | None = None) -> list[ApprovalRecord]:
        now = time.time() if now is None else now
        out = []
        for raw in self._load().values():
            record = ApprovalRecord(**raw)
            if record.approved_at is None and record.consumed_at is None and now <= record.expires_at:
                out.append(record)
        return sorted(out, key=lambda r: r.created_at)

