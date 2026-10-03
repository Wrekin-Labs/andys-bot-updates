from __future__ import annotations

import json
import urllib.request
from typing import Any

from .cloud_credentials import load_cloud_secret
from .state import state_dir


def _load_cloud_config() -> dict[str, Any]:
    path = state_dir() / "cloud.json"
    if not path.is_file():
        raise RuntimeError(f"Missing Project Relay cloud config: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _device_endpoint(cfg: dict[str, Any]) -> str:
    explicit = str(cfg.get("device_endpoint") or "").strip()
    if explicit:
        return explicit
    project_url = str(cfg.get("project_url") or "").rstrip("/")
    if not project_url:
        raise RuntimeError("Project Relay cloud config has no project_url")
    return project_url + "/functions/v1/project-relay-device"


def request_pairing_code() -> dict[str, Any]:
    cfg = _load_cloud_config()
    token = load_cloud_secret("device")
    body = json.dumps({"action": "pairing_code"}).encode("utf-8")
    req = urllib.request.Request(
        _device_endpoint(cfg),
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Relay-Device-Id": str(cfg["device_id"]),
            "Content-Type": "application/json",
            "User-Agent": "ProjectRelay/0.3.1",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "Could not create pairing code")
    return payload


def main() -> int:
    result = request_pairing_code()
    print(f"Project Relay pairing code: {result['code']}")
    print(f"Workstation: {result['device']}")
    print(f"Expires: {result['expires_at']}")
    if result.get("account_url"):
        print(f"Account: {result['account_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
