from __future__ import annotations

import asyncio
import json
import os
from urllib.parse import quote

from .bridge_actions import execute_bridge_action
from .pairing import load_or_create_pairing_secret


def _settings() -> tuple[str, str, str]:
    base = os.getenv("RELAY_CLOUD_WS", "").rstrip("/")
    device_id = os.getenv("RELAY_DEVICE_ID", "").strip()
    secret = load_or_create_pairing_secret()
    if not base:
        raise RuntimeError("RELAY_CLOUD_WS is required")
    if not device_id:
        raise RuntimeError("RELAY_DEVICE_ID is required")
    return base, device_id, secret


async def handle_bridge_message(message: str) -> str:
    request = json.loads(message)
    request_id = request.get("request_id")
    action = request.get("action", "")
    args = request.get("args") or {}
    try:
        result = await asyncio.to_thread(execute_bridge_action, action, args)
        return json.dumps({"request_id": request_id, "ok": True, "result": result})
    except Exception as exc:
        return json.dumps({"request_id": request_id, "ok": False, "error": str(exc)})


async def run_bridge() -> None:
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("Install Project Relay dependencies to enable the outbound bridge") from exc

    base, device_id, secret = _settings()
    url = f"{base}/agent/{quote(device_id, safe='')}?token={quote(secret, safe='')}"
    delay = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, max_size=1_000_000) as ws:
                delay = 1
                async for message in ws:
                    await ws.send(await handle_bridge_message(message))
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)


def main() -> int:
    asyncio.run(run_bridge())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
