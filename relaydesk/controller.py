from __future__ import annotations

import argparse
import asyncio
import io
import json
import platform
import queue
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from tkinter import messagebox, ttk

from cryptography.exceptions import InvalidTag
from PIL import Image, ImageTk
from websockets.asyncio.client import connect

from shared import (
    Invite,
    ReplayError,
    SessionCrypto,
    join_verifier,
    new_keypair,
    pack_json,
    short_fingerprint,
    unpack_json,
)


@dataclass
class Frame:
    width: int
    height: int
    jpeg: bytes


class ControllerApp:
    def __init__(self, args: argparse.Namespace, invite: Invite | None, session_id: str | None = None):
        self.args = args
        self.invite = invite
        self.session_id = invite.session_id if invite is not None else str(session_id or "")
        if not (len(self.session_id) == 6 and self.session_id.isdigit()):
            raise ValueError("session code must be exactly 6 digits")
        self.private_key, self.public_key = new_keypair()
        self.frames: queue.Queue[Frame] = queue.Queue(maxsize=2)
        self.outgoing: queue.Queue[bytes] = queue.Queue(maxsize=1000)
        self.stop = threading.Event()
        self.crypto: SessionCrypto | None = None
        self.control_allowed = False
        self.remote_w = 1
        self.remote_h = 1
        self.draw_w = 1
        self.draw_h = 1
        self.offset_x = 0
        self.offset_y = 0
        self.last_move = 0.0
        self.frame_counter = 0
        self.fps_window_start = time.monotonic()
        self.current_fps = 0.0
        self.monitor_values: dict[str, int] = {}

        self.root = tk.Tk()
        self.root.title(f"RelayDesk v0.2 — session {self.session_id}")
        self.root.geometry("1200x760")
        self.root.minsize(720, 480)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        top = tk.Frame(self.root, padx=8, pady=6)
        top.pack(fill="x")
        self.status = tk.StringVar(value="Connecting…")
        self.metrics = tk.StringVar(value="")
        tk.Label(top, textvariable=self.status, anchor="w").pack(side="left", fill="x", expand=True)
        tk.Button(top, text="End session", command=self.close).pack(side="right", padx=(8, 0))
        tk.Label(top, textvariable=self.metrics, anchor="e").pack(side="right", padx=(8, 8))
        self.monitor_var = tk.StringVar(value="Screen")
        self.monitor_combo = ttk.Combobox(
            top, textvariable=self.monitor_var, state="disabled", width=24, values=[]
        )
        self.monitor_combo.pack(side="right", padx=(8, 0))
        self.monitor_combo.bind("<<ComboboxSelected>>", self._monitor_selected)

        self.canvas = tk.Canvas(self.root, bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.focus_set()
        self._bind_input()
        self._photo = None
        self.root.after(30, self._poll_frames)

        threading.Thread(target=self._network_thread, daemon=True).start()

    def _bind_input(self) -> None:
        self.canvas.bind("<Motion>", self._mouse_move)
        for button, name in [(1, "left"), (2, "middle"), (3, "right")]:
            self.canvas.bind(f"<ButtonPress-{button}>", lambda e, n=name: self._mouse_button(n, True))
            self.canvas.bind(f"<ButtonRelease-{button}>", lambda e, n=name: self._mouse_button(n, False))
        self.canvas.bind("<MouseWheel>", self._mouse_wheel)
        self.canvas.bind("<Button-4>", lambda _e: self._send_control("mouse_wheel", delta=1))
        self.canvas.bind("<Button-5>", lambda _e: self._send_control("mouse_wheel", delta=-1))
        self.canvas.bind("<KeyPress>", lambda e: self._send_control("key", key=e.keysym, down=True))
        self.canvas.bind("<KeyRelease>", lambda e: self._send_control("key", key=e.keysym, down=False))

    def _to_remote(self, x: int, y: int) -> tuple[int, int] | None:
        if not (self.offset_x <= x < self.offset_x + self.draw_w and self.offset_y <= y < self.offset_y + self.draw_h):
            return None
        rx = int((x - self.offset_x) * self.remote_w / max(1, self.draw_w))
        ry = int((y - self.offset_y) * self.remote_h / max(1, self.draw_h))
        return max(0, min(self.remote_w - 1, rx)), max(0, min(self.remote_h - 1, ry))

    def _mouse_move(self, event: tk.Event) -> None:
        if not self.control_allowed:
            return
        now = time.monotonic()
        if now - self.last_move < 0.025:
            return
        self.last_move = now
        pos = self._to_remote(event.x, event.y)
        if pos:
            self._send_control("mouse_move", x=pos[0], y=pos[1])

    def _mouse_button(self, button: str, down: bool) -> None:
        self._send_control("mouse_button", button=button, down=down)

    def _mouse_wheel(self, event: tk.Event) -> None:
        delta = 1 if event.delta > 0 else -1
        self._send_control("mouse_wheel", delta=delta)

    def _send_control(self, kind: str, **data) -> None:
        self._send_json(kind, require_control=True, **data)

    def _send_json(self, kind: str, require_control: bool = False, **data) -> None:
        if not self.crypto or (require_control and not self.control_allowed):
            return
        packet = self.crypto.seal(pack_json(kind, data))
        try:
            self.outgoing.put_nowait(packet)
        except queue.Full:
            # High-frequency UI control is intentionally lossy under congestion.
            pass

    def _monitor_selected(self, _event=None) -> None:
        index = self.monitor_values.get(self.monitor_var.get())
        if index is not None:
            self._send_json("select_monitor", index=index)

    def _set_monitor_catalog(self, monitors: list[dict], selected: int) -> None:
        values: list[str] = []
        mapping: dict[str, int] = {}
        for mon in monitors:
            try:
                idx = int(mon["index"])
                width = int(mon["width"])
                height = int(mon["height"])
            except (KeyError, TypeError, ValueError):
                continue
            label = (
                f"All screens — {width}×{height}"
                if idx == 0
                else f"Screen {idx} — {width}×{height}"
            )
            values.append(label)
            mapping[label] = idx
        self.monitor_values = mapping
        self.monitor_combo.configure(values=values, state="readonly" if values else "disabled")
        for label, idx in mapping.items():
            if idx == selected:
                self.monitor_var.set(label)
                break

    def _poll_frames(self) -> None:
        latest = None
        try:
            while True:
                latest = self.frames.get_nowait()
        except queue.Empty:
            pass
        if latest:
            image = Image.open(io.BytesIO(latest.jpeg)).convert("RGB")
            self.remote_w, self.remote_h = latest.width, latest.height
            cw = max(1, self.canvas.winfo_width())
            ch = max(1, self.canvas.winfo_height())
            scale = min(cw / self.remote_w, ch / self.remote_h)
            self.draw_w = max(1, int(self.remote_w * scale))
            self.draw_h = max(1, int(self.remote_h * scale))
            self.offset_x = (cw - self.draw_w) // 2
            self.offset_y = (ch - self.draw_h) // 2
            image = image.resize((self.draw_w, self.draw_h), Image.Resampling.BILINEAR)
            self._photo = ImageTk.PhotoImage(image)
            self.canvas.delete("all")
            self.canvas.create_image(self.offset_x, self.offset_y, image=self._photo, anchor="nw")

            self.frame_counter += 1
            now = time.monotonic()
            elapsed = now - self.fps_window_start
            if elapsed >= 1.0:
                self.current_fps = self.frame_counter / elapsed
                self.frame_counter = 0
                self.fps_window_start = now
                mode = "control" if self.control_allowed else "view only"
                self.metrics.set(f"{self.remote_w}×{self.remote_h} · {self.current_fps:.1f} fps · {mode}")
        if not self.stop.is_set():
            self.root.after(30, self._poll_frames)

    def _network_thread(self) -> None:
        try:
            asyncio.run(self._network())
        except Exception as exc:
            if not self.stop.is_set():
                self.root.after(0, lambda: messagebox.showerror("RelayDesk", str(exc)))
                self.root.after(0, self.close)

    async def _network(self) -> None:
        requested = ["view"] if self.args.view_only else ["view", "control"]
        code_join = self.invite is None
        verifier = "" if code_join else join_verifier(self.invite.join_secret, self.session_id)
        async with connect(self.args.server, max_size=4 * 1024 * 1024, compression=None) as ws:
            await ws.send(json.dumps({
                "type": "hello",
                "role": "viewer",
                "session_id": self.session_id,
                "join_mode": "code" if code_join else "invite",
                "join_verifier": verifier,
                "public_key": self.public_key,
                "device_name": self.args.name,
                "requested_permissions": requested,
            }, separators=(",", ":")))

            host = json.loads(await ws.recv())
            if host.get("type") == "error":
                raise RuntimeError(host.get("message", "relay error"))
            if host.get("type") != "host_hello":
                raise RuntimeError("unexpected relay response")
            host_hello_key = str(host.get("public_key", ""))
            if self.invite is not None and host_hello_key != self.invite.host_public_key:
                raise RuntimeError("host identity does not match the secure invite")

            decision = json.loads(await ws.recv())
            if decision.get("type") != "decision":
                raise RuntimeError("host did not send an access decision")
            if not decision.get("accept"):
                raise RuntimeError("the remote user denied the connection")
            host_public = str(decision.get("host_public_key", ""))
            expected_host_key = self.invite.host_public_key if self.invite is not None else host_hello_key
            if not expected_host_key or host_public != expected_host_key:
                raise RuntimeError("host key changed during approval")

            expected = short_fingerprint(self.public_key, host_public)
            if decision.get("fingerprint") != expected:
                raise RuntimeError("session fingerprint mismatch")
            granted = {str(x) for x in decision.get("permissions", ["view"])}
            if "view" not in granted:
                raise RuntimeError("host did not grant screen viewing")
            self.control_allowed = "control" in granted
            self.crypto = SessionCrypto.from_exchange(
                self.private_key, host_public, self.session_id, "viewer"
            )
            mode = "screen + control" if self.control_allowed else "view only"
            self.root.after(0, lambda: self.status.set(f"Connected securely ({mode}) — {expected}"))

            async def sender() -> None:
                while not self.stop.is_set():
                    try:
                        packet = await asyncio.to_thread(self.outgoing.get, True, 0.2)
                    except queue.Empty:
                        continue
                    await ws.send(packet)

            async def receiver() -> None:
                async for raw in ws:
                    if not isinstance(raw, bytes):
                        continue
                    try:
                        plain = self.crypto.open(raw)
                    except ReplayError as exc:
                        raise RuntimeError(f"session replay protection triggered: {exc}") from exc
                    except InvalidTag as exc:
                        raise RuntimeError("session authentication failed") from exc
                    if plain.startswith(b"J"):
                        kind, data = unpack_json(plain)
                        if kind == "monitor_list":
                            monitors = data.get("monitors", [])
                            try:
                                selected = int(data.get("selected", 1))
                            except (TypeError, ValueError):
                                selected = 1
                            if isinstance(monitors, list):
                                self.root.after(0, lambda m=monitors, s=selected: self._set_monitor_catalog(m, s))
                        continue
                    if plain.startswith(b"F") and len(plain) > 5:
                        width = int.from_bytes(plain[1:3], "big")
                        height = int.from_bytes(plain[3:5], "big")
                        if width <= 0 or height <= 0 or width > 16384 or height > 16384:
                            raise RuntimeError("invalid remote frame dimensions")
                        frame = Frame(width, height, plain[5:])
                        while self.frames.full():
                            try:
                                self.frames.get_nowait()
                            except queue.Empty:
                                break
                        self.frames.put_nowait(frame)

            tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()

    def close(self) -> None:
        if self.stop.is_set():
            return
        self.stop.set()
        try:
            self.root.destroy()
        except tk.TclError:
            pass

    def run(self) -> None:
        self.root.mainloop()


def _prompt_connection(default_server: str) -> tuple[str, str, bool] | None:
    root = tk.Tk()
    root.title("RelayDesk — Connect")
    root.geometry("620x300")
    root.resizable(False, False)
    result: dict[str, object] = {}

    tk.Label(root, text="Connect to another PC", font=("Segoe UI", 18, "bold")).pack(
        anchor="w", padx=20, pady=(20, 6)
    )
    tk.Label(
        root,
        text="Paste the secure RelayDesk invite supplied by the person at the remote PC.",
        anchor="w",
    ).pack(fill="x", padx=20)

    invite_var = tk.StringVar()
    server_var = tk.StringVar(value=default_server)
    view_only_var = tk.BooleanVar(value=False)

    tk.Label(root, text="Secure invite").pack(anchor="w", padx=20, pady=(14, 2))
    invite_entry = tk.Entry(root, textvariable=invite_var, font=("Consolas", 10))
    invite_entry.pack(fill="x", padx=20)
    tk.Label(root, text="Relay server").pack(anchor="w", padx=20, pady=(10, 2))
    tk.Entry(root, textvariable=server_var).pack(fill="x", padx=20)
    tk.Checkbutton(root, text="Request view only (no mouse/keyboard control)", variable=view_only_var).pack(
        anchor="w", padx=20, pady=8
    )

    def connect_now() -> None:
        token = invite_var.get().strip()
        try:
            Invite.decode(token)
        except Exception as exc:
            messagebox.showerror("RelayDesk", f"Invalid secure invite: {exc}", parent=root)
            return
        result["invite"] = token
        result["server"] = server_var.get().strip() or default_server
        result["view_only"] = bool(view_only_var.get())
        root.destroy()

    buttons = tk.Frame(root)
    buttons.pack(fill="x", padx=20, pady=(6, 14))
    tk.Button(buttons, text="Connect", command=connect_now, width=16).pack(side="right")
    tk.Button(buttons, text="Cancel", command=root.destroy, width=12).pack(side="right", padx=(0, 8))
    invite_entry.focus_set()
    root.bind("<Return>", lambda _e: connect_now())
    root.mainloop()

    if "invite" not in result:
        return None
    return str(result["invite"]), str(result["server"]), bool(result["view_only"])


def main() -> None:
    parser = argparse.ArgumentParser(description="RelayDesk v0.2 controller")
    parser.add_argument("invite", nargs="?", help="Secure rd2_ invite copied from the host")
    parser.add_argument("--code", help="6-digit attended session code (trusted private relay only)")
    parser.add_argument("--server", default="ws://127.0.0.1:8765", help="Relay WebSocket URL")
    parser.add_argument("--name", default=f"{platform.node()} (controller)")
    parser.add_argument("--view-only", action="store_true", help="Request screen view only")
    args = parser.parse_args()
    if args.invite and args.code:
        parser.error("use either an invite or --code, not both")
    if args.code:
        code = str(args.code).strip()
        if not (len(code) == 6 and code.isdigit()):
            parser.error("--code must be exactly 6 digits")
        ControllerApp(args, None, code).run()
        return
    if not args.invite:
        chosen = _prompt_connection(args.server)
        if not chosen:
            return
        args.invite, args.server, args.view_only = chosen
    invite = Invite.decode(args.invite)
    ControllerApp(args, invite).run()


if __name__ == "__main__":
    main()
