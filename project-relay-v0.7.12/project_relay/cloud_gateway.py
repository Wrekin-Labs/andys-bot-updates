from __future__ import annotations

import asyncio
import json
import os
import secrets
from typing import Any

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from .bridge_actions import bridge_action_names
from .pairing import load_or_create_pairing_secret

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False, destructive_hint=False)
CONTROL = ToolAnnotations(read_only_hint=False, open_world_hint=False, destructive_hint=False)

connections: dict[str, WebSocket] = {}
pending: dict[str, asyncio.Future] = {}

mcp = MCPServer(
    "Project Relay Cloud",
    version="0.3.1",
    instructions=(
        "Proxy only the narrow Project Relay action catalogue to paired outbound Windows agents. "
        "Physical or sensitive operations remain subject to the local agent approval policy."
    ),
)


def _pairing_secret() -> str:
    return load_or_create_pairing_secret()


def _target_device(device_id: str | None) -> str:
    if device_id:
        return device_id
    if len(connections) == 1:
        return next(iter(connections))
    if not connections:
        raise RuntimeError("No paired Relay device is online")
    raise RuntimeError("Multiple Relay devices are online; specify device_id")


async def health(_request: Request) -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "version": "0.3.1",
        "devices": sorted(connections),
        "actions": list(bridge_action_names()),
    })


async def agent_socket(websocket: WebSocket) -> None:
    try:
        expected = _pairing_secret()
    except RuntimeError:
        await websocket.close(code=1011)
        return
    if not secrets.compare_digest(websocket.query_params.get("token", ""), expected):
        await websocket.close(code=4401)
        return
    device_id = websocket.path_params["device_id"]
    await websocket.accept()
    connections[device_id] = websocket
    try:
        while True:
            message = json.loads(await websocket.receive_text())
            request_id = message.get("request_id")
            future = pending.pop(request_id, None)
            if future is not None and not future.done():
                future.set_result(message)
    except WebSocketDisconnect:
        pass
    finally:
        if connections.get(device_id) is websocket:
            connections.pop(device_id, None)


async def invoke_device(device_id: str, action: str, args: dict[str, Any] | None = None) -> Any:
    if action not in bridge_action_names():
        raise RuntimeError(f"Bridge action not allowed: {action}")
    websocket = connections.get(device_id)
    if websocket is None:
        raise RuntimeError(f"Relay device is offline: {device_id}")
    request_id = secrets.token_urlsafe(18)
    future = asyncio.get_running_loop().create_future()
    pending[request_id] = future
    await websocket.send_text(json.dumps({
        "request_id": request_id,
        "action": action,
        "args": args or {},
    }))
    try:
        response = await asyncio.wait_for(future, timeout=60)
    except asyncio.TimeoutError as exc:
        pending.pop(request_id, None)
        raise RuntimeError("Relay device timed out") from exc
    if response.get("ok"):
        return response.get("result")
    raise RuntimeError(response.get("error", "Relay device action failed"))


@mcp.tool(annotations=READ_ONLY)
async def relay_devices(device_id: str | None = None) -> dict[str, Any]:
    """List the read-only device inventory on a paired Relay workstation."""
    return await invoke_device(_target_device(device_id), "list_devices")


@mcp.tool(annotations=READ_ONLY)
async def relay_device_status(device_id: str, relay_device_id: str | None = None) -> dict[str, Any]:
    """Read current metadata for one hardware device on a paired Relay workstation."""
    return await invoke_device(_target_device(relay_device_id), "get_device_status", {"device_id": device_id})


@mcp.tool(annotations=READ_ONLY)
async def relay_serial_ports(device_id: str | None = None) -> dict[str, Any]:
    """List serial ports without opening them."""
    return await invoke_device(_target_device(device_id), "list_serial_ports")


@mcp.tool(annotations=CONTROL)
async def relay_prepare_serial_read(
    device_id: str,
    seconds: float = 2.0,
    baudrate: int = 115200,
    max_bytes: int = 4096,
    relay_device_id: str | None = None,
) -> dict[str, Any]:
    """Create a local approval request for a bounded serial read."""
    return await invoke_device(_target_device(relay_device_id), "prepare_serial_read", {
        "device_id": device_id,
        "seconds": seconds,
        "baudrate": baudrate,
        "max_bytes": max_bytes,
    })


@mcp.tool(annotations=CONTROL)
async def relay_read_serial(
    approval_id: str,
    device_id: str,
    seconds: float = 2.0,
    baudrate: int = 115200,
    max_bytes: int = 4096,
    relay_device_id: str | None = None,
) -> dict[str, Any]:
    """Execute a bounded serial read only with an exact locally-approved request."""
    return await invoke_device(_target_device(relay_device_id), "read_serial", {
        "approval_id": approval_id,
        "device_id": device_id,
        "seconds": seconds,
        "baudrate": baudrate,
        "max_bytes": max_bytes,
    })


@mcp.tool(annotations=CONTROL)
async def relay_prepare_scan_preview(device_id: str, relay_device_id: str | None = None) -> dict[str, Any]:
    """Create a local approval request for a low-resolution scanner preview."""
    return await invoke_device(
        _target_device(relay_device_id), "prepare_scan_preview", {"device_id": device_id}
    )


@mcp.tool(annotations=CONTROL)
async def relay_scan_preview(
    approval_id: str, device_id: str, relay_device_id: str | None = None
) -> dict[str, Any]:
    """Reserved scanner action; the local adapter remains disabled until validated."""
    return await invoke_device(_target_device(relay_device_id), "scan_preview", {
        "approval_id": approval_id,
        "device_id": device_id,
    })


@mcp.tool(annotations=CONTROL)
async def relay_prepare_document_print(
    device_id: str,
    file_ref: str,
    copies: int = 1,
    relay_device_id: str | None = None,
) -> dict[str, Any]:
    """Hash and prepare a local print approval without printing."""
    return await invoke_device(_target_device(relay_device_id), "prepare_document_print", {
        "device_id": device_id,
        "file_ref": file_ref,
        "copies": copies,
    })


@mcp.tool(annotations=CONTROL)
async def relay_start_document_print(
    approval_id: str,
    device_id: str,
    file_ref: str,
    copies: int = 1,
    relay_device_id: str | None = None,
) -> dict[str, Any]:
    """Execute only through the local print gate; physical printing is disabled by default."""
    return await invoke_device(_target_device(relay_device_id), "start_document_print", {
        "approval_id": approval_id,
        "device_id": device_id,
        "file_ref": file_ref,
        "copies": copies,
    })


@mcp.tool(annotations=READ_ONLY)
async def relay_pending_approvals(device_id: str | None = None) -> dict[str, Any]:
    """List unexpired local approval requests waiting at the paired workstation."""
    return await invoke_device(_target_device(device_id), "pending_approvals")


security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
)
app = mcp.streamable_http_app(
    streamable_http_path="/mcp",
    json_response=True,
    stateless_http=True,
    transport_security=security,
    host="127.0.0.1",
)
app.router.routes.insert(0, Route("/health", health, methods=["GET"]))
app.router.routes.insert(1, WebSocketRoute("/agent/{device_id}", agent_socket))


def main() -> int:
    import uvicorn

    _pairing_secret()
    host = os.getenv("RELAY_CLOUD_HOST", "127.0.0.1")
    port = int(os.getenv("RELAY_CLOUD_PORT", "8790"))
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError(
            "The v0.3.1 development gateway refuses public binds until a public authentication layer is added."
        )
    uvicorn.run("project_relay.cloud_gateway:app", host=host, port=port, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
