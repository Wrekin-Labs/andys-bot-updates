from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from .audit import AuditLog
from .state import atomic_write_json, state_dir


@dataclass
class OwnerGrant:
    grant_id: str
    action: str
    arguments_digest: str
    created_at: float
    expires_at: float
    consumed_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _digest(arguments: dict[str, Any]) -> str:
    body = json.dumps(arguments, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


class OwnerGrantStore:
    """Short-lived owner grants issued only after hosted owner authentication.

    This is deliberately separate from local ApprovalStore. A hosted controller may
    mint a grant only for an authenticated account owner; the workstation consumes
    it once for the exact action+arguments. There is no wildcard grant.
    """

    def __init__(self, path: Path | None = None):
        self.path = path or (state_dir() / "owner-grants.json")
        self.audit = AuditLog(self.path.with_name("audit.jsonl"))

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self, records: dict[str, dict[str, Any]]) -> None:
        atomic_write_json(self.path, records)

    def create(self, action: str, arguments: dict[str, Any], ttl_seconds: int = 120) -> OwnerGrant:
        now = time.time()
        record = OwnerGrant(
            grant_id="owner-" + secrets.token_urlsafe(18),
            action=action,
            arguments_digest=_digest(arguments),
            created_at=now,
            expires_at=now + max(30, min(int(ttl_seconds), 300)),
        )
        records = self._load()
        records[record.grant_id] = record.to_dict()
        self._save(records)
        self.audit.append("owner_grant.created", {"grant_id": record.grant_id, "action": action})
        return record

    def consume(self, grant_id: str, *, action: str, arguments: dict[str, Any], now: float | None = None) -> OwnerGrant:
        now = time.time() if now is None else now
        records = self._load()
        raw = records.get(grant_id)
        if not raw:
            raise PermissionError("owner grant is unknown")
        record = OwnerGrant(**raw)
        if record.consumed_at is not None:
            raise PermissionError("owner grant already consumed")
        if now > record.expires_at:
            raise PermissionError("owner grant expired")
        if not hmac.compare_digest(record.action, action) or not hmac.compare_digest(record.arguments_digest, _digest(arguments)):
            raise PermissionError("owner grant does not match requested action")
        record.consumed_at = now
        records[grant_id] = record.to_dict()
        self._save(records)
        self.audit.append("owner_grant.consumed", {"grant_id": grant_id, "action": action})
        return record
