from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import urllib.parse
from typing import Any

MAX_URL_BYTES = 1_000_000
MAX_REDIRECTS = 5
SENSITIVE_KEYS = (
    "token", "secret", "password", "passwd", "api_key", "apikey",
    "access_key", "auth", "credential", "session", "otp", "2fa",
    "verification", "code", "card", "cvv", "cvc",
)


def _validate_url(url: str) -> urllib.parse.ParseResult:
    value = str(url or "").strip()
    if not value or len(value) > 4096:
        raise ValueError("invalid URL")
    if any(ord(ch) < 32 for ch in value):
        raise ValueError("URL control characters are forbidden")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only normal http(s) URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Credentials in URLs are forbidden")
    if parsed.fragment:
        raise ValueError("URL fragments are not allowed")
    if any(
        any(mark in key.casefold() for mark in SENSITIVE_KEYS)
        for key, _ in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    ):
        raise ValueError("URLs with credential-shaped query parameters are forbidden")
    host = parsed.hostname.casefold()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise PermissionError("local-network URL targets are not allowed")
    return parsed


def _resolve_public(hostname: str, port: int) -> list[str]:
    try:
        rows = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("URL host could not be resolved") from exc
    values: list[str] = []
    for row in rows:
        value = str(row[4][0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            continue
        if not ip.is_global:
            raise PermissionError(
                "private, loopback, link-local and reserved URL targets are not allowed"
            )
        if value not in values:
            values.append(value)
    if not values:
        raise ValueError("URL host resolved to no usable address")
    return values


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, pinned_ip: str, port: int, timeout: int):
        context = ssl.create_default_context()
        super().__init__(hostname, port=port, timeout=timeout, context=context)
        self._relay_pinned_ip = pinned_ip
        self._relay_hostname = hostname

    def connect(self) -> None:
        sock = socket.create_connection(
            (self._relay_pinned_ip, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            self.sock = sock
            self._tunnel()
            sock = self.sock
        self.sock = self._context.wrap_socket(sock, server_hostname=self._relay_hostname)


def _host_header(parsed: urllib.parse.ParseResult) -> str:
    hostname = str(parsed.hostname or "").encode("idna").decode("ascii")
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    port = parsed.port
    default = 443 if parsed.scheme.lower() == "https" else 80
    return f"{hostname}:{port}" if port and port != default else hostname


def _request_once(url: str, timeout: int, limit: int) -> dict[str, Any]:
    parsed = _validate_url(url)
    hostname = str(parsed.hostname or "").encode("idna").decode("ascii")
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    addresses = _resolve_public(hostname, port)
    pinned = addresses[0]
    target = urllib.parse.urlunsplit((
        "",
        "",
        parsed.path or "/",
        parsed.query,
        "",
    ))
    headers = {
        "Host": _host_header(parsed),
        "User-Agent": "ProjectRelay/0.7 (+pinned-safe-url-reader)",
        "Accept": "text/*,application/json,application/xml;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
        "Connection": "close",
    }
    if parsed.scheme.lower() == "https":
        conn: http.client.HTTPConnection = _PinnedHTTPSConnection(
            hostname, pinned, port, timeout
        )
    else:
        conn = http.client.HTTPConnection(pinned, port=port, timeout=timeout)
    try:
        conn.request("GET", target, headers=headers)
        response = conn.getresponse()
        content_type = response.headers.get_content_type()
        charset = response.headers.get_content_charset() or "utf-8"
        location = response.headers.get("Location")
        body = response.read(limit + 1)
        truncated = len(body) > limit
        body = body[:limit]
        textual = (
            content_type.startswith("text/")
            or content_type in {
                "application/json", "application/xml", "application/xhtml+xml",
                "application/javascript", "application/x-javascript",
            }
        )
        return {
            "status": int(response.status),
            "content_type": content_type,
            "charset": charset if textual else None,
            "bytes": len(body),
            "truncated": truncated,
            "text": body.decode(charset, errors="replace") if textual else None,
            "binary_content_omitted": not textual,
            "location": location,
            "pinned_ip": pinned,
        }
    finally:
        conn.close()


def read_url(url: str, timeout_seconds: int = 20, max_bytes: int = 256_000) -> dict[str, Any]:
    original = str(url)
    current = original
    timeout = max(1, min(int(timeout_seconds), 30))
    limit = max(1, min(int(max_bytes), MAX_URL_BYTES))
    redirects: list[str] = []

    for _ in range(MAX_REDIRECTS + 1):
        result = _request_once(current, timeout, limit)
        status = int(result["status"])
        location = result.pop("location", None)
        if status not in {301, 302, 303, 307, 308} or not location:
            return {
                "url": original,
                "final_url": current,
                "redirects": redirects,
                **result,
            }
        if len(redirects) >= MAX_REDIRECTS:
            raise RuntimeError("URL redirect limit exceeded")
        next_url = urllib.parse.urljoin(current, str(location))
        old = _validate_url(current)
        new = _validate_url(next_url)
        if old.scheme.lower() == "https" and new.scheme.lower() != "https":
            raise PermissionError("HTTPS to HTTP redirects are not allowed")
        # Resolve now for validation; _request_once resolves again and pins the
        # exact address it subsequently connects to.
        next_host = str(new.hostname or "").encode("idna").decode("ascii")
        next_port = new.port or (443 if new.scheme.lower() == "https" else 80)
        _resolve_public(next_host, next_port)
        redirects.append(next_url)
        current = next_url

    raise RuntimeError("URL redirect limit exceeded")
