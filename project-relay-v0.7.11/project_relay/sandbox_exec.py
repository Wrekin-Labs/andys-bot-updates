from __future__ import annotations

import shutil
import subprocess
from typing import Any

from .owner_full_control import require_enabled

IMAGES = {
    "python": "python:3.12-alpine",
    "node": "node:22-alpine",
}
MAX_CODE_CHARS = 200_000
MAX_OUTPUT_CHARS = 128_000


def _docker() -> str:
    path = shutil.which("docker")
    if not path:
        raise RuntimeError("Docker is not installed or not on PATH")
    return path


def owner_sandbox_status() -> dict[str, Any]:
    require_enabled()
    docker = shutil.which("docker")
    if not docker:
        return {
            "docker_available": False,
            "images": {language: False for language in IMAGES},
            "network": "disabled for sandbox runs",
            "mounts": "none",
            "limits": {"memory": "256m", "cpus": "1", "pids": 64, "tmpfs": "64m"},
            "reason": "Docker is not installed or not on PATH",
        }
    available: dict[str, bool] = {}
    for language, image in IMAGES.items():
        result = subprocess.run(
            [docker, "image", "inspect", image],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        available[language] = result.returncode == 0
    return {
        "docker_available": True,
        "images": available,
        "network": "disabled for sandbox runs",
        "mounts": "none",
        "limits": {"memory": "256m", "cpus": "1", "pids": 64, "tmpfs": "64m"},
    }


def owner_sandbox_run(
    language: str,
    code: str,
    timeout_seconds: int = 60,
) -> dict[str, Any]:
    require_enabled()
    selected = str(language or "").lower().strip()
    if selected not in IMAGES:
        raise ValueError("language must be python or node")
    source = str(code)
    if not source or len(source) > MAX_CODE_CHARS:
        raise ValueError("code is empty or exceeds sandbox input limit")
    timeout = max(1, min(int(timeout_seconds), 120))
    docker = _docker()
    image = IMAGES[selected]

    inspect = subprocess.run(
        [docker, "image", "inspect", image],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if inspect.returncode != 0:
        raise RuntimeError(
            f"Sandbox image is not installed: {image}. Install it locally before using this tool."
        )

    runtime = ["python", "-"] if selected == "python" else ["node", "-"]
    args = [
        docker, "run", "--rm", "-i",
        "--network=none",
        "--read-only",
        "--memory=256m",
        "--cpus=1",
        "--pids-limit=64",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
        image,
        *runtime,
    ]
    try:
        proc = subprocess.run(
            args,
            input=source,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "language": selected,
            "image": image,
            "returncode": proc.returncode,
            "stdout": proc.stdout[-MAX_OUTPUT_CHARS:],
            "stderr": proc.stderr[-MAX_OUTPUT_CHARS:],
            "timed_out": False,
            "network_enabled": False,
            "host_mounts": False,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        return {
            "language": selected,
            "image": image,
            "returncode": None,
            "stdout": str(stdout)[-MAX_OUTPUT_CHARS:],
            "stderr": str(stderr)[-MAX_OUTPUT_CHARS:],
            "timed_out": True,
            "network_enabled": False,
            "host_mounts": False,
        }
