from __future__ import annotations

import argparse
import asyncio
import io
import json
import platform
import secrets
import socket
import time

from cryptography.exceptions import InvalidTag
from capture_backend import create_capture, monitor_catalog
from PIL import Image
from websockets.asyncio.client import connect

from shared import (
    ReplayError,
    Invite,
    SessionCrypto,
    join_verifier,
    new_keypair,
    short_fingerprint,
    pack_json,
    unpack_json,
)


def _screen_backend():
    try:
        import mss
    except ImportError as exc:
        raise SystemExit("Missing mss. Run: py -m pip install -r requirements-host.txt") from exc
    return mss


def _input_backend():
    try:
        import pyautogui
    except ImportError as exc:
        raise SystemExit("Missing pyautogui. Run: py -m pip install -r requirements-host.txt") from exc
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0
    return pyautogui


def _session_id() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def _normalize_key(name: str) -> str:
    mapping = {
        "Return": "enter",
        "BackSpace": "backspace",
        "Escape": "esc",
        "Delete": "delete",
        "Tab": "tab",
        "space": "space",
        "Shift_L": "shift",
        "Shift_R": "shift",
        "Control_L": "ctrl",
        "Control_R": "ctrl",
        "Alt_L": "alt",
        "Alt_R": "alt",
        "Left": "left",
        "Right": "right",
        "Up": "up",
        "Down": "down",
        "Home": "home",
        "End": "end",
        "Prior": "pageup",
        "Next": "pagedown",
        "F1": "f1",
        "F2": "f2",
        "F3": "f3",
        "F4": "f4",
        "F5": "f5",
        "F6": "f6",
        "F7": "f7",
        "F8": "f8",
        "F9": "f9",
        "F10": "f10",
        "F11": "f11",
        "F12": "f12",
    }
    return mapping.get(name, name.lower() if len(name) == 1 else name.lower())


def _choose_permissions(requested: set[str], viewer_name: str, fingerprint: str) -> set[str]:
    print(f"Connection request from: {viewer_name}")
    print(f"Session fingerprint: {fingerprint}")
    if "control" not in requested:
        answer = input("Allow screen view? [y/N] ").strip().lower()
        return {"view"} if answer in {"y", "yes"} else set()

    print("Requested permissions: screen view + mouse/keyboard control")
    answer = input("Allow [v]iew only, [c]ontrol, or [n] deny? [n] ").strip().lower()
    if answer in {"c", "control", "y", "yes"}:
        return {"view", "control"}
    if answer in {"v", "view"}:
        return {"view"}
    return set()


def _select_monitor(mss_module, index: int):
    with mss_module.mss() as sct:
        monitors = list(sct.monitors)
    if index < 0 or index >= len(monitors):
        raise SystemExit(f"Invalid monitor {index}. Available indices: 0..{len(monitors)-1}")
    return monitors[index]


def _list_monitors() -> None:
    mss = _screen_backend()
    with mss.mss() as sct:
        print("RelayDesk monitors (0 is the entire virtual desktop):")
        for i, mon in enumerate(sct.monitors):
            print(f"  {i}: {mon['width']}x{mon['height']} at ({mon['left']},{mon['top']})")


