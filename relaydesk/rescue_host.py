from __future__ import annotations

import argparse
import ctypes
import hmac
import io
import ipaddress
import json
import os
import secrets
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

TAILNET = ipaddress.ip_network("100.64.0.0/10")
CONTROL_TTL_SECONDS = 600
MAX_TEXT_CHARS = 4096
RECOVERY_TASKS = (
    "Project Relay Cloud Agent",
    "Project Relay Cloud Watchdog",
)


def is_trusted_peer(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return ip.is_loopback or ip in TAILNET


def load_or_create_token(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if len(value) < 32:
            raise RuntimeError("RelayDesk rescue token is invalid")
        return value
    value = secrets.token_urlsafe(32)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(value + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return value


class ControlLease:
    def __init__(self, ttl: int = CONTROL_TTL_SECONDS) -> None:
        self.ttl = ttl
        self._until = 0.0
        self._lock = threading.Lock()

    def enable(self) -> int:
        with self._lock:
            self._until = time.monotonic() + self.ttl
            return self.ttl

    def disable(self) -> None:
        with self._lock:
            self._until = 0.0

    def remaining(self) -> int:
        with self._lock:
            return max(0, int(self._until - time.monotonic()))

    def active(self) -> bool:
        with self._lock:
            return self._until > time.monotonic()


if os.name == "nt":
    ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.c_ushort),
            ("wScan", ctypes.c_ushort),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", ctypes.c_long),
            ("dy", ctypes.c_long),
            ("mouseData", ctypes.c_ulong),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class INPUTUNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]

    class INPUT(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [("type", ctypes.c_ulong), ("u", INPUTUNION)]

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004
    INPUT_MOUSE = 0
    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_WHEEL = 0x0800
    MOUSEEVENTF_ABSOLUTE = 0x8000
    MOUSEEVENTF_VIRTUALDESK = 0x4000

    VK = {
        "backspace": 0x08,
        "tab": 0x09,
        "enter": 0x0D,
        "esc": 0x1B,
        "space": 0x20,
        "pageup": 0x21,
        "pagedown": 0x22,
        "end": 0x23,
        "home": 0x24,
        "left": 0x25,
        "up": 0x26,
        "right": 0x27,
        "down": 0x28,
        "delete": 0x2E,
    }
    for i in range(1, 13):
        VK[f"f{i}"] = 0x6F + i


def _send_inputs(items: list[Any]) -> None:
    if os.name != "nt":
        raise RuntimeError("Windows input is only available on Windows")
    if not items:
        return
    array = (INPUT * len(items))(*items)
    sent = ctypes.windll.user32.SendInput(len(items), array, ctypes.sizeof(INPUT))
    if sent != len(items):
        code = ctypes.get_last_error()
        raise OSError(code, f"SendInput sent {sent}/{len(items)} events")


def type_text(text: str) -> None:
    if not isinstance(text, str) or not text or len(text) > MAX_TEXT_CHARS:
        raise ValueError("text length is invalid")
    events: list[Any] = []
    raw = text.encode("utf-16-le")
    for idx in range(0, len(raw), 2):
        code_unit = int.from_bytes(raw[idx : idx + 2], "little")
        events.append(INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(0, code_unit, KEYEVENTF_UNICODE, 0, 0)))
        events.append(INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(0, code_unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, 0)))
    _send_inputs(events)


def send_key(name: str) -> None:
    if os.name != "nt":
        raise RuntimeError("Windows input is only available on Windows")
    key = str(name or "").lower().strip()
    vk = VK.get(key)
    if vk is None:
        raise ValueError("unsupported key")
    _send_inputs([
        INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(vk, 0, 0, 0, 0)),
        INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP, 0, 0)),
    ])


def _screen_metrics() -> tuple[int, int, int, int]:
    if os.name != "nt":
        raise RuntimeError("Windows input is only available on Windows")
    user32 = ctypes.windll.user32
    left = user32.GetSystemMetrics(76)
    top = user32.GetSystemMetrics(77)
    width = user32.GetSystemMetrics(78)
    height = user32.GetSystemMetrics(79)
    return left, top, width, height


