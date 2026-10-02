from __future__ import annotations

from .models import Device


def mock_devices() -> list[Device]:
    return [
        Device(
            "printer:Relay Demo Printer",
            "Relay Demo Printer",
            "printer",
            "Normal",
            {"driver": "Mock Driver", "port": "MOCKPORT", "mock": True},
        ),
        Device(
            "scanner:relay-demo",
            "Relay Demo Scanner",
            "scanner",
            "OK",
            {"mock": True},
        ),
        Device(
            "serial:COM5",
            "Relay Demo Arduino (COM5)",
            "serial",
            "OK",
            {"port": "COM5", "pnp_id": "MOCK\\ARDUINO", "mock": True},
        ),
    ]
