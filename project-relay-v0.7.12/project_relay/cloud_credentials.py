from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from pathlib import Path

from .state import state_dir

CRYPTPROTECT_UI_FORBIDDEN = 0x1


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _input_blob(data: bytes):
    buf = ctypes.create_string_buffer(data)
    blob = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    return blob, buf


def _crypt32():
    if os.name != "nt":
        raise RuntimeError("Windows DPAPI is only available on Windows")
    return ctypes.windll.crypt32


def protect_bytes(data: bytes) -> bytes:
    crypt32 = _crypt32()
    incoming, keepalive = _input_blob(data)
    outgoing = DATA_BLOB()
    ok = crypt32.CryptProtectData(
        ctypes.byref(incoming),
        "Project Relay",
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(outgoing),
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.pbData)


def unprotect_bytes(data: bytes) -> bytes:
    crypt32 = _crypt32()
    incoming, keepalive = _input_blob(data)
    outgoing = DATA_BLOB()
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(incoming),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(outgoing),
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.pbData)


def protect_text(value: str) -> bytes:
    return protect_bytes(value.encode("utf-8"))


def unprotect_text(value: bytes) -> str:
    return unprotect_bytes(value).decode("utf-8")


def _secret_paths(name: str, root: Path | None = None) -> tuple[Path, Path]:
    base = root or state_dir()
    return base / f"cloud-{name}.dpapi", base / f"cloud-{name}-token.txt"


def store_cloud_secret(name: str, value: str, root: Path | None = None) -> Path:
    encrypted_path, plaintext_path = _secret_paths(name, root)
    encrypted_path.parent.mkdir(parents=True, exist_ok=True)
    encrypted_path.write_bytes(protect_text(value))
    if plaintext_path.exists():
        plaintext_path.unlink()
    return encrypted_path


def load_cloud_secret(name: str, root: Path | None = None) -> str:
    encrypted_path, plaintext_path = _secret_paths(name, root)
    if encrypted_path.exists():
        value = unprotect_text(encrypted_path.read_bytes()).strip()
        if not value:
            raise RuntimeError(f"Encrypted Project Relay {name} credential is empty")
        return value

    if plaintext_path.exists():
        value = plaintext_path.read_text(encoding="utf-8").strip()
        if not value:
            raise RuntimeError(f"Project Relay {name} credential is empty")
        store_cloud_secret(name, value, root)
        return value

    raise RuntimeError(f"Missing Project Relay {name} credential")
