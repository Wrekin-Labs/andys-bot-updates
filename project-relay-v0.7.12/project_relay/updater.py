from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import zipfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from . import __version__
from .cloud_credentials import load_cloud_secret
from .state import state_dir

DEFAULT_RELEASE_ENDPOINT = (
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-release"
)


def _version_tuple(value: str) -> tuple[int, ...]:
    parts = []
    for piece in value.strip().split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts)


def is_newer(candidate: str, current: str = __version__) -> bool:
    a = list(_version_tuple(candidate))
    b = list(_version_tuple(current))
    size = max(len(a), len(b))
    a.extend([0] * (size - len(a)))
    b.extend([0] * (size - len(b)))
    return tuple(a) > tuple(b)


def get_release(
    *,
    channel: str = "beta",
    endpoint: str = DEFAULT_RELEASE_ENDPOINT,
) -> dict[str, Any] | None:
    channel = channel.lower().strip()
    if channel not in {"beta", "stable"}:
        raise ValueError("Release channel must be beta or stable")
    url = endpoint + "?channel=" + channel
    req = urllib.request.Request(
        url,
        headers={"User-Agent": f"ProjectRelayUpdater/{__version__}"},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "Release lookup failed")
    release = payload.get("release")
    return release if isinstance(release, dict) else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_private_download(url: str, expected_sha256: str) -> str:
    if "/functions/v1/project-relay-release-download" not in url:
        return url

    cfg_path = state_dir() / "cloud.json"
    if not cfg_path.is_file():
        raise RuntimeError("Project Relay cloud config is missing")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    device_id = str(cfg.get("device_id") or "").strip()
    if not device_id:
        raise RuntimeError("Project Relay device id is missing")

    token = load_cloud_secret("device")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Relay-Device-Id": device_id,
            "Accept": "application/json",
            "User-Agent": f"ProjectRelayUpdater/{__version__}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "Release authorization failed")

    broker_sha = str(payload.get("sha256") or "").lower().strip()
    if broker_sha and broker_sha != expected_sha256:
        raise RuntimeError(
            f"Release broker checksum mismatch: expected {expected_sha256}, got {broker_sha}"
        )
    signed = str(payload.get("download_url") or "").strip()
    if not signed:
        raise RuntimeError("Release broker returned no signed download URL")
    return signed


