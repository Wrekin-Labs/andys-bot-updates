from __future__ import annotations

import ctypes
import os
from ctypes import wintypes

ERROR_ALREADY_EXISTS = 183
_MUTEX = None


def acquire(name: str = "Local\\ProjectRelayAgent") -> bool:
    """Hold a per-session Windows named mutex for this process lifetime."""
    global _MUTEX
    if os.name != "nt":
        return True
    if _MUTEX:
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return False
    _MUTEX = handle
    return True
