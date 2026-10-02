from __future__ import annotations

import os
from typing import Any

from .desktop_controls import assert_context, desktop_context
from .owner_full_control import require_enabled

ROLES = {
    "button": "Button",
    "link": "Hyperlink",
    "menuitem": "MenuItem",
    "tab": "TabItem",
    "checkbox": "CheckBox",
    "radio": "RadioButton",
    "listitem": "ListItem",
    "edit": "Edit",
    "combobox": "ComboBox",
    "treeitem": "TreeItem",
}


def _validate(label: str, role: str) -> None:
    if os.name != "nt":
        raise RuntimeError("Application automation requires Windows")
    if not isinstance(label, str) or not 1 <= len(label) <= 160:
        raise ValueError("label must contain 1 to 160 characters")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in label):
        raise ValueError("control characters are forbidden")
    if role not in ROLES:
        raise ValueError("unsupported UI Automation role")


def owner_find_control(label: str, role: str = "button") -> dict[str, Any]:
    """Find one exact visible control in the foreground app without dumping its UI tree."""
    require_enabled()
    _validate(label, role)
    context = desktop_context()
    from pywinauto.uia_element_info import UIAElementInfo
    root = UIAElementInfo(context["hwnd"])
    candidates = root.descendants(control_type=ROLES[role], title=label, cache_enable=False)
    left, top, right, bottom = context["rect"]
    matches = []
    for element in candidates[:64]:
        if element.element.CurrentIsPassword or not element.visible or not element.enabled:
            continue
        rect = element.rectangle
        if left <= rect.left < rect.right <= right and top <= rect.top < rect.bottom <= bottom:
            matches.append((element, [rect.left, rect.top, rect.right, rect.bottom]))
    if len(matches) != 1:
        raise PermissionError("Control must match exactly one visible enabled target")
    assert_context(context)
    return {
        "found": True, "application": context["application"],
        "role": role, "bounds": matches[0][1],
    }


def owner_click_control(label: str, role: str = "button") -> dict[str, Any]:
    """Click one exact visible enabled control in the foreground application."""
    require_enabled()
    _validate(label, role)
    context = desktop_context()
    from pywinauto.uia_element_info import UIAElementInfo
    root = UIAElementInfo(context["hwnd"])
    candidates = root.descendants(control_type=ROLES[role], title=label, cache_enable=False)
    left, top, right, bottom = context["rect"]
    matches = []
    for element in candidates[:64]:
        if element.element.CurrentIsPassword or not element.visible or not element.enabled:
            continue
        rect = element.rectangle
        if left <= rect.left < rect.right <= right and top <= rect.top < rect.bottom <= bottom:
            matches.append((element, [rect.left, rect.top, rect.right, rect.bottom]))
    if len(matches) != 1:
        raise PermissionError("Control must match exactly one visible enabled target")
    element, bounds = matches[0]
    assert_context(context)
    try:
        element.invoke()
    except Exception:
        x, y = (bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2
        from .commandport import _perform_click
        _perform_click({"x": x, "y": y, "button": "left", "clicks": 1, "context": context})
    return {"clicked": True, "application": context["application"], "role": role}


def owner_set_text(label: str, text: str) -> dict[str, Any]:
    """Set text only on one exact non-password Edit control in the foreground app."""
    require_enabled()
    _validate(label, "edit")
    if not isinstance(text, str) or len(text) > 4000:
        raise ValueError("text exceeds limit")
    context = desktop_context()
    from pywinauto.uia_element_info import UIAElementInfo
    root = UIAElementInfo(context["hwnd"])
    matches = [e for e in root.descendants(control_type="Edit", title=label, cache_enable=False)[:64]
               if not e.element.CurrentIsPassword and e.visible and e.enabled]
    if len(matches) != 1:
        raise PermissionError("Edit control must match exactly one visible non-password target")
    assert_context(context)
    from pywinauto.controls.uiawrapper import UIAWrapper
    UIAWrapper(matches[0]).set_edit_text(text)
    return {"updated": True, "application": context["application"]}