def download_release(
    release: dict[str, Any],
    destination: Path,
) -> Path:
    url = str(release.get("download_url") or "").strip()
    expected = str(release.get("sha256") or "").lower().strip()
    if not url:
        raise RuntimeError("This release has no download URL yet")
    if len(expected) != 64:
        raise RuntimeError("Release manifest has no valid SHA-256 checksum")

    url = _resolve_private_download(url, expected)

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(destination.suffix + ".part")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": f"ProjectRelayUpdater/{__version__}"},
    )
    with urllib.request.urlopen(req, timeout=120) as response, temp.open("wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    actual = sha256_file(temp)
    if actual.lower() != expected:
        temp.unlink(missing_ok=True)
        raise RuntimeError(
            f"Release checksum mismatch: expected {expected}, got {actual}"
        )
    temp.replace(destination)
    return destination



_REQUIRED_ARCHIVE_FILES = {
    "pyproject.toml",
    "project_relay/__init__.py",
    "scripts/install-windows.ps1",
}


def _default_install_root() -> Path:
    if os.name == "nt":
        return Path(os.getenv("LOCALAPPDATA", Path.home())) / "ProjectRelay" / "App"
    return Path.home() / ".local" / "share" / "project-relay" / "app"


def validate_release_archive(path: Path) -> list[str]:
    """Reject unsafe ZIP paths/symlinks and verify the minimum Relay payload."""
    names: list[str] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            name = info.filename.replace("\\", "/")
            parts = tuple(part for part in name.split("/") if part not in {"", "."})
            if name.startswith("/") or ".." in parts:
                raise RuntimeError(f"Unsafe path in release archive: {info.filename}")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise RuntimeError(f"Symlink is not allowed in release archive: {info.filename}")
            names.append("/".join(parts))
    missing = sorted(_REQUIRED_ARCHIVE_FILES.difference(names))
    if missing:
        raise RuntimeError("Release archive is incomplete: " + ", ".join(missing))
    return names


def _apply_update_script() -> str:
    return r'''param(
    [Parameter(Mandatory=$true)][string]$ZipPath,
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][int]$ParentPid,
    [Parameter(Mandatory=$true)][string]$StateRoot
)
$ErrorActionPreference = "Stop"
$updates = Join-Path $StateRoot "updates"
New-Item -ItemType Directory -Force -Path $updates | Out-Null
$log = Join-Path $updates "update.log"

function Log([string]$Message) {
    $line = "$(Get-Date -Format s) $Message"
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}

$stage = Join-Path $env:TEMP ("ProjectRelayUpdate-" + [guid]::NewGuid().ToString("N"))
$backup = Join-Path $StateRoot ("rollback\" + (Get-Date -Format "yyyyMMdd-HHmmss"))

try {
    Log "Waiting for Project Relay process $ParentPid to exit"
    if ($ParentPid -gt 0) {
        Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage -Force
    foreach ($required in @("pyproject.toml","project_relay\__init__.py","scripts\install-windows.ps1")) {
        if (-not (Test-Path (Join-Path $stage $required))) {
            throw "Update payload is missing $required"
        }
    }

    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    foreach ($item in @("project_relay","scripts","pyproject.toml","README.md","ARCHITECTURE.md","MCP_TOOL_CONTRACT.json","Install Project Relay.cmd")) {
        $src = Join-Path $InstallRoot $item
        if (Test-Path $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $backup $item) -Recurse -Force
        }
    }

    $venvPython = Join-Path $InstallRoot ".venv\Scripts\python.exe"
    $venvPythonw = Join-Path $InstallRoot ".venv\Scripts\pythonw.exe"
    $relayExecutables = @($venvPython, $venvPythonw) |
        ForEach-Object { [System.IO.Path]::GetFullPath($_).ToLowerInvariant() }

    Get-CimInstance Win32_Process |
        Where-Object {
            $exe = if ($_.ExecutablePath) {
                [System.IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant()
            } else {
                ""
            }
            $relayExecutables -contains $exe -and
            $_.CommandLine -match "project_relay\.(supabase_agent|mcp_server|gui)"
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    foreach ($dir in @("project_relay","scripts")) {
        $dst = Join-Path $InstallRoot $dir
        if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $stage $dir) -Destination $dst -Recurse -Force
    }

    foreach ($name in @("pyproject.toml","README.md","ARCHITECTURE.md","MCP_TOOL_CONTRACT.json","Install Project Relay.cmd")) {
        $src = Join-Path $stage $name
        if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $InstallRoot $name) -Force }
    }
    Get-ChildItem -LiteralPath $stage -Filter "RELEASE_NOTES_*.md" -File |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $InstallRoot $_.Name) -Force }

    $python = Join-Path $InstallRoot ".venv\Scripts\python.exe"
    $pythonw = Join-Path $InstallRoot ".venv\Scripts\pythonw.exe"
    if (-not (Test-Path $python)) { throw "Project Relay virtual environment is missing" }

    & $python -m pip install $InstallRoot --quiet
    if ($LASTEXITCODE -ne 0) { throw "pip install returned exit code $LASTEXITCODE" }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-mcp.ps1")
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-cloud-agent.ps1")
    if (Test-Path $pythonw) {
        Start-Process -FilePath $pythonw -ArgumentList "-m","project_relay.gui" -WorkingDirectory $InstallRoot
    }
    Log "Update completed successfully"
}
catch {
    Log ("Update failed: " + $_.Exception.Message)
    try {
        foreach ($dir in @("project_relay","scripts")) {
            $src = Join-Path $backup $dir
            if (Test-Path $src) {
                $dst = Join-Path $InstallRoot $dir
                if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
                Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
            }
        }
        foreach ($name in @("pyproject.toml","README.md","ARCHITECTURE.md","MCP_TOOL_CONTRACT.json","Install Project Relay.cmd")) {
            $src = Join-Path $backup $name
            if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $InstallRoot $name) -Force }
        }
        $python = Join-Path $InstallRoot ".venv\Scripts\python.exe"
        if (Test-Path $python) {
            & $python -m pip install $InstallRoot --quiet
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-mcp.ps1")
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "scripts\ensure-cloud-agent.ps1")
            $pythonw = Join-Path $InstallRoot ".venv\Scripts\pythonw.exe"
            if (Test-Path $pythonw) {
                Start-Process -FilePath $pythonw -ArgumentList "-m","project_relay.gui" -WorkingDirectory $InstallRoot
            }
        }
        Log "Rollback completed"
    }
    catch {
        Log ("Rollback failed: " + $_.Exception.Message)
    }
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
'''


def prepare_self_update(
    release: dict[str, Any],
    *,
    install_root: Path | None = None,
    parent_pid: int | None = None,
) -> Path:
    if os.name != "nt":
        raise RuntimeError("Automatic self-update is currently supported on Windows only")

    version = str(release.get("version") or "").strip()
    if not version:
        raise RuntimeError("Release manifest has no version")

    root = Path(install_root) if install_root else _default_install_root()
    if not (root / "pyproject.toml").is_file():
        raise RuntimeError(f"Project Relay install root was not found: {root}")

    updates = state_dir() / "updates"
    updates.mkdir(parents=True, exist_ok=True)
    archive = updates / f"ProjectRelay-v{version}.zip"
    download_release(release, archive)
    validate_release_archive(archive)

    script = updates / "apply-update.ps1"
    script.write_text(_apply_update_script(), encoding="utf-8")

    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
        subprocess, "CREATE_NO_WINDOW", 0
    )
    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-ZipPath",
            str(archive),
            "-InstallRoot",
            str(root),
            "-ParentPid",
            str(parent_pid or os.getpid()),
            "-StateRoot",
            str(state_dir()),
        ],
        cwd=str(root),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )
    return archive

def main() -> int:
    parser = argparse.ArgumentParser(description="Check Project Relay releases")
    parser.add_argument("--channel", choices=["beta", "stable"], default="beta")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--install", action="store_true", help="Download, verify and apply the update on Windows")
    parser.add_argument(
        "--destination",
        default=str(Path.home() / "Downloads" / "ProjectRelay-update.zip"),
    )
    args = parser.parse_args()

    release = get_release(channel=args.channel)
    if not release:
        print(f"No published {args.channel} release.")
        return 0

    version = str(release.get("version") or "")
    print(f"Current version: {__version__}")
    print(f"Latest {args.channel}: {version}")
    print(f"Channel: {release.get('channel')}")
    print(f"SHA-256: {release.get('sha256')}")
    print(f"Notes: {release.get('notes') or ''}")
    if is_newer(version):
        print("Update available: yes")
    elif version == __version__:
        print("Update available: no — already current")
    else:
        print("Update available: no")

    if args.install:
        if not is_newer(version):
            print("Nothing to install.")
            return 0
        path = prepare_self_update(release)
        print(f"Verified update staged: {path}")
        print("Project Relay will apply the update after this process exits.")
    elif args.download:
        path = download_release(release, Path(args.destination))
        print(f"Verified download: {path}")
    elif not release.get("download_url"):
        print("Download not published yet.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
