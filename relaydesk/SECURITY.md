# RelayDesk security model — v0.2

RelayDesk v0.2 is an **attended-support alpha**, not a stealth or monitoring tool.

## Current security properties

- Every run creates a fresh short-lived session and high-entropy invitation secret.
- The relay receives a session-bound HMAC verifier rather than the raw invitation secret.
- The invitation pins the host's ephemeral X25519 public key; the viewer rejects a substituted host key.
- X25519 + HKDF derives two different 256-bit session keys: host→viewer and viewer→host.
- Session packets use AES-256-GCM with monotonically increasing sequence numbers.
- Duplicate/out-of-order packets are rejected by the current ordered WebSocket transport, providing explicit replay protection for this transport.
- The host sees the controller device name, fingerprint and requested permissions before accepting.
- The host may grant view only, view + control, or deny.
- Disconnect cleanup releases pressed remote keys and mouse buttons.
- Failed join attempts are rate-limited at the relay.
- The relay never receives endpoint session encryption keys and forwards encrypted binary packets without inspecting their payload.
- No service, hidden persistence or silent unattended access is installed.

## Important alpha limitations

- Internet deployments must terminate TLS and use `wss://`; `ws://` is for local testing only.
- Controller identity in attended mode is possession of the one-time invite plus local host approval. Durable named-device authentication comes with Project Relay device identities.
- Strict monotonic receive counters suit ordered WebSockets. A future UDP/QUIC/WebRTC transport needs a bounded replay window rather than rejecting harmless packet reordering.
- JPEG-over-WebSocket and `mss` are prototypes, not the final low-latency transport/capture engine.
- `pyautogui` does not and should not bypass Windows secure-desktop/UAC isolation. Native production input must preserve Windows integrity boundaries.
- No clipboard, file transfer, audio, login-screen service, remote restart or unattended access is enabled yet.

## Product rules

A production build keeps a visible local session indicator. Unattended access remains disabled by default and requires explicit local owner enrollment, trusted helper/device allowlists, strong authentication/MFA policy, revocation and audit. RelayDesk will not add a stealth mode, hidden capture, credential interception or consent bypass.
