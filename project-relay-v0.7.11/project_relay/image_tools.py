from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from .commandport import _resolve
from .owner_full_control import require_enabled

MAX_PIXELS = 100_000_000
MAX_OUTPUT_BYTES = 2_000_000


def owner_read_image(
    path: str,
    max_width: int = 1280,
    jpeg_quality: int = 70,
) -> dict[str, Any]:
    require_enabled()
    target = _resolve(path, must_exist=True)
    if not target.is_file():
        raise IsADirectoryError(str(target))
    max_width = max(128, min(int(max_width), 1920))
    jpeg_quality = max(30, min(int(jpeg_quality), 85))

    with Image.open(target) as source:
        source.load()
        original_width, original_height = source.size
        if original_width * original_height > MAX_PIXELS:
            raise ValueError("image exceeds pixel safety limit")
        image = ImageOps.exif_transpose(source).convert("RGB")
        if image.width > max_width:
            height = max(1, round(image.height * max_width / image.width))
            image = image.resize((max_width, height))
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=jpeg_quality, optimize=True)
        data = out.getvalue()
    if len(data) > MAX_OUTPUT_BYTES:
        raise RuntimeError("image preview exceeds transport limit")
    return {
        "path": str(target),
        "mime_type": "image/jpeg",
        "original_width": original_width,
        "original_height": original_height,
        "width": image.width,
        "height": image.height,
        "bytes": len(data),
        "base64": base64.b64encode(data).decode("ascii"),
    }
