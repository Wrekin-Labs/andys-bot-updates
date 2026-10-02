from __future__ import annotations

import argparse
import json
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from . import __version__
from .cloud_credentials import store_cloud_secret
from .state import state_dir

DEFAULT_BOOTSTRAP_ENDPOINT = (
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-bootstrap"
)


def normalize_install_code(value: str) -> str:
    raw = "".join(ch for ch in value.upper() if ch.isalnum())
    if len(raw) != 12:
        raise ValueError("Install code must contain 12 letters/numbers")
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def _existing_device_state(root: Path | None = None) -> bool:
    base = root or state_dir()
    return (base / "cloud.json").exists() or (base / "cloud-device.dpapi").exists()


def redeem_install_code(
    code: str,
    *,
    device_name: str | None = None,
    endpoint: str = DEFAULT_BOOTSTRAP_ENDPOINT,
    force: bool = False,
    root: Path | None = None,
) -> dict[str, Any]:
    base = root or state_dir()
    if _existing_device_state(base) and not force:
        raise RuntimeError(
            "Project Relay is already enrolled on this Windows account. "
            "Use force only when intentionally replacing that enrollment."
        )

    formatted = normalize_install_code(code)
    payload = {
        "action": "redeem_install_code",
        "code": formatted,
        "device_name": (device_name or socket.gethostname()).strip() or "Project Relay PC",
        "version": __version__,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": f"ProjectRelayInstaller/{__version__}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("error")
        except Exception:
            message = None
        raise RuntimeError(message or f"Bootstrap failed with HTTP {exc.code}") from exc

    if not result.get("ok"):
        raise RuntimeError(result.get("error") or "Project Relay bootstrap failed")

    device = result.get("device") or {}
    config = dict(result.get("config") or {})
    device_id = str(device.get("id") or "")
    device_token = str(device.get("token") or "")
    if not device_id or not device_token or not config.get("device_endpoint"):
        raise RuntimeError("Bootstrap response was incomplete")

    base.mkdir(parents=True, exist_ok=True)
    config["device_id"] = device_id
    config["device_name"] = str(device.get("name") or payload["device_name"])
    (base / "cloud.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    store_cloud_secret("device", device_token, base)

    return {
        "ok": True,
        "device_id": device_id,
        "device_name": config["device_name"],
        "account_url": config.get("account_url"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Enroll this Windows account with Project Relay")
    parser.add_argument("--code", help="12-character install code, e.g. ABCD-EFGH-JKLM")
    parser.add_argument("--device-name", default=socket.gethostname())
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    code = args.code or input("Project Relay install code: ").strip()
    result = redeem_install_code(
        code,
        device_name=args.device_name,
        force=args.force,
    )
    print(f"Enrolled workstation: {result['device_name']}")
    print(f"Device ID: {result['device_id']}")
    if result.get("account_url"):
        print(f"Account: {result['account_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
