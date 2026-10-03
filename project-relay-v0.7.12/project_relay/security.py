from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass, field


def body_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def canonical_message(timestamp: str, nonce: str, body_digest: str) -> bytes:
    return f"{timestamp}\n{nonce}\n{body_digest}".encode("utf-8")


def sign(secret: str, timestamp: str, nonce: str, body: bytes) -> str:
    msg = canonical_message(timestamp, nonce, body_hash(body))
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


@dataclass
class ReplayGuard:
    ttl_seconds: int = 120
    seen: dict[str, float] = field(default_factory=dict)

    def accept(self, nonce: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        self.seen = {n: t for n, t in self.seen.items() if now - t <= self.ttl_seconds}
        if nonce in self.seen:
            return False
        self.seen[nonce] = now
        return True


def verify(secret: str, timestamp: str, nonce: str, signature: str, body: bytes, *, max_skew: int = 60, now: float | None = None) -> tuple[bool, str]:
    now = time.time() if now is None else now
    try:
        ts = float(timestamp)
    except (TypeError, ValueError):
        return False, "invalid timestamp"
    if abs(now - ts) > max_skew:
        return False, "timestamp outside allowed clock skew"
    expected = sign(secret, timestamp, nonce, body)
    if not hmac.compare_digest(expected, signature):
        return False, "signature mismatch"
    return True, "ok"


def generate_pairing_secret() -> str:
    return secrets.token_urlsafe(32)