def move_mouse(x: int, y: int) -> None:
    left, top, width, height = _screen_metrics()
    if width <= 1 or height <= 1:
        raise RuntimeError("invalid virtual desktop metrics")
    x = max(left, min(int(x), left + width - 1))
    y = max(top, min(int(y), top + height - 1))
    ax = round((x - left) * 65535 / (width - 1))
    ay = round((y - top) * 65535 / (height - 1))
    _send_inputs([INPUT(type=INPUT_MOUSE, mi=MOUSEINPUT(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0, 0))])


def click_mouse(x: int, y: int, button: str = "left", clicks: int = 1) -> None:
    move_mouse(x, y)
    button = button.lower()
    flags = {
        "left": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    }.get(button)
    if flags is None:
        raise ValueError("unsupported mouse button")
    clicks = max(1, min(int(clicks), 2))
    events: list[Any] = []
    for _ in range(clicks):
        events.extend([
            INPUT(type=INPUT_MOUSE, mi=MOUSEINPUT(0, 0, 0, flags[0], 0, 0)),
            INPUT(type=INPUT_MOUSE, mi=MOUSEINPUT(0, 0, 0, flags[1], 0, 0)),
        ])
    _send_inputs(events)


def scroll_mouse(ticks: int) -> None:
    ticks = max(-20, min(20, int(ticks)))
    _send_inputs([INPUT(type=INPUT_MOUSE, mi=MOUSEINPUT(0, 0, ctypes.c_ulong(ticks * 120).value, MOUSEEVENTF_WHEEL, 0, 0))])


def capture_jpeg(max_width: int = 1600, quality: int = 72) -> tuple[bytes, int, int]:
    try:
        import mss
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("mss and Pillow are required for screen capture") from exc
    with mss.mss() as sct:
        mon = sct.monitors[0]
        shot = sct.grab(mon)
        image = Image.frombytes("RGB", shot.size, shot.rgb)
    width, height = image.size
    if width > max_width:
        new_height = max(1, round(height * max_width / width))
        image = image.resize((max_width, new_height))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=max(40, min(int(quality), 85)), optimize=False)
    return out.getvalue(), width, height