async def run(args: argparse.Namespace) -> None:
    private_key, public_key = new_keypair()
    sid = _session_id()
    join_secret = secrets.token_urlsafe(32)
    invite = Invite(sid, join_secret, public_key)
    verifier = join_verifier(join_secret, sid)
    device_name = args.name or socket.gethostname()

    print("\nRelayDesk v0.2 attended support")
    print("================================")
    print(f"This PC: {device_name}")
    print(f"Session code: {sid}")
    print("Secure invite (send this only to the person you want to connect):")
    print(invite.encode())
    print("\nNo one can control this PC until you accept their request.\n")

    async with connect(args.server, max_size=4 * 1024 * 1024, compression=None) as ws:
        await ws.send(json.dumps({
            "type": "hello",
            "role": "host",
            "session_id": sid,
            "join_verifier": verifier,
            "public_key": public_key,
            "device_name": device_name,
        }, separators=(",", ":")))

        first = json.loads(await ws.recv())
        if first.get("type") != "host_ready":
            raise RuntimeError(first.get("message", "relay registration failed"))

        peer = None
        while peer is None:
            raw = await ws.recv()
            if not isinstance(raw, str):
                continue
            msg = json.loads(raw)
            if msg.get("type") == "peer_hello":
                peer = msg
            elif msg.get("type") == "error":
                raise RuntimeError(msg.get("message", "relay error"))

        viewer_name = str(peer.get("device_name", "Unknown device"))
        viewer_public = str(peer["public_key"])
        requested = {str(x) for x in peer.get("requested_permissions", ["view", "control"])}
        requested &= {"view", "control"}
        requested.add("view")
        fingerprint = short_fingerprint(public_key, viewer_public)
        granted = await asyncio.to_thread(_choose_permissions, requested, viewer_name, fingerprint)
        accepted = "view" in granted
        await ws.send(json.dumps({
            "type": "decision",
            "accept": accepted,
            "permissions": sorted(granted),
            "host_public_key": public_key,
            "fingerprint": fingerprint,
        }, separators=(",", ":")))
        if not accepted:
            print("Connection denied.")
            return

        crypto = SessionCrypto.from_exchange(private_key, viewer_public, sid, "host")
        control_allowed = "control" in granted
        print("\n*** REMOTE SESSION ACTIVE ***")
        print("Screen sharing is active.")
        print("Remote mouse/keyboard control is " + ("ENABLED." if control_allowed else "DISABLED (view only)."))
        print("Close this window or press Ctrl+C to end the session.\n")

        pyautogui = _input_backend() if control_allowed else None
        catalog = monitor_catalog()
        if args.monitor < 0 or args.monitor >= len(catalog):
            raise RuntimeError(f"invalid monitor {args.monitor}; available 0..{len(catalog)-1}")
        selected_monitor = args.monitor
        monitor = catalog[selected_monitor]
        await ws.send(crypto.seal(pack_json("monitor_list", {"monitors": catalog, "selected": selected_monitor})))
        stop = asyncio.Event()
        pressed_keys: set[str] = set()
        pressed_buttons: set[str] = set()

        def release_input_state() -> None:
            if not pyautogui:
                return
            for key in list(pressed_keys):
                try:
                    pyautogui.keyUp(key)
                except Exception:
                    pass
            pressed_keys.clear()
            for button in list(pressed_buttons):
                try:
                    pyautogui.mouseUp(button=button)
                except Exception:
                    pass
            pressed_buttons.clear()

        async def capture_loop() -> None:
            interval = 1.0 / max(1, min(args.fps, 20))
            quality = max(20, min(args.quality, 90))
            current_index = -1
            capture = None
            try:
                while not stop.is_set():
                    if current_index != selected_monitor:
                        if capture is not None:
                            capture.__exit__(None, None, None)
                        capture = create_capture(args.capture, selected_monitor)
                        capture.__enter__()
                        current_index = selected_monitor
                        print(f"Capture backend: {capture.info.backend}; monitor {current_index}")
                    started = time.monotonic()
                    image = capture.grab()
                    if image is None:
                        await asyncio.sleep(min(interval, 0.01))
                        continue
                    width, height = image.size
                    out = io.BytesIO()
                    image.save(out, format="JPEG", quality=quality, optimize=False)
                    header = b"F" + width.to_bytes(2, "big") + height.to_bytes(2, "big")
                    await ws.send(crypto.seal(header + out.getvalue()))
                    delay = interval - (time.monotonic() - started)
                    if delay > 0:
                        await asyncio.sleep(delay)
            finally:
                if capture is not None:
                    capture.__exit__(None, None, None)

        async def receive_loop() -> None:
            nonlocal selected_monitor, monitor
            try:
                async for raw in ws:
                    if isinstance(raw, str):
                        msg = json.loads(raw)
                        if msg.get("type") == "error":
                            print("Relay error:", msg.get("message"))
                        continue
                    try:
                        plain = crypto.open(raw)
                    except ReplayError as exc:
                        raise RuntimeError(f"session replay protection triggered: {exc}") from exc
                    except InvalidTag as exc:
                        raise RuntimeError("session authentication failed") from exc
                    if not plain.startswith(b"J"):
                        continue
                    kind, data = unpack_json(plain)
                    if kind == "select_monitor":
                        try:
                            candidate = int(data.get("index", -1))
                        except (TypeError, ValueError):
                            continue
                        if 0 <= candidate < len(catalog):
                            selected_monitor = candidate
                            monitor = catalog[candidate]
                            print(f"Remote viewer selected monitor {candidate}")
                        continue
                    if not control_allowed or not pyautogui:
                        continue
                    try:
                        if kind == "mouse_move":
                            x = max(0, min(int(data["x"]), monitor["width"] - 1)) + monitor["left"]
                            y = max(0, min(int(data["y"]), monitor["height"] - 1)) + monitor["top"]
                            pyautogui.moveTo(x, y, duration=0)
                        elif kind == "mouse_button":
                            button = str(data.get("button", "left"))
                            if button not in {"left", "middle", "right"}:
                                continue
                            if data.get("down"):
                                pyautogui.mouseDown(button=button)
                                pressed_buttons.add(button)
                            else:
                                pyautogui.mouseUp(button=button)
                                pressed_buttons.discard(button)
                        elif kind == "mouse_wheel":
                            pyautogui.scroll(max(-20, min(20, int(data.get("delta", 0)))))
                        elif kind == "key":
                            keyname = _normalize_key(str(data.get("key", "")))
                            if not keyname or len(keyname) > 32:
                                continue
                            if data.get("down"):
                                pyautogui.keyDown(keyname)
                                pressed_keys.add(keyname)
                            else:
                                pyautogui.keyUp(keyname)
                                pressed_keys.discard(keyname)
                    except Exception as exc:
                        print(f"Input event ignored: {exc}")
            finally:
                release_input_state()
                stop.set()

        tasks = [asyncio.create_task(capture_loop()), asyncio.create_task(receive_loop())]
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            stop.set()
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
        finally:
            release_input_state()


def main() -> None:
    parser = argparse.ArgumentParser(description="RelayDesk v0.2 attended Windows host")
    parser.add_argument("--server", default="ws://127.0.0.1:8765", help="Relay WebSocket URL")
    parser.add_argument("--name", default=f"{platform.node()} (host)")
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--quality", type=int, default=58)
    parser.add_argument("--monitor", type=int, default=1, help="monitor index; 0 = whole virtual desktop (mss)")
    parser.add_argument("--capture", choices=["auto", "dxgi", "mss"], default="auto", help="capture backend; auto prefers DXGI on Windows")
    parser.add_argument("--list-monitors", action="store_true")
    args = parser.parse_args()
    if args.list_monitors:
        _list_monitors()
        return
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nSession ended locally.")


if __name__ == "__main__":
    main()
