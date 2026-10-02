from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any, Literal

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PROTOCOL_VERSION = 2
AAD_PREFIX = b"relaydesk-v0.2"
Role = Literal["host", "viewer"]


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64u_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def public_key_bytes(private_key: X25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def new_keypair() -> tuple[X25519PrivateKey, str]:
    private = X25519PrivateKey.generate()
    return private, b64u_encode(public_key_bytes(private))


def join_verifier(join_secret: str, session_id: str) -> str:
    """Bearer verifier sent to the rendezvous server instead of the raw invite secret."""
    secret = join_secret.encode("utf-8")
    msg = f"relaydesk-join-v2:{session_id}".encode("ascii")
    return b64u_encode(hmac.new(secret, msg, hashlib.sha256).digest())


@dataclass(frozen=True)
class SessionKeys:
    host_to_viewer: bytes
    viewer_to_host: bytes


def derive_session_keys(
    private_key: X25519PrivateKey,
    peer_public_b64: str,
    session_id: str,
) -> SessionKeys:
    peer_raw = b64u_decode(peer_public_b64)
    if len(peer_raw) != 32:
        raise ValueError("invalid peer public key")
    peer = X25519PublicKey.from_public_bytes(peer_raw)
    shared = private_key.exchange(peer)
    own_raw = public_key_bytes(private_key)
    ordered = sorted((own_raw, peer_raw))
    transcript = (
        AAD_PREFIX
        + b"|sid="
        + session_id.encode("ascii")
        + b"|p1="
        + ordered[0]
        + b"|p2="
        + ordered[1]
    )
    material = HKDF(
        algorithm=hashes.SHA256(),
        length=64,
        salt=hashlib.sha256(transcript).digest(),
        info=b"relaydesk-directional-session-keys",
    ).derive(shared)
    return SessionKeys(material[:32], material[32:])


class ReplayError(ValueError):
    pass


class DirectionalCipher:
    """Ordered AEAD channel with deterministic per-key nonces and replay rejection.

    v0.2 currently runs over ordered WebSockets, so a strict monotonic receive counter
    is appropriate. A future UDP/QUIC transport should replace this with a replay window.
    """

    def __init__(self, key: bytes, label: bytes):
        if len(key) != 32:
            raise ValueError("session key must be 32 bytes")
        self._aead = AESGCM(key)
        self._label = label
        self._nonce_prefix = hashlib.sha256(AAD_PREFIX + b"|" + label).digest()[:4]
        self._send_seq = 0
        self._recv_seq = -1

    @property
    def last_received_sequence(self) -> int:
        return self._recv_seq

    def seal(self, payload: bytes) -> bytes:
        if self._send_seq >= (1 << 64) - 1:
            raise OverflowError("session sequence exhausted")
        self._send_seq += 1
        seq = self._send_seq
        seq_raw = seq.to_bytes(8, "big")
        nonce = self._nonce_prefix + seq_raw
        aad = AAD_PREFIX + b"|" + self._label + b"|" + seq_raw
        return seq_raw + self._aead.encrypt(nonce, payload, aad)

    def open(self, packet: bytes) -> bytes:
        if len(packet) < 8 + 16:
            raise ValueError("encrypted packet too short")
        seq_raw, ciphertext = packet[:8], packet[8:]
        seq = int.from_bytes(seq_raw, "big")
        if seq <= self._recv_seq:
            raise ReplayError(f"replayed/out-of-order packet {seq}")
        nonce = self._nonce_prefix + seq_raw
        aad = AAD_PREFIX + b"|" + self._label + b"|" + seq_raw
        plain = self._aead.decrypt(nonce, ciphertext, aad)
        self._recv_seq = seq
        return plain


class SessionCrypto:
    def __init__(self, keys: SessionKeys, role: Role):
        if role == "host":
            self._send = DirectionalCipher(keys.host_to_viewer, b"host-to-viewer")
            self._recv = DirectionalCipher(keys.viewer_to_host, b"viewer-to-host")
        elif role == "viewer":
            self._send = DirectionalCipher(keys.viewer_to_host, b"viewer-to-host")
            self._recv = DirectionalCipher(keys.host_to_viewer, b"host-to-viewer")
        else:
            raise ValueError("invalid role")

    @classmethod
    def from_exchange(
        cls,
        private_key: X25519PrivateKey,
        peer_public_b64: str,
        session_id: str,
        role: Role,
    ) -> "SessionCrypto":
        return cls(derive_session_keys(private_key, peer_public_b64, session_id), role)

    def seal(self, payload: bytes) -> bytes:
        return self._send.seal(payload)

    def open(self, packet: bytes) -> bytes:
        return self._recv.open(packet)


@dataclass(frozen=True)
class Invite:
    session_id: str
    join_secret: str
    host_public_key: str

    def encode(self) -> str:
        raw = json.dumps(
            {
                "v": PROTOCOL_VERSION,
                "s": self.session_id,
                "j": self.join_secret,
                "h": self.host_public_key,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        return "rd2_" + b64u_encode(raw)

    @staticmethod
    def decode(token: str) -> "Invite":
        if not token.startswith("rd2_"):
            raise ValueError("not a RelayDesk v2 invite")
        data: dict[str, Any] = json.loads(b64u_decode(token[4:]).decode("utf-8"))
        if data.get("v") != PROTOCOL_VERSION:
            raise ValueError("unsupported invite version")
        session_id = str(data.get("s", ""))
        join_secret = str(data.get("j", ""))
        host_public_key = str(data.get("h", ""))
        if len(session_id) != 6 or not session_id.isdigit():
            raise ValueError("invalid session id")
        if len(join_secret.encode("utf-8")) < 24:
            raise ValueError("join secret too short")
        if len(b64u_decode(host_public_key)) != 32:
            raise ValueError("invalid host public key")
        return Invite(session_id, join_secret, host_public_key)


def short_fingerprint(*public_keys: str) -> str:
    ordered = sorted(b64u_decode(k) for k in public_keys)
    digest = hashlib.sha256(b"".join(ordered)).hexdigest().upper()
    return "-".join(digest[i : i + 4] for i in range(0, 16, 4))


def pack_json(kind: str, value: dict[str, Any]) -> bytes:
    return b"J" + json.dumps({"kind": kind, **value}, separators=(",", ":")).encode("utf-8")


def unpack_json(payload: bytes) -> tuple[str, dict[str, Any]]:
    if not payload.startswith(b"J"):
        raise ValueError("not a JSON control packet")
    data = json.loads(payload[1:].decode("utf-8"))
    kind = str(data.pop("kind"))
    return kind, data