def recover_project_relay() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Relay recovery is only available on Windows")
    results = []
    for task in RECOVERY_TASKS:
        proc = subprocess.run(
            ["schtasks.exe", "/Run", "/TN", task],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        results.append({
            "task": task,
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "message": (proc.stdout or proc.stderr or "").strip()[:500],
        })
    return {"ok": any(item["ok"] for item in results), "tasks": results}


INDEX_HTML = r'''<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>RelayDesk Rescue</title><style>
body{margin:0;background:#101318;color:#eee;font:14px system-ui}#bar{padding:8px;display:flex;gap:7px;flex-wrap:wrap;background:#171c23;position:sticky;top:0}button,input{padding:9px;border-radius:8px;border:1px solid #3a414b;background:#232a35;color:#eee}#screen{width:100%;height:auto;background:#000}#text{flex:1;min-width:160px}.on{background:#315c40}</style></head><body>
<div id="bar"><button id="ctl">Enable control</button><button id="recover">Recover Relay</button><input id="text" placeholder="Type text"><button id="type">Type</button><span id="st"></span></div><img id="screen">
<script>
const token=(location.hash.match(/(?:^|&)token=([^&]+)/)||[])[1]||''; const H={'Authorization':'Bearer '+decodeURIComponent(token),'Content-Type':'application/json'};
async function api(p,d){let r=await fetch(p,{method:d?'POST':'GET',headers:H,body:d?JSON.stringify(d):undefined,cache:'no-store'});let j=await r.json();document.getElementById('st').textContent=j.ok?'ONLINE':'ERROR';return j}
async function refresh(){document.getElementById('screen').src='screen.jpg?t='+Date.now()+'&token='+encodeURIComponent(token);let j=await api('api/status');document.getElementById('ctl').classList.toggle('on',j.control);document.getElementById('ctl').textContent=j.control?'Control '+j.control_ttl+'s':'Enable control'}
document.getElementById('ctl').onclick=async()=>{let s=await api('api/status');await api('api/control',{enabled:!s.control});refresh()};
document.getElementById('recover').onclick=async()=>{if(confirm('Start the fixed Project Relay recovery tasks?')){await api('api/recover-relay',{});setTimeout(refresh,1000)}};
document.getElementById('type').onclick=async()=>{let e=document.getElementById('text');await api('api/type',{text:e.value});e.value=''};
document.getElementById('screen').onclick=async e=>{let s=await api('api/status');if(!s.control)return;let r=e.target.getBoundingClientRect();await api('api/click',{x:(e.clientX-r.left)/r.width*s.sw,y:(e.clientY-r.top)/r.height*s.sh,button:'left',clicks:1});setTimeout(refresh,100)};
setInterval(refresh,1000);refresh();
</script></body></html>'''


class RescueState:
    def __init__(self, token: str) -> None:
        self.token = token
        self.lease = ControlLease()


class RescueHandler(BaseHTTPRequestHandler):
    server_version = "RelayDeskRescue/0.4"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    @property
    def state(self) -> RescueState:
        return self.server.state

    def _trusted(self) -> bool:
        return is_trusted_peer(self.client_address[0])

    def _token(self) -> str:
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        from urllib.parse import parse_qs, urlsplit
        return parse_qs(urlsplit(self.path).query).get("token", [""])[0]

    def _authorized(self) -> bool:
        return self._trusted() and hmac.compare_digest(self._token(), self.state.token)

    def _json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict[str, Any]:
        length = min(int(self.headers.get("Content-Length", "0") or 0), 65536)
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value

    def _require(self, control: bool = False) -> bool:
        if not self._authorized():
            self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return False
        if control and not self.state.lease.active():
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "control lease required"})
            return False
        return True

    def do_GET(self) -> None:
        from urllib.parse import urlsplit
        path = urlsplit(self.path).path
        if not self._trusted():
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "tailnet only"})
            return
        if path == "/":
            body = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/status":
            if not self._require():
                return
            try:
                left, top, sw, sh = _screen_metrics()
            except Exception:
                left, top, sw, sh = 0, 0, 0, 0
            self._json(HTTPStatus.OK, {"ok": True, "sw": sw, "sh": sh, "left": left, "top": top, "control": self.state.lease.active(), "control_ttl": self.state.lease.remaining(), "tailnet_only": True, "version": "0.4"})
            return
        if path == "/screen.jpg":
            if not self._require():
                return
            try:
                data, _, _ = capture_jpeg()
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)[:300]})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        from urllib.parse import urlsplit
        path = urlsplit(self.path).path
        if not self._require():
            return
        try:
            body = self._body()
            if path == "/api/control":
                enabled = body.get("enabled") is True
                ttl = self.state.lease.enable() if enabled else (self.state.lease.disable() or 0)
                self._json(HTTPStatus.OK, {"ok": True, "control": enabled, "control_ttl": ttl})
                return
            if path == "/api/recover-relay":
                result = recover_project_relay()
                self._json(HTTPStatus.OK if result["ok"] else HTTPStatus.CONFLICT, result)
                return
            if path == "/api/type":
                if not self._require(control=True):
                    return
                type_text(str(body.get("text") or ""))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if path == "/api/key":
                if not self._require(control=True):
                    return
                send_key(str(body.get("key") or ""))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if path == "/api/click":
                if not self._require(control=True):
                    return
                click_mouse(int(float(body["x"])), int(float(body["y"])), str(body.get("button", "left")), int(body.get("clicks", 1)))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if path == "/api/scroll":
                if not self._require(control=True):
                    return
                scroll_mouse(int(body.get("ticks", 0)))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
        except (ValueError, KeyError, TypeError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)[:300]})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)[:300]})


class RescueServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], state: RescueState) -> None:
        super().__init__(address, RescueHandler)
        self.state = state


def main() -> int:
    parser = argparse.ArgumentParser(description="RelayDesk tailnet-only rescue host")
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--token-file", default=str(Path(os.getenv("LOCALAPPDATA", Path.home())) / "RelayDesk" / "rescue.token"))
    args = parser.parse_args()
    token = load_or_create_token(Path(args.token_file))
    print(f"RelayDesk Rescue 0.4 listening on {args.bind}:{args.port}")
    print("Tailnet/loopback only. API mutations require the rescue token and a time-limited control lease.")
    RescueServer((args.bind, args.port), RescueState(token)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
