"""Bounded Windows input with exact local approval and foreground checks.

No arbitrary hotkeys, shell input, clipboard reads, screenshots or DOM reads.
Foreground checks reduce misdirection; Windows does not make check-and-input atomic.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import PureWindowsPath
from typing import Any

from .approvals import ApprovalStore

DEVICE = "commandport:desktop"
BROWSERS = {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"}


def desktop_context() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Desktop controls require Windows")
    import ctypes
    from ctypes import wintypes as w

    u = ctypes.WinDLL("user32", use_last_error=True)
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    u.GetForegroundWindow.restype = w.HWND
    u.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    u.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    u.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
    u.IsWindowVisible.argtypes = [w.HWND]
    u.IsIconic.argtypes = [w.HWND]
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    k.CloseHandle.argtypes = [w.HANDLE]
    # Held modifiers could turn a click or plain typing into an unintended shortcut.
    if any(u.GetAsyncKeyState(code) & 0x8000 for code in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
        raise PermissionError("Release modifier keys before remote input")
    hwnd = u.GetForegroundWindow()
    if not hwnd or not u.IsWindowVisible(hwnd) or u.IsIconic(hwnd):
        raise PermissionError("No visible foreground window")
    pid = w.DWORD()
    thread = u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    rect = w.RECT()
    if not thread or not u.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise PermissionError("Cannot verify foreground window")
    title = ctypes.create_unicode_buffer(32768)
    u.GetWindowTextW(hwnd, title, len(title))
    process = k.OpenProcess(0x1000, False, pid.value)
    if not process:
        raise PermissionError("Cannot identify foreground application")
    try:
        path = ctypes.create_unicode_buffer(32768)
        length = w.DWORD(len(path))
        if not k.QueryFullProcessImageNameW(process, 0, path, ctypes.byref(length)):
            raise PermissionError("Cannot identify foreground application")
    finally:
        k.CloseHandle(process)
    return {
        "hwnd": int(hwnd), "pid": pid.value, "thread": thread,
        "rect": [rect.left, rect.top, rect.right, rect.bottom],
        "application": PureWindowsPath(path.value).name.casefold(),
        # Never return the title itself from this inspection.
        "title_digest": hashlib.sha256(title.value.encode("utf-8")).hexdigest(),
    }


def assert_context(expected: dict[str, Any]) -> None:
    if desktop_context() != expected:
        raise PermissionError("Active window changed; prepare and approve again")


def _scroll_args(ticks: int) -> dict[str, Any]:
    if type(ticks) is not int or not -10 <= ticks <= 10 or ticks == 0:
        raise ValueError("ticks must be a nonzero integer from -10 to 10")
    return {"ticks": ticks, "context": desktop_context()}


def _tab_args(direction: str) -> dict[str, Any]:
    if direction not in ("next", "previous"):
        raise ValueError("direction must be next or previous")
    context = desktop_context()
    if context["application"] not in BROWSERS:
        raise PermissionError("Tab switching requires a supported foreground browser")
    return {"direction": direction, "context": context}


def _prepare(action: str, args: dict[str, Any], summary: str) -> dict[str, Any]:
    record = ApprovalStore().create(action, DEVICE, args, summary, ttl_seconds=120)
    return {"approval": record.to_dict()}


def commandport_prepare_scroll(ticks: int) -> dict[str, Any]:
    return _prepare("commandport_scroll", _scroll_args(ticks), f"Scroll {ticks} wheel ticks in the current window")


def commandport_prepare_switch_tab(direction: str) -> dict[str, Any]:
    return _prepare("commandport_switch_tab", _tab_args(direction), f"Switch to the {direction} browser tab")


def _send(args: dict[str, Any]) -> None:
    import ctypes
    from ctypes import wintypes as w
    u = ctypes.WinDLL("user32", use_last_error=True)

    class MI(ctypes.Structure):
        _fields_ = [("dx", w.LONG), ("dy", w.LONG), ("mouseData", w.DWORD),
                    ("dwFlags", w.DWORD), ("time", w.DWORD), ("dwExtraInfo", w.WPARAM)]

    class KI(ctypes.Structure):
        _fields_ = [("wVk", w.WORD), ("wScan", w.WORD), ("dwFlags", w.DWORD),
                    ("time", w.DWORD), ("dwExtraInfo", w.WPARAM)]

    class Union(ctypes.Union):
        _fields_ = [("mi", MI), ("ki", KI)]

    class Input(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [("type", w.DWORD), ("u", Union)]

    def key(code, up=False):
        return Input(type=1, ki=KI(code, 0, 2 if up else 0, 0, 0))

    if "ticks" in args:
        # Wheel routing depends on cursor position on Windows; keep it inside
        # the approved foreground window and restore it after the event.
        left, top, right, bottom = args["context"]["rect"]
        point = w.POINT()
        if not u.GetCursorPos(ctypes.byref(point)):
            raise RuntimeError("Cannot inspect cursor position")
        assert_context(args["context"])
        if not u.SetCursorPos((left + right) // 2, (top + bottom) // 2):
            raise RuntimeError("Cannot position scroll cursor")
        events = [Input(type=0, mi=MI(0, 0, (args["ticks"] * 120) & 0xFFFFFFFF, 0x0800, 0, 0))]
    else:
        codes = [0x11] + ([0x10] if args["direction"] == "previous" else [])
        events = [key(c) for c in codes] + [key(0x09), key(0x09, True)] + [key(c, True) for c in reversed(codes)]
    try:
        assert_context(args["context"])
        array = (Input * len(events))(*events)
        sent = u.SendInput(len(events), array, ctypes.sizeof(Input))
        if sent != len(events):
            if "direction" in args:
                # Best effort modifier release after partial injection.
                release = (Input * 3)(key(0x09, True), key(0x10, True), key(0x11, True))
                u.SendInput(3, release, ctypes.sizeof(Input))
            raise RuntimeError("Windows did not accept the complete input operation")
    finally:
        if "ticks" in args:
            u.SetCursorPos(point.x, point.y)


def commandport_scroll(approval_id: str, ticks: int) -> dict[str, Any]:
    args = _scroll_args(ticks)
    ApprovalStore().consume(approval_id, action="commandport_scroll", device_id=DEVICE, arguments=args)
    assert_context(args["context"])
    _send(args)
    return {"scrolled": True, "ticks": ticks}


def commandport_switch_tab(approval_id: str, direction: str) -> dict[str, Any]:
    args = _tab_args(direction)
    ApprovalStore().consume(approval_id, action="commandport_switch_tab", device_id=DEVICE, arguments=args)
    assert_context(args["context"])
    _send(args)
    return {"switched": True, "direction": direction}
