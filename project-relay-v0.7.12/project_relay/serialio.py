from __future__ import annotations

from typing import Any

from .approvals import ApprovalStore
from .discovery import discover_devices


def _serial_device(device_id: str):
    for device in discover_devices():
        if device.device_id == device_id and device.kind == "serial":
            return device
    raise KeyError(f"Unknown serial device_id: {device_id}")


def _validate(seconds: float, baudrate: int, max_bytes: int) -> None:
    if not 0.1 <= seconds <= 5.0:
        raise ValueError("seconds must be between 0.1 and 5.0")
    if baudrate not in {9600, 19200, 38400, 57600, 115200, 230400}:
        raise ValueError("unsupported prototype baudrate")
    if not 1 <= max_bytes <= 16384:
        raise ValueError("max_bytes must be between 1 and 16384")


def prepare_serial_read(device_id: str, seconds: float = 2.0, baudrate: int = 115200, max_bytes: int = 4096, store: ApprovalStore | None = None) -> dict[str, Any]:
    _validate(seconds, baudrate, max_bytes)
    device = _serial_device(device_id)
    arguments = {"seconds": seconds, "baudrate": baudrate, "max_bytes": max_bytes}
    approval = (store or ApprovalStore()).create(
        "read_serial", device_id, arguments, f"Read {device.name} for up to {seconds:g} seconds", ttl_seconds=300
    )
    return {
        "device": device.to_dict(),
        "seconds": seconds,
        "baudrate": baudrate,
        "max_bytes": max_bytes,
        "approval_id": approval.approval_id,
        "approval_expires_at": approval.expires_at,
        "executed": False,
    }


def read_serial(approval_id: str, device_id: str, seconds: float = 2.0, baudrate: int = 115200, max_bytes: int = 4096, store: ApprovalStore | None = None) -> dict[str, Any]:
    _validate(seconds, baudrate, max_bytes)
    device = _serial_device(device_id)
    port = device.metadata.get("port")
    if not port:
        raise ValueError("serial device has no port metadata")
    arguments = {"seconds": seconds, "baudrate": baudrate, "max_bytes": max_bytes}
    (store or ApprovalStore()).consume(
        approval_id, action="read_serial", device_id=device_id, arguments=arguments
    )
    try:
        import serial
    except ImportError as exc:
        raise RuntimeError("pyserial is required for bounded serial reads") from exc

    # Opening some development boards can reset them; DTR/RTS are explicitly disabled.
    with serial.Serial(port=port, baudrate=baudrate, timeout=0.1, dsrdtr=False, rtscts=False) as ser:
        ser.dtr = False
        ser.rts = False
        import time
        deadline = time.monotonic() + seconds
        data = bytearray()
        while time.monotonic() < deadline and len(data) < max_bytes:
            chunk = ser.read(min(256, max_bytes - len(data)))
            if chunk:
                data.extend(chunk)
    return {
        "device_id": device_id,
        "port": port,
        "seconds": seconds,
        "baudrate": baudrate,
        "bytes": len(data),
        "text": bytes(data).decode("utf-8", errors="replace"),
        "truncated": len(data) >= max_bytes,
    }
