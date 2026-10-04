"""Protocol tests for the synthetic mock RF bridge (no Android device needed)."""
import json
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "rf_bridge"))
import mock_rf_bridge as bridge  # noqa: E402

PAIR = "abc123456789"
# Shared with WifiRfProtocolHardeningTest.v2CrossLanguageVector so Kotlin and Python agree.
VECTOR_KEY = bytes(range(32))
VECTOR_NONCE = "00112233445566778899aabbccddeeff"
VECTOR_JSON = '{"v":2,"source":"esp32-csi","seq":1,"epochMs":1800000000000,"sampleRateHz":20,"rssiDbm":-51}'
VECTOR_MAC = "ee2db01e92ca71b48f704a8c30006eef6da2a634aba677273de5b20f917d157e"


class MockBridgeTests(unittest.TestCase):
    def run_bridge(self, *extra, hello=None):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        args = bridge.parse_args(["--pair", PAIR, "--rate", "1000", "--once", *extra])
        thread = threading.Thread(target=bridge.serve, args=(args, server), daemon=True)
        thread.start()
        with socket.create_connection(server.getsockname(), timeout=5) as client:
            client.sendall((json.dumps(hello or {"type": "senseveil_hello", "v": 1, "pair": PAIR,
                                                  "nonce": VECTOR_NONCE, "maxV": 2}) + "\n").encode())
            lines = client.makefile("r", encoding="utf-8").read().splitlines()
        thread.join(5)
        server.close()
        return lines

    def test_frames_are_marked_synthetic_and_scripted_change_is_deterministic(self):
        lines = self.run_bridge("--frames", "40", "--change-after-frames", "30", "--seq-start", "7")
        frames = [json.loads(line) for line in lines]
        self.assertEqual(40, len(frames))
        self.assertTrue(all(f["synthetic"] and f["source"] == bridge.SOURCE for f in frames))
        self.assertEqual(list(range(7, 47)), [f["seq"] for f in frames])
        self.assertTrue(all(f["rssiDbm"] > -60 for f in frames[:30]))
        self.assertTrue(all(f["rssiDbm"] < -70 for f in frames[30:]))
        self.assertTrue(all(len(line) < 2048 for line in lines))

    def test_wrong_pair_gets_nothing(self):
        self.assertEqual([], self.run_bridge("--frames", "5", hello={"type": "senseveil_hello", "v": 1, "pair": "nope"}))

    def test_v2_frames_carry_valid_nonce_bound_mac(self):
        with tempfile.NamedTemporaryFile("w", suffix=".hex", delete=False) as key_file:
            key_file.write(VECTOR_KEY.hex())
        lines = self.run_bridge("--frames", "3", "--key-file", key_file.name)
        Path(key_file.name).unlink()
        self.assertEqual(3, len(lines))
        for line in lines:
            prefix, mac, payload = line.split(" ", 2)
            self.assertEqual("SV2", prefix)
            self.assertEqual(bridge.v2_mac(VECTOR_KEY, VECTOR_NONCE, payload), mac)
            self.assertNotEqual(bridge.v2_mac(VECTOR_KEY, "other-connection", payload), mac)
            self.assertNotIn("pair", json.loads(payload))

    def test_cross_language_vector(self):
        self.assertEqual(VECTOR_MAC, bridge.v2_mac(VECTOR_KEY, VECTOR_NONCE, VECTOR_JSON))


if __name__ == "__main__":
    unittest.main()
