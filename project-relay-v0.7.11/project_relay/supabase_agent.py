from __future__ import annotations

import json
import os
import platform
import socket
import time
import urllib.error
import urllib.request
from typing import Any

from . import __version__
from .auto_update import apply_auto_update
from .bridge_actions import bridge_action_names, execute_bridge_action
from .cloud_credentials import load_cloud_secret
from .owner_full_control import status as owner_full_control_status
from .post_update import confirm_healthy as confirm_post_update_healthy
from .state import atomic_write_json, state_dir

VERSION = __version__
AUTO_UPDATE_CHECK_SECONDS = 60 * 60


def _load() -> tuple[dict[str, Any], str]:
    cfg_path = state_dir() / "cloud.json"
    if not cfg_path.is_file():
        raise RuntimeError(f"Missing Project Relay cloud config: {cfg_path}")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    token = load_cloud_secret("device")
    return cfg, token


def _post(cfg: dict[str, Any], token: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        str(cfg["device_endpoint"]),
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Relay-Device-Id": str(cfg["device_id"]),
            "Content-Type": "application/json",
            "User-Agent": f"ProjectRelay/{VERSION}",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _record_local_heartbeat() -> None:
    """Record only a successful cloud heartbeat, so watchdog health reflects real agent liveness."""
    atomic_write_json(
        state_dir() / "heartbeat.json",
        {"version": VERSION, "recorded_at": time.time()},
    )


def _heartbeat_info() -> dict[str, Any]:
    return {
        "version": VERSION,
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "transport": "supabase-outbound-poll",
        "owner_full_control": bool(owner_full_control_status().get("enabled")),
        "actions": list(bridge_action_names()),
    }


def _handle_task(cfg: dict[str, Any], token: str, task: dict[str, Any]) -> None:
    task_id = str(task.get("id") or "")
    action = str(task.get("action") or "")
    payload = task.get("payload") or {}
    if not task_id:
        return

    if action not in bridge_action_names():
        _post(cfg, token, {
            "action": "result",
            "task_id": task_id,
            "success": False,
            "error": f"Bridge action not allowed: {action}",
        })
        return

    try:
        result = execute_bridge_action(action, payload)
        _post(cfg, token, {
            "action": "result",
            "task_id": task_id,
            "success": True,
            "result": result,
        })
    except Exception as exc:
        _post(cfg, token, {
            "action": "result",
            "task_id": task_id,
            "success": False,
            "error": str(exc)[:4000],
        })



def _confirm_post_update() -> None:
    try:
        confirm_post_update_healthy()
    except Exception:
        # Update health must never prevent the outbound agent from reconnecting.
        pass


def _maybe_start_auto_update() -> bool:
    if os.name != "nt":
        return False
    try:
        result = apply_auto_update()
    except Exception:
        # apply_auto_update records bounded failure/backoff state itself.
        return False
    return bool(result.get("started"))


def run_forever() -> None:
    cfg, token = _load()
    poll_seconds = max(0.5, min(float(cfg.get("poll_seconds", 1.0)), 10.0))
    heartbeat_seconds = max(10.0, min(float(cfg.get("heartbeat_seconds", 30.0)), 300.0))
    # Force one heartbeat and one stable-channel update check on every agent
    # start, regardless of how recently Windows itself booted.
    started_at = time.monotonic()
    last_heartbeat = started_at - heartbeat_seconds
    last_update_check = started_at - AUTO_UPDATE_CHECK_SECONDS
    _confirm_post_update()

    while True:
        try:
            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_seconds:
                _post(cfg, token, {"action": "heartbeat", "info": _heartbeat_info()})
                _record_local_heartbeat()
                last_heartbeat = now

            if now - last_update_check >= AUTO_UPDATE_CHECK_SECONDS:
                last_update_check = now
                if _maybe_start_auto_update():
                    # prepare_self_update waits for this parent process to exit,
                    # then performs verified replacement/rollback and restarts Relay.
                    return

            response = _post(cfg, token, {"action": "poll"})
            task = response.get("task")
            if task:
                _handle_task(cfg, token, task)
            else:
                time.sleep(poll_seconds)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError):
            time.sleep(5)
        except Exception:
            time.sleep(5)


def main() -> int:
    from .single_instance import acquire
    if not acquire():
        return 0
    run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
