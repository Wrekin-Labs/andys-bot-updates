from __future__ import annotations

import json
import os
from pathlib import Path


def state_dir() -> Path:
    override = os.getenv("RELAY_STATE_DIR", "").strip()
    if override:
        path = Path(override)
    elif os.name == "nt":
        base = Path(os.getenv("LOCALAPPDATA", Path.home()))
        path = base / "ProjectRelay"
    else:
        path = Path.home() / ".project-relay"
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic_write_json(path: Path, value: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)
