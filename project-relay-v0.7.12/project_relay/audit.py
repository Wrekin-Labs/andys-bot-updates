from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from .state import state_dir


class AuditLog:
    def __init__(self, path: Path | None = None):
        self.path = path or (state_dir() / "audit.jsonl")

    def append(self, event: str, data: dict[str, Any]) -> dict[str, Any]:
        previous = self._last_hash()
        entry = {"time": time.time(), "event": event, "data": data, "previous": previous}
        payload = json.dumps(entry, separators=(",", ":"), sort_keys=True).encode("utf-8")
        entry["hash"] = hashlib.sha256(payload).hexdigest()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, sort_keys=True) + "\n")
        return entry

    def _last_hash(self) -> str:
        if not self.path.exists():
            return "GENESIS"
        lines = [line for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not lines:
            return "GENESIS"
        return json.loads(lines[-1])["hash"]

    def verify(self) -> tuple[bool, int]:
        if not self.path.exists():
            return True, 0
        previous = "GENESIS"
        count = 0
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            claimed = entry.pop("hash")
            if entry.get("previous") != previous:
                return False, count
            payload = json.dumps(entry, separators=(",", ":"), sort_keys=True).encode("utf-8")
            actual = hashlib.sha256(payload).hexdigest()
            if actual != claimed:
                return False, count
            previous = claimed
            count += 1
        return True, count
