from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .models import Device


def _powershell_json(script: str) -> list[dict[str, Any]]:
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "PowerShell command failed")
    raw = proc.stdout.strip()
    if not raw:
        return []
    value = json.loads(raw)
    return value if isinstance(value, list) else [value]


def list_printers() -> list[Device]:
    rows = _powershell_json(
        "Get-Printer | Select-Object Name,PrinterStatus,DriverName,PortName | ConvertTo-Json -Compress"
    )
    return [
        Device(
            device_id=f"printer:{r['Name']}",
            name=r["Name"],
            kind="printer",
            status=str(r.get("PrinterStatus", "unknown")),
            metadata={"driver": r.get("DriverName"), "port": r.get("PortName")},
        )
        for r in rows
    ]


def list_scanners() -> list[Device]:
    rows = _powershell_json(
        "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'Image' } | "
        "Select-Object InstanceId,FriendlyName,Status | ConvertTo-Json -Compress"
    )
    return [
        Device(
            device_id=f"scanner:{r['InstanceId']}",
            name=r.get("FriendlyName") or "Scanner",
            kind="scanner",
            status=str(r.get("Status", "unknown")),
        )
        for r in rows
    ]


def list_serial_ports() -> list[Device]:
    rows = _powershell_json(
        "Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Status,PNPDeviceID | ConvertTo-Json -Compress"
    )
    return [
        Device(
            device_id=f"serial:{r['DeviceID']}",
            name=r.get("Name") or r["DeviceID"],
            kind="serial",
            status=str(r.get("Status", "unknown")),
            metadata={"port": r.get("DeviceID"), "pnp_id": r.get("PNPDeviceID")},
        )
        for r in rows
    ]


def list_usb_storage() -> list[Device]:
    rows = _powershell_json(
        "Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' } | "
        "Select-Object Model,MediaType,Size,PNPDeviceID | ConvertTo-Json -Compress"
    )
    return [
        Device(
            device_id=f"storage:{r['PNPDeviceID']}",
            name=r.get("Model") or "USB storage",
            kind="storage",
            status="available",
            metadata={"media_type": r.get("MediaType"), "size_bytes": r.get("Size")},
        )
        for r in rows
    ]


def list_audio_midi() -> list[Device]:
    rows = _powershell_json(
        "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB*' -and "
        "($_.Class -eq 'MEDIA' -or $_.Class -like '*Audio*' -or $_.Class -like '*midi*') } | "
        "Select-Object Class,FriendlyName,InstanceId,Status | ConvertTo-Json -Compress"
    )
    devices = []
    for r in rows:
        name = r.get("FriendlyName") or "USB audio/MIDI device"
        kind = "midi" if "midi" in str(r.get("Class", "")).lower() or "essential" in name.lower() else "audio"
        devices.append(Device(
            device_id=f"{kind}:{r['InstanceId']}",
            name=name,
            kind=kind,
            status=str(r.get("Status", "unknown")),
            metadata={"pnp_class": r.get("Class")},
        ))
    return devices


def list_usb_peripherals() -> list[Device]:
    rows = _powershell_json(
        "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -and $_.InstanceId -like 'USB*' } | "
        "Select-Object InstanceId,FriendlyName,Status | ConvertTo-Json -Compress"
    )
    ignored_fragments = ("usb root hub", "generic usb hub", "usb mass storage")
    out = []
    for r in rows:
        label = r.get("BusDescription") or r.get("FriendlyName") or "USB device"
        friendly = str(r.get("FriendlyName") or "")
        if any(x in label.lower() or x in friendly.lower() for x in ignored_fragments):
            continue
        out.append(Device(
            device_id=f"usb:{r['InstanceId']}",
            name=label,
            kind="usb",
            status=str(r.get("Status", "unknown")),
            metadata={"friendly_name": r.get("FriendlyName")},
        ))
    return out


def list_network_neighbors() -> list[Device]:
    rows = _powershell_json(
        "Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -in @('Reachable','Stale') "
        "-and $_.IPAddress -match '^192\\.168\\.' } | ForEach-Object { "
        "[PSCustomObject]@{IPAddress=$_.IPAddress;MAC=$_.LinkLayerAddress;State=$_.State.ToString()} } | "
        "ConvertTo-Json -Compress"
    )
    return [
        Device(
            device_id=f"network:{r['IPAddress']}",
            name=r["IPAddress"],
            kind="network",
            status=str(r.get("State", "unknown")),
            metadata={"ip": r.get("IPAddress"), "mac": r.get("MAC")},
        )
        for r in rows
    ]


def discover_devices() -> list[Device]:
    fns = (
        list_printers, list_scanners, list_serial_ports, list_usb_storage,
        list_audio_midi, list_usb_peripherals, list_network_neighbors,
    )

    def run_one(fn):
        try:
            return fn()
        except Exception as exc:
            return [Device(
                device_id=f"error:{fn.__name__}",
                name=fn.__name__,
                kind="error",
                status="error",
                metadata={"error": str(exc)},
            )]

    devices: list[Device] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for group in pool.map(run_one, fns):
            devices.extend(group)
    return devices
