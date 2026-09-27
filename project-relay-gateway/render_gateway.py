from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_MCP = os.environ.get(
    "UPSTREAM_MCP",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-mcp",
).rstrip("/")
ACCOUNT_PAGE = os.environ.get(
    "PROJECT_RELAY_ACCOUNT_PAGE",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-account",
)
OAUTH_PAGE = os.environ.get(
    "PROJECT_RELAY_OAUTH_PAGE",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-oauth",
)
SITE_PAGE = os.environ.get(
    "PROJECT_RELAY_SITE_PAGE",
    "https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-site",
)
PORT = int(os.environ.get("PORT", "10000"))
CHALLENGE = os.environ.get("OPENAI_APPS_CHALLENGE", "").strip()


class RelayGateway(BaseHTTPRequestHandler):
    server_version = "ProjectRelayGateway/0.1"

    def _public_origin(self) -> str:
        proto = self.headers.get("X-Forwarded-Proto", "https").split(",")[0].strip()
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        return f"{proto}://{host}".rstrip("/")

    def _public_mcp(self) -> str:
        return self._public_origin() + "/mcp"

    def _send(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("x-content-type-options", "nosniff")
        if extra:
            for key, value in extra.items():
                if key.lower() not in {"content-length", "transfer-encoding", "connection"}:
                    self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _proxy_html(self, upstream_base: str) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        upstream = upstream_base + (("?" + query) if query else "")
        req = urllib.request.Request(
            upstream,
            method="GET",
            headers={
                "accept": "text/html",
                "user-agent": self.headers.get("user-agent", "ProjectRelayGateway/0.2"),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
                status = response.status
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
        except Exception as exc:
            payload = b"Project Relay page unavailable"
            status = 502
            print("gateway page upstream error:", repr(exc), flush=True)

        text = payload.decode("utf-8", errors="replace")
        text = text.replace("/functions/v1/project-relay-site/", "/")
        text = text.replace("/functions/v1/project-relay-site", "")
        payload = text.encode("utf-8")

        self._send(
            status,
            payload,
            "text/html; charset=utf-8",
            {
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
                "content-security-policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://esm.sh 'unsafe-inline'; "
                    "style-src 'self' 'unsafe-inline'; "
                    "connect-src 'self' https://dbhwjzznwhukoogjewfl.supabase.co; "
                    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
                ),
            },
        )

    def _proxy_site_post(self, upstream: str) -> None:
        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        headers = {
            "content-type": self.headers.get("content-type", "application/json"),
            "accept": "application/json",
            "user-agent": self.headers.get("user-agent", "ProjectRelayGateway/0.2"),
        }
        req = urllib.request.Request(upstream, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            content_type = exc.headers.get("Content-Type", "application/json; charset=utf-8")
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": "Support request unavailable"}).encode()
            status = 502
            content_type = "application/json; charset=utf-8"
            print("gateway support upstream error:", repr(exc), flush=True)
        self._send(status, payload, content_type, {"cache-control": "no-store"})

    def _proxy(self) -> None:
        suffix = self.path[len("/mcp"):] if self.path.startswith("/mcp") else self.path
        upstream = UPSTREAM_MCP + suffix
        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length) if length else None

        headers: dict[str, str] = {}
        for name in (
            "authorization",
            "content-type",
            "accept",
            "mcp-protocol-version",
            "origin",
            "user-agent",
        ):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        headers["x-forwarded-host"] = self.headers.get("Host", "")

        req = urllib.request.Request(
            upstream,
            data=body,
            method=self.command,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = response.read()
                status = response.status
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            response_headers = dict(exc.headers.items())
        except Exception as exc:
            payload = json.dumps({"error": "Project Relay upstream unavailable"}).encode()
            self._send(502, payload, "application/json; charset=utf-8")
            print("gateway upstream error:", repr(exc), flush=True)
            return

        content_type = response_headers.get("Content-Type", "application/octet-stream")
        if (
            "json" in content_type.lower()
            or content_type.lower().startswith("text/")
            or b"dbhwjzznwhukoogjewfl.supabase.co/functions/v1/project-relay-mcp" in payload
        ):
            text = payload.decode("utf-8", errors="replace")
            text = text.replace(UPSTREAM_MCP, self._public_mcp())
            payload = text.encode("utf-8")

        keep: dict[str, str] = {}
        for key in ("cache-control", "www-authenticate", "mcp-session-id"):
            value = response_headers.get(key) or response_headers.get(key.title())
            if value:
                keep[key] = value.replace(UPSTREAM_MCP, self._public_mcp())
        keep["access-control-allow-origin"] = "*"
        keep["access-control-allow-headers"] = "authorization,content-type,mcp-protocol-version"
        keep["access-control-allow-methods"] = "GET,POST,OPTIONS"
        self._send(status, payload, content_type, keep)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/health":
            body = json.dumps(
                {"ok": True, "service": "Project Relay MCP Gateway", "upstream": "configured"}
            ).encode()
            self._send(200, body, "application/json; charset=utf-8", {"cache-control": "no-store"})
            return
        if path in {"/", "/support", "/privacy", "/terms"}:
            suffix = "" if path == "/" else path
            self._proxy_html(SITE_PAGE + suffix)
            return
        if path == "/account":
            self._proxy_html(ACCOUNT_PAGE)
            return
        if path == "/oauth":
            self._proxy_html(OAUTH_PAGE)
            return
        if path == "/.well-known/openai-apps-challenge":
            if not CHALLENGE:
                self._send(404, b"Not configured", "text/plain; charset=utf-8", {"cache-control": "no-store"})
                return
            self._send(200, CHALLENGE.encode(), "text/plain; charset=utf-8", {"cache-control": "no-store"})
            return
        if self.path.startswith("/mcp"):
            self._proxy()
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/support":
            self._proxy_site_post(SITE_PAGE + "/support")
            return
        if self.path.startswith("/mcp"):
            self._proxy()
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_OPTIONS(self) -> None:
        if self.path.startswith("/mcp"):
            self._proxy()
            return
        self._send(204, b"", "text/plain; charset=utf-8", {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization,content-type,mcp-protocol-version",
            "access-control-allow-methods": "GET,POST,OPTIONS",
        })

    def log_message(self, fmt: str, *args: object) -> None:
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RelayGateway)
    print(f"Project Relay gateway listening on {PORT}", flush=True)
    server.serve_forever()
