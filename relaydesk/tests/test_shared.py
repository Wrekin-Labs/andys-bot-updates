import pytest
from cryptography.exceptions import InvalidTag

from shared import (
    Invite,
    ReplayError,
    SessionCrypto,
    join_verifier,
    new_keypair,
    short_fingerprint,
)


def test_invite_roundtrip():
    _, host_pub = new_keypair()
    token = Invite("123456", "z" * 32, host_pub).encode()
    assert token.startswith("rd2_")
    decoded = Invite.decode(token)
    assert decoded.session_id == "123456"
    assert decoded.host_public_key == host_pub


def test_both_sides_derive_directional_keys_and_encrypt():
    host_private, host_pub = new_keypair()
    viewer_private, viewer_pub = new_keypair()
    host = SessionCrypto.from_exchange(host_private, viewer_pub, "654321", "host")
    viewer = SessionCrypto.from_exchange(viewer_private, host_pub, "654321", "viewer")

    packet = host.seal(b"frame")
    assert viewer.open(packet) == b"frame"
    packet = viewer.seal(b"mouse")
    assert host.open(packet) == b"mouse"


def test_replayed_packet_is_rejected():
    host_private, host_pub = new_keypair()
    viewer_private, viewer_pub = new_keypair()
    host = SessionCrypto.from_exchange(host_private, viewer_pub, "111111", "host")
    viewer = SessionCrypto.from_exchange(viewer_private, host_pub, "111111", "viewer")
    packet = host.seal(b"frame")
    assert viewer.open(packet) == b"frame"
    with pytest.raises(ReplayError):
        viewer.open(packet)


def test_wrong_direction_key_cannot_open_packet():
    host_private, host_pub = new_keypair()
    viewer_private, viewer_pub = new_keypair()
    host = SessionCrypto.from_exchange(host_private, viewer_pub, "222222", "host")
    wrong_role = SessionCrypto.from_exchange(viewer_private, host_pub, "222222", "host")
    packet = host.seal(b"frame")
    with pytest.raises(InvalidTag):
        wrong_role.open(packet)


def test_join_verifier_is_session_bound_and_stable():
    assert join_verifier("secret-value-that-is-long-enough", "123456") == join_verifier(
        "secret-value-that-is-long-enough", "123456"
    )
    assert join_verifier("secret-value-that-is-long-enough", "123456") != join_verifier(
        "secret-value-that-is-long-enough", "654321"
    )


def test_fingerprint_is_order_independent():
    _, a = new_keypair()
    _, b = new_keypair()
    assert short_fingerprint(a, b) == short_fingerprint(b, a)


def test_capture_backend_resolution():
    from capture_backend import resolve_backend

    assert resolve_backend("auto", 1, system="Windows") == "dxgi"
    assert resolve_backend("auto", 0, system="Windows") == "mss"
    assert resolve_backend("auto", 1, system="Linux") == "mss"
    assert resolve_backend("mss", 1, system="Windows") == "mss"


def test_dxgi_backend_rejects_non_windows():
    from capture_backend import resolve_backend

    with pytest.raises(RuntimeError):
        resolve_backend("dxgi", 1, system="Linux")
