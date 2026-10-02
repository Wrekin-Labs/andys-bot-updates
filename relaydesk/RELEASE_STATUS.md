# RelayDesk release status

## Current candidate

Version: `0.2.0-alpha.3`
Date: 1 October 2026

## Working in source

- attended host GUI with copyable one-time invite
- viewer GUI with paste-to-connect flow
- explicit view-only / view+control approval
- X25519 + HKDF directional keys
- AES-256-GCM encrypted session packets
- replay rejection using ordered packet counters
- host public-key pinning + session fingerprint
- relay join rate limiting and single-viewer sessions
- Windows DXGI Desktop Duplication capture bridge through DXcam 0.3.0
- `mss` fallback and virtual-desktop support
- encrypted remote mouse, keyboard and wheel input
- pressed-key/button cleanup on disconnect
- live multi-monitor switching from the viewer toolbar
- viewer resolution/FPS display
- Windows PyInstaller build script
- Render relay descriptor
- Project Relay control-plane/Supabase schema proposal
- research/security/architecture documents

## Validation

- Python compile checks pass.
- 12 automated protocol, relay, end-to-end and capture-selection tests pass.
- Clean ZIP extraction was retested after packaging.

## Not yet claimed complete

- Native RelayDesk-owned DXGI/WGC module and hardware H.264/AV1 encoder.
- Direct ICE/STUN connectivity and TURN-style fallback.
- Clipboard, file transfer, audio, remote restart/reconnect.
- Durable Project Relay device identity / production audit integration.
- Unattended access.
- Signed installer/updater and Windows code signing.
- External penetration/security review.

## GitHub status

The connected GitHub integration can read `Wrekin-Labs/andys-bot-updates`, but branch/ref creation still returns HTTP 403 `Resource not accessible by integration`. No live branch or `main` file has been modified. The release ZIP and source patch are ready to import once GitHub Contents/ref write permission is available.


## alpha.4 private code join

Trusted private Tailscale/loopback relays can optionally enable attended 6-digit code join with `RELAYDESK_TRUSTED_CODE_JOIN=1`. It remains disabled by default; the visible host approval gate is unchanged. Public relays continue to require the secure `rd2_` invite flow.
