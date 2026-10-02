from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path
from typing import Any

from . import __version__
from .cloud_credentials import load_cloud_secret
from .updater import sha256_file

DEFAULT_RELEASE_ADMIN_ENDPOINT = (
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-release-admin"
)


def upload_release(
    path: Path,
    *,
    version: str = __version__,
    channel: str = "beta",
    endpoint: str = DEFAULT_RELEASE_ADMIN_ENDPOINT,
) -> dict[str, Any]:
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    if channel not in {"beta", "stable"}:
        raise ValueError("Release channel must be beta or stable")

    checksum = sha256_file(path)
    token = load_cloud_secret("controller")
    req = urllib.request.Request(
        endpoint,
        data=path.read_bytes(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/zip",
            "X-Release-Version": version,
            "X-Release-Channel": channel,
            "X-Release-Sha256": checksum,
            "X-Release-Filename": path.name,
            "User-Agent": f"ProjectRelayReleaseAdmin/{__version__}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "Release upload failed")
    if str(payload.get("sha256") or "").lower() != checksum.lower():
        raise RuntimeError("Release server returned a different checksum")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload a verified Project Relay release")
    parser.add_argument("file", type=Path)
    parser.add_argument("--version", default=__version__)
    parser.add_argument("--channel", choices=["beta", "stable"], default="beta")
    args = parser.parse_args()

    result = upload_release(
        args.file,
        version=args.version,
        channel=args.channel,
    )
    print(f"Uploaded: {result['version']} ({result['channel']})")
    print(f"Size: {result['size_bytes']} bytes")
    print(f"SHA-256: {result['sha256']}")
    print(f"Download broker: {result['download_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
