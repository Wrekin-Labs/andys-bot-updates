import asyncio
import json
import secrets

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import relay_server
from shared import ReplayError, SessionCrypto, join_verifier, new_keypair


def test_encrypted_end_to_end_session_through_opaque_relay():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        async with serve(relay_server.handler, "127.0.0.1", 9878, compression=None):
            host_private, host_pub = new_keypair()
            viewer_private, viewer_pub = new_keypair()
            sid = "333333"
            secret = secrets.token_urlsafe(32)
            verifier = join_verifier(secret, sid)

            async with connect("ws://127.0.0.1:9878", compression=None) as host:
                await host.send(json.dumps({
                    "type": "hello", "role": "host", "session_id": sid,
                    "join_verifier": verifier, "public_key": host_pub, "device_name": "Host",
                }))
                assert json.loads(await host.recv())["type"] == "host_ready"

                async with connect("ws://127.0.0.1:9878", compression=None) as viewer:
                    await viewer.send(json.dumps({
                        "type": "hello", "role": "viewer", "session_id": sid,
                        "join_verifier": verifier, "public_key": viewer_pub, "device_name": "Viewer",
                        "requested_permissions": ["view", "control"],
                    }))
                    assert json.loads(await viewer.recv())["type"] == "host_hello"
                    assert json.loads(await host.recv())["type"] == "peer_hello"
                    await host.send(json.dumps({
                        "type": "decision", "accept": True, "permissions": ["view", "control"],
                        "host_public_key": host_pub, "fingerprint": "not-used-in-this-test",
                    }))
                    assert json.loads(await viewer.recv())["accept"] is True

                    host_crypto = SessionCrypto.from_exchange(host_private, viewer_pub, sid, "host")
                    viewer_crypto = SessionCrypto.from_exchange(viewer_private, host_pub, sid, "viewer")

                    encrypted_frame = host_crypto.seal(b"F\x00\x10\x00\x10jpeg-bytes")
                    await host.send(encrypted_frame)
                    relayed_frame = await viewer.recv()
                    assert relayed_frame == encrypted_frame
                    assert viewer_crypto.open(relayed_frame).endswith(b"jpeg-bytes")

                    encrypted_input = viewer_crypto.seal(b'J{"kind":"mouse_move","x":3,"y":4}')
                    await viewer.send(encrypted_input)
                    relayed_input = await host.recv()
                    assert relayed_input == encrypted_input
                    assert host_crypto.open(relayed_input).startswith(b"J")

    asyncio.run(scenario())


def test_relay_cannot_make_replayed_ciphertext_acceptable():
    async def scenario():
        relay_server.SESSIONS.clear()
        relay_server.FAILED_JOINS.clear()
        async with serve(relay_server.handler, "127.0.0.1", 9879, compression=None):
            host_private, host_pub = new_keypair()
            viewer_private, viewer_pub = new_keypair()
            sid = "444444"
            secret = secrets.token_urlsafe(32)
            verifier = join_verifier(secret, sid)

            async with connect("ws://127.0.0.1:9879", compression=None) as host:
                await host.send(json.dumps({
                    "type": "hello", "role": "host", "session_id": sid,
                    "join_verifier": verifier, "public_key": host_pub, "device_name": "Host",
                }))
                await host.recv()
                async with connect("ws://127.0.0.1:9879", compression=None) as viewer:
                    await viewer.send(json.dumps({
                        "type": "hello", "role": "viewer", "session_id": sid,
                        "join_verifier": verifier, "public_key": viewer_pub, "device_name": "Viewer",
                        "requested_permissions": ["view"],
                    }))
                    await viewer.recv()
                    await host.recv()
                    await host.send(json.dumps({
                        "type": "decision", "accept": True, "permissions": ["view"],
                        "host_public_key": host_pub, "fingerprint": "test",
                    }))
                    await viewer.recv()

                    host_crypto = SessionCrypto.from_exchange(host_private, viewer_pub, sid, "host")
                    viewer_crypto = SessionCrypto.from_exchange(viewer_private, host_pub, sid, "viewer")
                    packet = host_crypto.seal(b"one frame")
                    await host.send(packet)
                    first = await viewer.recv()
                    assert viewer_crypto.open(first) == b"one frame"

                    # Simulate a malicious/interfering relay replaying the exact ciphertext.
                    with pytest.raises(ReplayError):
                        viewer_crypto.open(first)

    asyncio.run(scenario())
