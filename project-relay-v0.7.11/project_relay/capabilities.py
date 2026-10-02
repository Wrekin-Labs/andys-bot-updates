from __future__ import annotations

CAPABILITIES = {
    "printer": ["status", "prepare_document_print"],
    "scanner": ["status", "prepare_scan_preview"],
    "serial": ["status", "bounded_read"],
}


def capabilities_for(kind: str) -> list[str]:
    return list(CAPABILITIES.get(kind, []))
