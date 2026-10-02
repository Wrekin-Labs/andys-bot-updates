from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .owner_full_control import require_enabled

MAX_EVENTS = 250
MAX_MESSAGE = 2500


def _powershell(script: str, args: list[str] | None = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    if os.name != "nt":
        raise RuntimeError("Windows diagnostics require Windows")
    return subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script, *(args or [])],
        capture_output=True,
        text=True,
        timeout=max(5, min(int(timeout), 120)),
        check=False,
    )


def owner_system_snapshot() -> dict[str, Any]:
    require_enabled()
    home = Path.home()
    disk = shutil.disk_usage(home)
    result: dict[str, Any] = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count": os.cpu_count(),
        "home_disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
        },
    }
    if os.name == "nt":
        script = (
            "$o=Get-CimInstance Win32_OperatingSystem;"
            "$c=Get-CimInstance Win32_ComputerSystem;"
            "[pscustomobject]@{"
            "Caption=$o.Caption;Version=$o.Version;BuildNumber=$o.BuildNumber;"
            "LastBootUpTime=$o.LastBootUpTime;"
            "TotalVisibleMemorySize=$o.TotalVisibleMemorySize;"
            "FreePhysicalMemory=$o.FreePhysicalMemory;"
            "Manufacturer=$c.Manufacturer;Model=$c.Model"
            "}|ConvertTo-Json -Compress"
        )
        proc = _powershell(script)
        if proc.returncode == 0 and proc.stdout.strip():
            try:
                result["windows"] = json.loads(proc.stdout)
            except json.JSONDecodeError:
                result["windows"] = {"available": False}
    return result


def owner_network_summary() -> dict[str, Any]:
    require_enabled()
    if os.name != "nt":
        raise RuntimeError("Network summary currently requires Windows")
    script = (
        "Get-NetIPConfiguration | ForEach-Object {"
        "[pscustomobject]@{"
        "InterfaceAlias=$_.InterfaceAlias;"
        "InterfaceDescription=$_.InterfaceDescription;"
        "IPv4=@($_.IPv4Address|ForEach-Object{$_.IPAddress});"
        "IPv6=@($_.IPv6Address|ForEach-Object{$_.IPAddress});"
        "Gateway=@($_.IPv4DefaultGateway|ForEach-Object{$_.NextHop});"
        "Dns=@($_.DNSServer.ServerAddresses)"
        "}}|ConvertTo-Json -Compress"
    )
    proc = _powershell(script)
    if proc.returncode:
        raise RuntimeError("network inspection failed")
    raw = proc.stdout.strip()
    value = [] if not raw else json.loads(raw)
    if isinstance(value, dict):
        value = [value]
    return {"count": len(value), "interfaces": value}


def owner_query_event_log(
    log_name: str = "System",
    minutes: int = 60,
    max_events: int = 100,
    level: str | None = None,
) -> dict[str, Any]:
    require_enabled()
    if os.name != "nt":
        raise RuntimeError("Event Log queries require Windows")
    name = str(log_name or "").strip()
    if not name or len(name) > 128 or any(ord(ch) < 32 for ch in name):
        raise ValueError("invalid log name")
    period = max(1, min(int(minutes), 7 * 24 * 60))
    limit = max(1, min(int(max_events), MAX_EVENTS))
    selected_level = str(level or "").strip().casefold()
    levels = {
        "critical": 1,
        "error": 2,
        "warning": 3,
        "information": 4,
        "verbose": 5,
    }
    if selected_level and selected_level not in levels:
        raise ValueError("level must be critical, error, warning, information or verbose")

    script = (
        "& { param($relayLogName,$relayMinutes,$relayLevel,$relayMax) "
        "$filter=@{LogName=$relayLogName;StartTime=(Get-Date).AddMinutes(-[int]$relayMinutes)};"
        "if($relayLevel){$filter.Level=[int]$relayLevel};"
        "$n=[int]$relayMax;"
        "Get-WinEvent -FilterHashtable $filter -ErrorAction Stop | Select-Object -First $n "
        "TimeCreated,Id,LevelDisplayName,ProviderName,Message | ConvertTo-Json -Compress -Depth 3 }"
    )
    level_id = str(levels[selected_level]) if selected_level else ""
    proc = _powershell(script, [name, str(period), level_id, str(limit)], timeout=45)
    if proc.returncode:
        message = proc.stderr.strip()
        if "No events were found" in message:
            return {"log_name": name, "count": 0, "events": []}
        raise RuntimeError("event log query failed")
    raw = proc.stdout.strip()
    rows = [] if not raw else json.loads(raw)
    if isinstance(rows, dict):
        rows = [rows]
    events = []
    for row in rows:
        message = str(row.get("Message") or "")
        if len(message) > MAX_MESSAGE:
            message = message[:MAX_MESSAGE] + "…"
        events.append({
            "time": row.get("TimeCreated"),
            "id": row.get("Id"),
            "level": row.get("LevelDisplayName"),
            "provider": row.get("ProviderName"),
            "message": message,
        })
    return {
        "log_name": name,
        "minutes": period,
        "level": selected_level or None,
        "count": len(events),
        "events": events,
    }
