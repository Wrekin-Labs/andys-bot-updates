from __future__ import annotations

import base64
import io
import os
from typing import Any

from .owner_full_control import require_enabled


def capture(max_width: int = 1280, jpeg_quality: int = 55) -> dict[str, Any]:
    """Capture current desktop for an explicitly enabled owner workstation."""
    require_enabled()
    if os.name != "nt":
        raise RuntimeError("Screenshot capture requires Windows")
    max_width = max(320, min(int(max_width), 1920))
    jpeg_quality = max(25, min(int(jpeg_quality), 80))
    from PIL import ImageGrab
    image = ImageGrab.grab(all_screens=False)
    if image.width > max_width:
        height = max(1, round(image.height * max_width / image.width))
        image = image.resize((max_width, height))
    out = io.BytesIO()
    image.convert("RGB").save(out, format="JPEG", quality=jpeg_quality, optimize=True)
    data = out.getvalue()
    if len(data) > 1_500_000:
        raise RuntimeError("screenshot exceeds transport limit")
    return {
        "mime_type": "image/jpeg", "width": image.width, "height": image.height,
        "base64": base64.b64encode(data).decode("ascii"),
    }
