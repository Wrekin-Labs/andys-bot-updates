from __future__ import annotations

import platform
import socket
import time
from typing import Any

from . import __version__


def commandport_ping() -> dict[str, Any]:
    return {
        "pong": True,
        "version": __version__,
        "hostname": socket.gethostname(),
        "platform": platform.system(),
        "monotonic_ns": time.monotonic_ns(),
    }
