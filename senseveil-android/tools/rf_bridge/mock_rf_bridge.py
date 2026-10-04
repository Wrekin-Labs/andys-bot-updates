#!/usr/bin/env python3
"""SenseVeil mock RF bridge.

Generates synthetic RF telemetry only for transport/UI testing.
It is not CSI capture hardware and must not be used as evidence of presence.
Every frame carries "synthetic": true and the source "mock-rf-not-real-csi"; SenseVeil labels
such frames SYNTHETIC in evidence regardless of the measurements they contain.

Protocol v1: newline-delimited JSON carrying the plaintext pair code (prevents accidental
cross-feed only; NOT authentication).
Protocol v2 (--key-file): each line is  "SV2 <hex HMAC-SHA256> <json>"  where the MAC is
HMAC(key, "senseveil-rf-v2\\n" + <nonce from the phone's hello> + "\\n" + <exact json bytes>).
The nonce binds frames to one TCP connection so recorded frames cannot be replayed later.
"""

import argparse
import hashlib
import hmac
import json
import math
import socket
import time

SOURCE = "mock-rf-not-real-csi"
V2_CONTEXT = b"senseveil-rf-v2\n"


def parse_args(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--pair", required=True, help="Pair code shown by SenseVeil")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=20.0)
    p.add_argument("--change-after", type=float, default=0.0,
                   help="Seconds after connection to inject a synthetic RF change; 0 disables")
    p.add_argument("--change-after-frames", type=int, default=0,
                   help="Deterministic alternative to --change-after: inject the change from this frame on")
    p.add_argument("--frames", type=int, default=0, help="Close the connection after N frames (0 = never)")
    p.add_argument("--seq-start", type=int, default=0, help="First sequence number (test counter restarts)")
    p.add_argument("--key-file", help="File holding the v2 bridge key as hex (never commit it). Enables v2 frames.")
    p.add_argument("--once", action="store_true", help="Serve one connection then exit (for automated tests)")
    return p.parse_args(argv)


def v2_mac(key: bytes, nonce: str, payload: str) -> str:
    return hmac.new(key, V2_CONTEXT + nonce.encode() + b"\n" + payload.encode(), hashlib.sha256).hexdigest()


def sample(args, seq: int, index: int, elapsed: float, version: int) -> dict:
    changed = ((args.change_after_frames > 0 and index >= args.change_after_frames) or
               (args.change_after > 0 and elapsed >= args.change_after))
    wobble = math.sin(index * 0.1) * 0.3
    frame = {"v": version}
    if version == 1:
        frame["pair"] = args.pair
    frame.update({
        "source": SOURCE,
        "synthetic": True,
        "seq": seq,
        "epochMs": int(time.time() * 1000),
        "sampleRateHz": args.rate,
        "rssiDbm": round((-50.0 if not changed else -76.0) + wobble, 3),
        "csiAmplitude": round((1.0 if not changed else 1.75) + wobble * 0.01, 5),
        "csiVariance": 0.02 if not changed else 0.18,
    })
    return frame


def send_session(conn, args, key=None):
    hello = conn.makefile("r", encoding="utf-8", newline="\n").readline()
    try:
        msg = json.loads(hello)
    except Exception:
        return
    if msg.get("type") != "senseveil_hello" or msg.get("v") != 1 or msg.get("pair") != args.pair:
        return
    nonce = msg.get("nonce", "")
    if key is not None and (msg.get("maxV", 1) < 2 or not nonce):
        print("phone does not offer protocol v2; refusing to send unauthenticated frames")
        return

    period = 1.0 / max(args.rate, 1.0)
    start = time.monotonic()
    index = 0
    while args.frames <= 0 or index < args.frames:
        frame = sample(args, args.seq_start + index, index, time.monotonic() - start, 2 if key else 1)
        payload = json.dumps(frame, separators=(",", ":"))
        line = f"SV2 {v2_mac(key, nonce, payload)} {payload}" if key else payload
        conn.sendall((line + "\n").encode("utf-8"))
        index += 1
        time.sleep(period)


def serve(args, server):
    key = bytes.fromhex(open(args.key_file, encoding="utf-8").read().strip()) if args.key_file else None
    if key is not None and len(key) < 16:
        raise SystemExit("v2 key must be at least 16 bytes (32 hex chars)")
    while True:
        conn, addr = server.accept()
        print("phone connected:", addr[0])
        with conn:
            try:
                send_session(conn, args, key)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
        print("phone disconnected")
        if args.once:
            return


def main(argv=None):
    args = parse_args(argv)
    if not 1 <= args.port <= 65535:
        raise SystemExit("port must be 1..65535")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.host, args.port))
        server.listen(1)
        print(f"SenseVeil mock RF bridge listening on {args.host}:{server.getsockname()[1]}")
        print("Synthetic test data only; not real CSI or presence detection.")
        serve(args, server)


if __name__ == "__main__":
    main()
