from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .approvals import ApprovalStore
from .discovery import discover_devices


def _printer(device_id: str):
    for device in discover_devices():
        if device.device_id == device_id and device.kind == "printer":
            return device
    raise KeyError(f"Unknown printer device_id: {device_id}")


def _file_info(file_ref: str) -> dict[str, Any]:
    path = Path(file_ref).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Print source does not exist: {path}")
    if path.stat().st_size > 250 * 1024 * 1024:
        raise ValueError("Prototype refuses files larger than 250 MB")
    sha = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            sha.update(chunk)
    info: dict[str, Any] = {
        "path": str(path),
        "name": path.name,
        "size_bytes": path.stat().st_size,
        "sha256": sha.hexdigest(),
        "suffix": path.suffix.lower(),
    }
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
            info["page_count"] = len(PdfReader(str(path)).pages)
        except Exception:
            info["page_count"] = None
    return info


def prepare_document_print(device_id: str, file_ref: str, copies: int = 1, store: ApprovalStore | None = None) -> dict[str, Any]:
    if not 1 <= copies <= 20:
        raise ValueError("copies must be between 1 and 20")
    printer = _printer(device_id)
    file_info = _file_info(file_ref)
    arguments = {"file_sha256": file_info["sha256"], "copies": copies}
    summary = f"Print {copies} copy/copies of {file_info['name']} on {printer.name}"
    approval = (store or ApprovalStore()).create(
        "start_document_print", device_id, arguments, summary, ttl_seconds=600
    )
    return {
        "printer": printer.to_dict(),
        "file": file_info,
        "copies": copies,
        "approval_id": approval.approval_id,
        "approval_expires_at": approval.expires_at,
        "executed": False,
    }


def start_document_print(approval_id: str, device_id: str, file_ref: str, copies: int, store: ApprovalStore | None = None) -> dict[str, Any]:
    if not 1 <= copies <= 20:
        raise ValueError("copies must be between 1 and 20")
    _printer(device_id)
    file_info = _file_info(file_ref)
    arguments = {"file_sha256": file_info["sha256"], "copies": copies}
    # Consume only after all invariants have been checked. Execution remains disabled by default.
    import os
    if os.getenv("RELAY_ENABLE_PHYSICAL_PRINT", "0") != "1":
        raise RuntimeError("Physical printing is disabled. Set RELAY_ENABLE_PHYSICAL_PRINT=1 only after a printer adapter has been locally validated.")
    (store or ApprovalStore()).consume(
        approval_id, action="start_document_print", device_id=device_id, arguments=arguments
    )
    raise NotImplementedError("No physical printer adapter is enabled in Project Relay v0.3.1")
