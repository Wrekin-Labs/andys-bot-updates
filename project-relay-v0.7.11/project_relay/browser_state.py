"""Bounded, text-free browser scroll inspection via Windows UI Automation."""
from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

from .desktop_controls import BROWSERS, assert_context, desktop_context


def _worker() -> dict[str, Any]:
    context = desktop_context()
    if context["application"] not in BROWSERS:
        raise PermissionError("A supported browser must be in the foreground")

    from pywinauto.uia_element_info import UIAElementInfo
    from pywinauto.uia_defines import get_elem_interface

    root = UIAElementInfo(context["hwnd"])
    documents = root.descendants(control_type="Document", cache_enable=False)
    if len(documents) > 32:
        raise RuntimeError("Browser has too many document surfaces")
    left, top, right, bottom = context["rect"]
    candidates = []
    for document in documents:
        rect = document.rectangle
        if not document.visible or not (
            left <= rect.left < rect.right <= right and top <= rect.top < rect.bottom <= bottom
        ):
            continue
        candidates.append(((rect.right - rect.left) * (rect.bottom - rect.top), document))
    if not candidates:
        raise RuntimeError("No visible browser document")
    # The largest document is normally the page rather than an embedded frame.
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        raise RuntimeError("Browser document is ambiguous")
    document = candidates[0][1]
    state: dict[str, Any] = {"browser": context["application"], "vertical_scrollable": None,
                             "vertical_percent": None}
    try:
        pattern = get_elem_interface(document.element, "Scroll")
        state["vertical_scrollable"] = bool(pattern.CurrentVerticallyScrollable)
        if state["vertical_scrollable"]:
            percent = float(pattern.CurrentVerticalScrollPercent)
            if 0 <= percent <= 100:
                state["vertical_percent"] = round(percent, 1)
    except Exception:
        # Not all browser providers implement ScrollPattern. Unknown is distinct
        # from a confirmed non-scrollable page; never fall back to page contents.
        pass
    assert_context(context)
    return state


def commandport_browser_scroll_state() -> dict[str, Any]:
    """Report scroll position without reading text, inputs, pixels or URLs."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "project_relay.browser_state"],
            text=True, capture_output=True, timeout=12, check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Browser state inspection timed out") from None
    if result.returncode or len(result.stdout) > 1024:
        raise RuntimeError("Browser state inspection unavailable")
    try:
        response = json.loads(result.stdout)
        if not response.get("ok") or not isinstance(response.get("result"), dict):
            raise ValueError("Unavailable")
        return response["result"]
    except (TypeError, ValueError):
        raise RuntimeError("Browser state inspection unavailable") from None


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, "result": _worker()}))
    except Exception:
        # Provider exceptions may contain private page text. Never forward them.
        print(json.dumps({"ok": False}))
