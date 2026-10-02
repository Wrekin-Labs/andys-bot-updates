from __future__ import annotations

import argparse
import asyncio
import io
import json
import platform
import secrets
import socket
import threading
import time
import tkinter as tk
from tkinter import messagebox

from cryptography.exceptions import InvalidTag
from capture_backend import create_capture, monitor_catalog
from PIL import Image
from websockets.asyncio.client import connect

from host import _input_backend, _normalize_key, _screen_backend, _select_monitor, _session_id
from shared import Invite, ReplayError, SessionCrypto, join_verifier, new_keypair, pack_json, short_fingerprint, unpack_json


class HostApp:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.stop = threading.Event()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.ws = None
        self.approval_events: list[threading.Event] = []

        self.root = tk.Tk()
        self.root.title("RelayDesk v0.2 — Share this PC")
        self.root.geometry("720x520")
        self.root.minsize(680, 480)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.status = tk.StringVar(value="Starting secure session…")
        self.session_id = tk.StringVar(value="—")
        self.invite = tk.StringVar(value="")
        self.permissions = tk.StringVar(value="No active remote session")

        header = tk.Frame(self.root, padx=20, pady=18)
        header.pack(fill="x")
        tk.Label(header, text="RelayDesk", font=("Segoe UI", 22, "bold")).pack(anchor="w")
        tk.Label(header, text="Attended remote support", font=("Segoe UI", 11)).pack(anchor="w")

        card = tk.LabelFrame(self.root, text="Give this to your support person", padx=16, pady=14)
        card.pack(fill="x", padx=20, pady=(0, 12))
        row = tk.Frame(card)
        row.pack(fill="x")
        tk.Label(row, text="Session", font=("Segoe UI", 10)).pack(side="left")
        tk.Label(row, textvariable=self.session_id, font=("Consolas", 20, "bold")).pack(side="right")
        tk.Label(card, text="Secure invite", anchor="w").pack(fill="x", pady=(14, 4))
        invite_entry = tk.Entry(card, textvariable=self.invite, state="readonly", font=("Consolas", 9))
        invite_entry.pack(fill="x")
        buttons = tk.Frame(card)
        buttons.pack(fill="x", pady=(10, 0))
        tk.Button(buttons, text="Copy secure invite", command=self.copy_invite).pack(side="left")

        state = tk.LabelFrame(self.root, text="Session status", padx=16, pady=14)
        state.pack(fill="x", padx=20, pady=(0, 12))
        tk.Label(state, textvariable=self.status, anchor="w", font=("Segoe UI", 11, "bold")).pack(fill="x")
        tk.Label(state, textvariable=self.permissions, anchor="w").pack(fill="x", pady=(6, 0))

        safety = tk.LabelFrame(self.root, text="Safety", padx=16, pady=12)
        safety.pack(fill="x", padx=20, pady=(0, 12))
        tk.Label(
            safety,
            text=(
                "Nothing can control this PC until you approve the incoming request. "
                "RelayDesk stays visibly open while the session is active."
            ),
            wraplength=640,
            justify="left",
        ).pack(anchor="w")

        bottom = tk.Frame(self.root, padx=20, pady=10)
        bottom.pack(fill="x")
        tk.Button(bottom, text="End / close", command=self.close, width=16).pack(side="right")

        threading.Thread(target=self._network_thread, daemon=True).start()

    def _ui(self, fn) -> None:
        if self.stop.is_set():
            return
        try:
            self.root.after(0, fn)
        except tk.TclError:
            pass

    def copy_invite(self) -> None:
        token = self.invite.get().strip()
        if not token:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(token)
        self.status.set("Secure invite copied to clipboard")

    async def _ask_permission(self, viewer_name: str, fingerprint: str, requested: set[str]) -> set[str]:
        event = threading.Event()
        result: dict[str, set[str]] = {"value": set()}
        self.approval_events.append(event)

        def show() -> None:
            if self.stop.is_set():
                event.set()
                return
            dialog = tk.Toplevel(self.root)
            dialog.title("Incoming RelayDesk request")
            dialog.geometry("520x330")
            dialog.transient(self.root)
            dialog.grab_set()
            dialog.protocol("WM_DELETE_WINDOW", lambda: choose(set()))

            tk.Label(dialog, text="Incoming support request", font=("Segoe UI", 17, "bold")).pack(
                anchor="w", padx=20, pady=(20, 6)
            )
            tk.Label(dialog, text=f"From: {viewer_name}", font=("Segoe UI", 11)).pack(anchor="w", padx=20)
            tk.Label(dialog, text=f"Fingerprint: {fingerprint}", font=("Consolas", 10)).pack(
                anchor="w", padx=20, pady=(8, 0)
            )
            requested_text = "Screen view + mouse/keyboard control" if "control" in requested else "Screen view only"
            tk.Label(dialog, text=f"Requested: {requested_text}", wraplength=470, justify="left").pack(
                anchor="w", padx=20, pady=(16, 8)
            )
            tk.Label(
                dialog,
                text="Only approve if you recognise the person asking to connect.",
                wraplength=470,
                justify="left",
            ).pack(anchor="w", padx=20, pady=(0, 14))

            def choose(value: set[str]) -> None:
                result["value"] = value
                try:
                    dialog.grab_release()
                    dialog.destroy()
                except tk.TclError:
                    pass
                event.set()

            actions = tk.Frame(dialog)
            actions.pack(fill="x", padx=20, pady=10)
            tk.Button(actions, text="Deny", command=lambda: choose(set()), width=12).pack(side="right")
            if "control" in requested:
                tk.Button(actions, text="View only", command=lambda: choose({"view"}), width=12).pack(
                    side="right", padx=(0, 8)
                )
                tk.Button(
                    actions,
                    text="Allow control",
                    command=lambda: choose({"view", "control"}),
                    width=14,
                ).pack(side="right", padx=(0, 8))
            else:
                tk.Button(actions, text="Allow view", command=lambda: choose({"view"}), width=14).pack(
                    side="right", padx=(0, 8)
                )

        self._ui(show)
        await asyncio.to_thread(event.wait)
        try:
            self.approval_events.remove(event)
        except ValueError:
            pass
        return result["value"]

    def _network_thread(self) -> None:
        try:
            asyncio.run(self._network())
        except Exception as exc:
            if not self.stop.is_set():
                self._ui(lambda: messagebox.showerror("RelayDesk", str(exc), parent=self.root))
                self._ui(lambda: self.status.set("Session stopped because of an error"))

    async def _network(self) -> None:
        self.loop = asyncio.get_running_loop()
        private_key, public_key = new_keypair()
        sid = _session_id()
        join_secret = secrets.token_urlsafe(32)
        token = Invite(sid, join_secret, public_key).encode()
        verifier = join_verifier(join_secret, sid)
        device_name = self.args.name or socket.gethostname()

        self._ui(lambda: self.session_id.set(sid))
        self._ui(lambda: self.invite.set(token))
        self._ui(lambda: self.status.set("Waiting for a support person to connect…"))

        async with connect(self.args.server, max_size=4 * 1024 * 1024, compression=None) as ws:
            self.ws = ws
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
            while peer is None and not self.stop.is_set():
                raw = await ws.recv()
                if not isinstance(raw, str):
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "peer_hello":
                    peer = msg
                elif msg.get("type") == "error":
                    raise RuntimeError(msg.get("message", "relay error"))
            if peer is None:
                return

            viewer_name = str(peer.get("device_name", "Unknown device"))
            viewer_public = str(peer["public_key"])
            requested = {str(x) for x in peer.get("requested_permissions", ["view", "control"])}
            requested &= {"view", "control"}
            requested.add("view")
            fingerprint = short_fingerprint(public_key, viewer_public)
            self._ui(lambda: self.status.set(f"Connection request from {viewer_name}"))
            granted = await self._ask_permission(viewer_name, fingerprint, requested)
            accepted = "view" in granted
            await ws.send(json.dumps({
                "type": "decision",
                "accept": accepted,
                "permissions": sorted(granted),
                "host_public_key": public_key,
                "fingerprint": fingerprint,
            }, separators=(",", ":")))
            if not accepted:
                self._ui(lambda: self.status.set("Connection denied — waiting ended"))
                return

            crypto = SessionCrypto.from_exchange(private_key, viewer_public, sid, "host")
            control_allowed = "control" in granted
            self._ui(lambda: self.status.set(f"Connected securely to {viewer_name}"))
            self._ui(
                lambda: self.permissions.set(
                    "Screen sharing + remote control" if control_allowed else "Screen sharing only (view only)"
                )
            )

            pyautogui = _input_backend() if control_allowed else None
            catalog = monitor_catalog()
            if self.args.monitor < 0 or self.args.monitor >= len(catalog):
                raise RuntimeError(f"invalid monitor {self.args.monitor}; available 0..{len(catalog)-1}")
            selected_monitor = self.args.monitor
            monitor = catalog[selected_monitor]
            await ws.send(crypto.seal(pack_json("monitor_list", {"monitors": catalog, "selected": selected_monitor})))
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
                interval = 1.0 / max(1, min(self.args.fps, 20))
                quality = max(20, min(self.args.quality, 90))
                current_index = -1
                capture = None
                try:
                    while not self.stop.is_set():
                        if current_index != selected_monitor:
                            if capture is not None:
                                capture.__exit__(None, None, None)
                            capture = create_capture(self.args.capture, selected_monitor)
                            capture.__enter__()
                            current_index = selected_monitor
                            self._ui(lambda: self.permissions.set(
                                ("Screen sharing + remote control" if control_allowed else "Screen sharing only (view only)")
                                + f" · capture {capture.info.backend.upper()} · monitor {current_index}"
                            ))
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
                            continue
                        try:
                            plain = crypto.open(raw)
                        except ReplayError as exc:
                            raise RuntimeError(f"replay protection triggered: {exc}") from exc
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
                        except Exception:
                            pass
                finally:
                    release_input_state()

            tasks = [asyncio.create_task(capture_loop()), asyncio.create_task(receive_loop())]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    task.result()
            finally:
                release_input_state()
                if not self.stop.is_set():
                    self._ui(lambda: self.status.set("Remote session ended"))
                    self._ui(lambda: self.permissions.set("No active remote session"))

    def close(self) -> None:
        if self.stop.is_set():
            return
        self.stop.set()
        for event in list(self.approval_events):
            event.set()
        if self.loop and self.ws:
            try:
                asyncio.run_coroutine_threadsafe(self.ws.close(), self.loop)
            except Exception:
                pass
        try:
            self.root.destroy()
        except tk.TclError:
            pass

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    parser = argparse.ArgumentParser(description="RelayDesk v0.2 GUI host")
    parser.add_argument("--server", default="ws://127.0.0.1:8765")
    parser.add_argument("--name", default=f"{platform.node()} (host)")
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--quality", type=int, default=58)
    parser.add_argument("--monitor", type=int, default=1)
    parser.add_argument("--capture", choices=["auto", "dxgi", "mss"], default="auto")
    args = parser.parse_args()
    HostApp(args).run()


if __name__ == "__main__":
    main()
