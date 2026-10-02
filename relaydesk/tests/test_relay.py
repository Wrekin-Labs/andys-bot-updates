import asyncio
import json
import secrets

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import relay_server
from shared import join_verifier, new_keypair


def test_relay_pairs_and_forwards_bidirectionally():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        async with serve(relay_server.handler, "127.0.0.1", 9876, compression=None):
            _, host_pub = new_keypair()
            _, viewer_pub = new_keypair()
            secret = secrets.token_urlsafe(32)
            sid = "123456"
            verifier = join_verifier(secret, sid)
            async with connect("ws://127.0.0.1:9876", compression=None) as host:
                await host.send(json.dumps({
                    "type": "hello", "role": "host", "session_id": sid,
                    "join_verifier": verifier, "public_key": host_pub, "device_name": "Host",
                }))
                assert json.loads(await host.recv())["type"] == "host_ready"
                async with connect("ws://127.0.0.1:9876", compression=None) as viewer:
                    await viewer.send(json.dumps({
                        "type": "hello", "role": "viewer", "session_id": sid,
                        "join_verifier": verifier, "public_key": viewer_pub, "device_name": "Viewer",
                        "requested_permissions": ["view", "control"],
                    }))
                    host_hello = json.loads(await viewer.recv())
                    assert host_hello["type"] == "host_hello"
                    peer_hello = json.loads(await host.recv())
                    assert peer_hello["type"] == "peer_hello"
                    assert peer_hello["requested_permissions"] == ["view", "control"]
                    await host.send(json.dumps({
                        "type": "decision", "accept": True,
                        "permissions": ["view", "control"],
                        "host_public_key": host_pub, "fingerprint": "test",
                    }))
                    decision = json.loads(await viewer.recv())
                    assert decision["accept"] is True
                    assert decision["permissions"] == ["view", "control"]
                    await host.send(b"encrypted-frame")
                    assert await viewer.recv() == b"encrypted-frame"
                    await viewer.send(b"encrypted-input")
                    assert await host.recv() == b"encrypted-input"
    asyncio.run(scenario())


def test_wrong_invite_is_rejected_without_consuming_session():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        async with serve(relay_server.handler, "127.0.0.1", 9877, compression=None):
            _, host_pub = new_keypair()
            _, viewer_pub = new_keypair()
            sid = "654321"
            good = join_verifier("good-secret-value-that-is-long-enough", sid)
            bad = join_verifier("wrong-secret-value-that-is-long-enough", sid)
            async with connect("ws://127.0.0.1:9877", compression=None) as host:
                await host.send(json.dumps({
                    "type": "hello", "role": "host", "session_id": sid,
                    "join_verifier": good, "public_key": host_pub, "device_name": "Host",
                }))
                assert json.loads(await host.recv())["type"] == "host_ready"
                async with connect("ws://127.0.0.1:9877", compression=None) as viewer:
                    await viewer.send(json.dumps({
                        "type": "hello", "role": "viewer", "session_id": sid,
                        "join_verifier": bad, "public_key": viewer_pub, "device_name": "Viewer",
                        "requested_permissions": ["view"],
                    }))
                    error = json.loads(await viewer.recv())
                    assert error["type"] == "error"
                    assert "invalid invite" in error["message"]
                assert sid in relay_server.SESSIONS
    asyncio.run(scenario())


def test_trusted_code_join_requires_private_relay_and_tailscale_or_loopback():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        old = relay_server.TRUSTED_CODE_JOIN
        relay_server.TRUSTED_CODE_JOIN = True
        try:
            async with serve(relay_server.handler, "127.0.0.1", 9878, compression=None):
                _, host_pub = new_keypair()
                _, viewer_pub = new_keypair()
                sid = "777777"
                verifier = join_verifier("good-secret-value-that-is-long-enough", sid)
                async with connect("ws://127.0.0.1:9878", compression=None) as host:
                    await host.send(json.dumps({
                        "type": "hello", "role": "host", "session_id": sid,
                        "join_verifier": verifier, "public_key": host_pub, "device_name": "Host",
                    }))
                    assert json.loads(await host.recv())["type"] == "host_ready"
                    async with connect("ws://127.0.0.1:9878", compression=None) as viewer:
                        await viewer.send(json.dumps({
                            "type": "hello", "role": "viewer", "session_id": sid,
                            "join_mode": "code", "join_verifier": "",
                            "public_key": viewer_pub, "device_name": "Viewer",
                            "requested_permissions": ["view"],
                        }))
                        assert json.loads(await viewer.recv())["type"] == "host_hello"
                        peer = json.loads(await host.recv())
                        assert peer["type"] == "peer_hello"
                        assert peer["requested_permissions"] == ["view"]
        finally:
            relay_server.TRUSTED_CODE_JOIN = old
    asyncio.run(scenario())


def test_code_join_is_disabled_by_default():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        old = relay_server.TRUSTED_CODE_JOIN
        relay_server.TRUSTED_CODE_JOIN = False
        try:
            async with serve(relay_server.handler, "127.0.0.1", 9879, compression=None):
                _, host_pub = new_keypair()
                _, viewer_pub = new_keypair()
                sid = "888888"
                verifier = join_verifier("good-secret-value-that-is-long-enough", sid)
                async with connect("ws://127.0.0.1:9879", compression=None) as host:
                    await host.send(json.dumps({
                        "type": "hello", "role": "host", "session_id": sid,
                        "join_verifier": verifier, "public_key": host_pub, "device_name": "Host",
                    }))
                    assert json.loads(await host.recv())["type"] == "host_ready"
                    async with connect("ws://127.0.0.1:9879", compression=None) as viewer:
                        await viewer.send(json.dumps({
                            "type": "hello", "role": "viewer", "session_id": sid,
                            "join_mode": "code", "join_verifier": "",
                            "public_key": viewer_pub, "device_name": "Viewer",
                            "requested_permissions": ["view"],
                        }))
                        error = json.loads(await viewer.recv())
                        assert error["type"] == "error"
                        assert "unavailable" in error["message"]
        finally:
            relay_server.TRUSTED_CODE_JOIN = old
    asyncio.run(scenario())
