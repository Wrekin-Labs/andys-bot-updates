from __future__ import annotations

import subprocess
from typing import Any

from .owner_full_control import require_enabled


def _winget(args: list[str], timeout: int = 300) -> dict[str, Any]:
    require_enabled()
    proc = subprocess.run(
        ["winget.exe", *args], capture_output=True, text=True,
        timeout=max(10, min(int(timeout), 600)), check=False,
    )
    return {
        "returncode": proc.returncode,
        "stdout": proc.stdout[-12000:],
        "stderr": proc.stderr[-12000:],
    }


def install(package_id: str) -> dict[str, Any]:
    if not package_id or len(package_id) > 200: raise ValueError("invalid package id")
    return _winget(["install","--id",package_id,"-e","--accept-package-agreements","--accept-source-agreements","--silent"])


def uninstall(package_id: str) -> dict[str, Any]:
    if not package_id or len(package_id) > 200: raise ValueError("invalid package id")
    return _winget(["uninstall","--id",package_id,"-e","--silent"])


def upgrade(package_id: str) -> dict[str, Any]:
    if not package_id or len(package_id) > 200: raise ValueError("invalid package id")
    return _winget(["upgrade","--id",package_id,"-e","--accept-package-agreements","--accept-source-agreements","--silent"])


def list_installed() -> dict[str, Any]:
    return _winget(["list"], timeout=120)


def search(query: str) -> dict[str, Any]:
    value = str(query or "").strip()
    if not value or len(value) > 200:
        raise ValueError("invalid search query")
    return _winget(["search", value, "--accept-source-agreements"], timeout=120)
