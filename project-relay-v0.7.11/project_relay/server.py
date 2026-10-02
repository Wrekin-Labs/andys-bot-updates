from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .discovery import discover_devices
from .policy import plan
from .approvals import ApprovalStore
from .security import ReplayGuard, verify

HOST = "127.0.0.1"
DEFAULT_PORT = 8787
_REPLAY = ReplayGuard()


def _json_bytes(value) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "ProjectRelay/0.3"

    def _send(self, status: int, value) -> None:
        body = _json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send(200, {"ok": True, "version": "0.3.1", "mode": "approval-gated"})
            return
        if path == "/v1/devices":
            self._send(200, {"devices": [d.to_dict() for d in discover_devices()]})
            return
        if path == "/v1/pending-approvals":
            self._send(200, {"approvals": [r.to_dict() for r in ApprovalStore().pending()]})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        secret = os.environ.get("RELAY_PAIRING_SECRET", "")
        if not secret:
            self._send(503, {"error": "pairing secret not configured"})
            return
        ts = self.headers.get("X-Relay-Timestamp", "")
        nonce = self.headers.get("X-Relay-Nonce", "")
        sig = self.headers.get("X-Relay-Signature", "")
        ok, reason = verify(secret, ts, nonce, sig, body)
        if not ok or not _REPLAY.accept(nonce):
            self._send(401, {"error": reason if not ok else "replayed nonce"})
            return
        if path != "/v1/plan":
            self._send(404, {"error": "not found"})
            return
        try:
            payload = json.loads(body or b"{}")
            result = plan(payload["action"], payload.get("device_id", ""), payload.get("summary", ""), **payload.get("arguments", {}))
        except Exception as exc:
            self._send(400, {"error": str(exc)})
            return
        self._send(200, {"plan": result.to_dict(), "executed": False})

    def log_message(self, fmt: str, *args) -> None:
        return


def serve(port: int = DEFAULT_PORT) -> None:
    httpd = ThreadingHTTPServer((HOST, port), RelayHandler)
    print(f"Project Relay listening on http://{HOST}:{port} (approval-gated prototype)")
    httpd.serve_forever()
