from __future__ import annotations

import os
import platform

from .models import Device


def discover_devices() -> list[Device]:
    if os.getenv("RELAY_MOCK_DEVICES", "0") == "1":
        from .mock_devices import mock_devices
        return mock_devices()
    if platform.system() != "Windows":
        return [
            Device(
                device_id="host:unsupported",
                name=platform.system() or "Unknown OS",
                kind="host",
                status="unsupported",
                metadata={"message": "Project Relay v0.3.1 device discovery is Windows-first"},
            )
        ]
    from .windows import discover_devices as windows_discover

    return windows_discover()
