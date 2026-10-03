#!/usr/bin/env python3
"""SenseVeil RC4 mock RF bridge.

Generates synthetic RF telemetry only for transport/UI testing.
It is not CSI capture hardware and must not be used as evidence of presence.
"""

import argparse
import json
import math
import socket
import time


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--pair", required=True, help="Pair code shown by SenseVeil")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=20.0)
    p.add_argument("--change-after", type=float, default=0.0,
                   help="Seconds after connection to inject a synthetic RF change; 0 disables")
    return p.parse_args()


def send_session(conn, args):
    hello = conn.makefile("r", encoding="utf-8", newline="\n").readline()
    try:
        msg = json.loads(hello)
    except Exception:
        return
    if msg.get("type") != "senseveil_hello" or msg.get("v") != 1 or msg.get("pair") != args.pair:
        return

    period = 1.0 / max(args.rate, 1.0)
    start = time.monotonic()
    seq = 0
    while True:
        elapsed = time.monotonic() - start
        changed = args.change_after > 0 and elapsed >= args.change_after
        wobble = math.sin(elapsed * 2.0) * 0.3
        sample = {
            "v": 1,
            "pair": args.pair,
            "source": "mock-rf-not-real-csi",
            "seq": seq,
            "epochMs": int(time.time() * 1000),
            "sampleRateHz": args.rate,
            "rssiDbm": (-50.0 if not changed else -76.0) + wobble,
            "csiAmplitude": (1.0 if not changed else 1.75) + wobble * 0.01,
            "csiVariance": 0.02 if not changed else 0.18,
        }
        conn.sendall((json.dumps(sample, separators=(",", ":")) + "\n").encode("utf-8"))
        seq += 1
        time.sleep(period)


def main():
    args = parse_args()
    if not 1 <= args.port <= 65535:
        raise SystemExit("port must be 1..65535")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.host, args.port))
        server.listen(1)
        print(f"SenseVeil mock RF bridge listening on {args.host}:{args.port}")
        print("Synthetic test data only; not real CSI or presence detection.")
        while True:
            conn, addr = server.accept()
            print("phone connected:", addr[0])
            with conn:
                try:
                    send_session(conn, args)
                except (BrokenPipeError, ConnectionResetError, TimeoutError):
                    pass
            print("phone disconnected")


if __name__ == "__main__":
    main()
