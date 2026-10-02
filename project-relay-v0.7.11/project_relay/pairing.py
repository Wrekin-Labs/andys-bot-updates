from __future__ import annotations

import os
import secrets

from .state import state_dir


def load_or_create_pairing_secret() -> str:
    override = os.getenv("RELAY_PAIRING_SECRET", "").strip()
    if override:
        return override

    path = state_dir() / "pairing-secret.txt"
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if len(value) >= 32:
            return value

    value = secrets.token_urlsafe(32)
    path.write_text(value, encoding="utf-8")
    return value
