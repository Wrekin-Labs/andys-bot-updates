# RelayDesk architecture

## Product goal

A Project Relay companion for legitimate remote support and owner-authorized device access, with a TeamViewer/AnyDesk-like workflow while preserving explicit ownership and visible consent.

## v0.2 alpha data flow

1. Host creates a one-time `rd2_` invitation containing session ID, high-entropy secret and ephemeral host public key.
2. Both endpoints send a session-bound HMAC verifier to the rendezvous relay; the raw secret is not sent to the relay.
3. Viewer sends its ephemeral public key and requested permissions.
4. Host displays viewer name, fingerprint and permissions and selects view only, view + control, or deny.
5. Endpoints derive directional X25519/HKDF keys and use AES-256-GCM sequence-protected packets.
6. Relay forwards encrypted packets and has no session encryption keys.

## Target production architecture

1. **Project Relay account/device control plane** — ownership, account sign-in, durable device signing keys, policy and audit.
2. **Rendezvous/signalling** — online presence, short-lived attended session redemption, candidate exchange and short-lived relay credentials.
3. **Direct data plane first** — ICE/WebRTC or an equivalent QUIC design attempts direct endpoint connectivity.
4. **Relay fallback** — regional TURN/content-blind relay nodes carry encrypted application traffic when direct connectivity fails.
5. **Windows capture/encode** — DXGI Desktop Duplication or Windows Graphics Capture feeds hardware H.264/AV1 where available; dirty/move regions and cursor metadata reduce bandwidth and latency.
6. **Independent permissioned channels** — screen, input, clipboard, file transfer, audio and administrative actions are separate capabilities.
7. **Visible UI** — the host displays requests and active-session state; the viewer displays remote identity, path, encryption state and granted permissions.

## Milestones

### v0.2 — current alpha
- GUI attended support flow
- directional E2E crypto + replay rejection
- host permission choice
- encrypted relay
- DXGI alpha capture bridge with mss fallback
- JPEG screen frames
- mouse/keyboard control
- monitor selection at startup and live viewer-side switching

### v0.3 — low-latency Windows engine
- native DXGI/WGC capture
- hardware H.264/AV1
- adaptive bitrate/FPS/resolution
- cursor side channel
- live multi-monitor switching

### v0.4 — direct connectivity
- rendezvous presence
- ICE/STUN candidate gathering
- TURN-style relay fallback
- path/latency metrics and reconnect

### v0.5 — support feature set
- text clipboard with separate permission
- explicit audited file offers/transfers
- remote restart/reconnect
- session history/notes
- durable Project Relay device/address book

### v0.6 — opt-in unattended access
- local enrollment on the owned endpoint
- durable device identity + helper allowlist
- MFA/policy enforcement
- visible persistent status and local disable switch
- service component only where required for restart/sign-in scenarios

### v1.0 — commercial hardening
- signed installer/updater
- organization RBAC and device groups
- security review/penetration test
- rate limiting/abuse controls
- privacy/retention controls
- relay autoscaling/regions
- crash telemetry with privacy controls
