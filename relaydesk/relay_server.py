from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

HOST = os.environ.get("RELAYDESK_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", os.environ.get("RELAYDESK_PORT", "8765")))
SESSION_TTL_SECONDS = int(os.environ.get("RELAYDESK_SESSION_TTL", "600"))
MAX_PACKET_BYTES = int(os.environ.get("RELAYDESK_MAX_PACKET", str(4 * 1024 * 1024)))
JOIN_WINDOW_SECONDS = int(os.environ.get("RELAYDESK_JOIN_WINDOW", "60"))
MAX_FAILED_JOINS_PER_WINDOW = int(os.environ.get("RELAYDESK_MAX_FAILED_JOINS", "8"))


@dataclass
class Session:
    session_id: str
    join_verifier: str
    host: ServerConnection
    host_name: str
    host_public_key: str
    created_at: float
    viewer: ServerConnection | None = None
    viewer_ready: asyncio.Event = field(default_factory=asyncio.Event)


SESSIONS: dict[str, Session] = {}
LOCK = asyncio.Lock()
FAILED_JOINS: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(ws: ServerConnection) -> str:
    remote = getattr(ws, "remote_address", None)
    if isinstance(remote, tuple) and remote:
        return str(remote[0])
    return "unknown"


def _prune_failures(ip: str, now: float) -> deque[float]:
    bucket = FAILED_JOINS[ip]
    cutoff = now - JOIN_WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if not bucket:
        FAILED_JOINS.pop(ip, None)
        bucket = FAILED_JOINS[ip]
    return bucket


def _join_allowed(ip: str, now: float) -> bool:
    return len(_prune_failures(ip, now)) < MAX_FAILED_JOINS_PER_WINDOW


def _record_join_failure(ip: str, now: float) -> None:
    _prune_failures(ip, now).append(now)


def _valid_hello(data: Any) -> bool:
    if not isinstance(data, dict) or data.get("type") != "hello":
        return False
    if data.get("role") not in {"host", "viewer"}:
        return False
    sid = data.get("session_id")
    verifier = data.get("join_verifier")
    public_key = data.get("public_key")
    name = data.get("device_name")
    if not (isinstance(sid, str) and len(sid) == 6 and sid.isdigit()):
        return False
    if not (isinstance(verifier, str) and 32 <= len(verifier) <= 128):
        return False
    if not (isinstance(public_key, str) and 40 <= len(public_key) <= 80):
        return False
    if not (isinstance(name, str) and 1 <= len(name) <= 240):
        return False
    requested = data.get("requested_permissions", ["view", "control"])
    if data.get("role") == "viewer":
        if not isinstance(requested, list):
            return False
        allowed = {"view", "control"}
        if not requested or "view" not in requested or any(p not in allowed for p in requested):
            return False
    return True


async def _send_json(ws: ServerConnection, value: dict[str, Any]) -> None:
    await ws.send(json.dumps(value, separators=(",", ":")))


async def _register_host(ws: ServerConnection, hello: dict[str, Any]) -> Session:
    sid = hello["session_id"]
    async with LOCK:
        existing = SESSIONS.get(sid)
        if existing and time.time() - existing.created_at < SESSION_TTL_SECONDS:
            raise ValueError("session id already active")
        session = Session(
            session_id=sid,
            join_verifier=hello["join_verifier"],
            host=ws,
            host_name=hello["device_name"][:120],
            host_public_key=hello["public_key"],
            created_at=time.time(),
        )
        SESSIONS[sid] = session
    return session


async def _join_viewer(ws: ServerConnection, hello: dict[str, Any]) -> Session:
    ip = _client_ip(ws)
    now = time.time()
    if not _join_allowed(ip, now):
        raise ValueError("too many failed join attempts; try again later")

    sid = hello["session_id"]
    async with LOCK:
        session = SESSIONS.get(sid)
        if not session:
            _record_join_failure(ip, now)
            raise ValueError("session not found")
        if now - session.created_at > SESSION_TTL_SECONDS:
            SESSIONS.pop(sid, None)
            _record_join_failure(ip, now)
            raise ValueError("session expired")
        if not secrets.compare_digest(session.join_verifier, hello["join_verifier"]):
            _record_join_failure(ip, now)
            raise ValueError("invalid invite")
        if session.viewer is not None:
            raise ValueError("session already has a viewer")
        session.viewer = ws
        session.viewer_ready.set()

    await _send_json(
        session.host,
        {
            "type": "peer_hello",
            "role": "viewer",
            "device_name": hello["device_name"][:120],
            "public_key": hello["public_key"],
            "requested_permissions": hello.get("requested_permissions", ["view", "control"]),
        },
    )
    await _send_json(
        ws,
        {
            "type": "host_hello",
            "device_name": session.host_name,
            "public_key": session.host_public_key,
        },
    )
    return session


async def _relay(source: ServerConnection, target: ServerConnection) -> None:
    async for message in source:
        if isinstance(message, bytes) and len(message) > MAX_PACKET_BYTES:
            await source.close(code=1009, reason="packet too large")
            return
        if isinstance(message, str) and len(message.encode("utf-8")) > 16 * 1024:
            await source.close(code=1009, reason="control message too large")
            return
        await target.send(message)


async def handler(ws: ServerConnection) -> None:
    session: Session | None = None
    role = ""
    try:
        first = await asyncio.wait_for(ws.recv(), timeout=12)
        if not isinstance(first, str):
            raise ValueError("hello must be JSON text")
        hello = json.loads(first)
        if not _valid_hello(hello):
            raise ValueError("invalid hello")
        role = hello["role"]
        if role == "host":
            session = await _register_host(ws, hello)
            await _send_json(ws, {"type": "host_ready", "session_id": session.session_id})
            viewer_task = asyncio.create_task(session.viewer_ready.wait())
            closed_task = asyncio.create_task(ws.wait_closed())
            done, pending = await asyncio.wait(
                [viewer_task, closed_task], return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if closed_task in done or session.viewer is None:
                return
            await _relay(ws, session.viewer)
            return
        else:
            session = await _join_viewer(ws, hello)
            await _relay(ws, session.host)
    except (ValueError, json.JSONDecodeError) as exc:
        try:
            await _send_json(ws, {"type": "error", "message": str(exc)})
            await ws.close(code=1008, reason="policy")
        except ConnectionClosed:
            pass
    except (ConnectionClosed, asyncio.TimeoutError):
        pass
    finally:
        if session:
            async with LOCK:
                current = SESSIONS.get(session.session_id)
                if current is session:
                    if role == "host" or current.viewer is ws:
                        SESSIONS.pop(session.session_id, None)


async def main() -> None:
    print(f"RelayDesk v0.2 relay listening on {HOST}:{PORT}")
    async with serve(
        handler,
        HOST,
        PORT,
        max_size=MAX_PACKET_BYTES,
        ping_interval=20,
        ping_timeout=20,
        compression=None,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
