# RelayDesk v0.2 alpha

Windows-first attended remote support built as a companion to Project Relay.

RelayDesk v0.2 is intentionally visible and consent-based. The remote PC creates a one-time secure invitation and must approve the connecting person before any screen/control session begins.

## Implemented now

- TeamViewer/AnyDesk-style attended connection flow
- GUI host app with one-time secure invite and Copy button
- GUI viewer with paste-in invite screen
- host can grant **view only**, **view + control**, or deny
- ephemeral X25519 key exchange
- separate host→viewer and viewer→host AES-256-GCM keys
- monotonic packet counters with explicit replay rejection
- host public-key pinning through the secure invite
- visible session fingerprint
- relay forwards opaque encrypted binary traffic
- rate limiting of failed relay join attempts
- Windows DXGI Desktop Duplication capture via DXcam when available, with `mss` fallback
- JPEG screen streaming prototype transport
- remote mouse, keyboard and wheel input
- stuck key/button release on disconnect
- selectable Windows monitor (`--monitor`, with `0` for the virtual desktop)
- live monitor switching from the viewer toolbar during an active session
- viewer resolution/FPS indicator
- source and Windows PyInstaller build script
- Project Relay/Supabase control-plane schema proposal

## Local test

### Relay

```powershell
py -m pip install -r requirements-server.txt
py relay_server.py
```

### Remote Windows PC

```powershell
py -m pip install -r requirements-host.txt
py host_gui.py --server ws://RELAY-SERVER:8765
# auto prefers DXGI on Windows; add --capture mss to force the fallback
```

Copy the displayed `rd2_...` secure invite to the support person.

### Controller Windows PC

```powershell
py -m pip install -r requirements-controller.txt
py controller.py --server ws://RELAY-SERVER:8765
```

Paste the secure invite into the connection window. The host must approve the request.

### Private Tailscale/LAN code join (alpha)

For an owner-controlled private relay only, start the relay with `RELAYDESK_TRUSTED_CODE_JOIN=1`. A viewer on loopback or the Tailscale `100.64.0.0/10` range can then use the visible 6-digit attended session code:

```powershell
$env:RELAYDESK_TRUSTED_CODE_JOIN = "1"
py relay_server.py
py controller.py --code 123456 --server ws://TAILSCALE-IP:8765
```

The host still receives the normal visible Allow/Deny permission dialog. Code join is deliberately disabled by default and is not a replacement for secure invites on public relays.

For Internet use, deploy the relay behind HTTPS/TLS and use `wss://`. The plain `ws://` examples are for a trusted local test network only.

## Build Windows alpha executables

```powershell
.\build_windows.ps1
```

This creates `RelayDeskHost.exe` and `RelayDeskViewer.exe` in `dist`. They are **unsigned alpha binaries**; public/commercial distribution waits for code signing and a verified updater.

## Tests

```powershell
py -m pip install -r requirements-dev.txt
py -m pytest -q
```

Current v0.2 protocol/relay/backend suite: **12 tests**.

## Next production work

1. Replace the alpha DXcam bridge with the native RelayDesk capture/encoder module and add Windows Graphics Capture where appropriate.
2. Hardware H.264/AV1 encode and adaptive bitrate/frame rate.
3. ICE/STUN direct path with TURN-style relay fallback.
4. Durable Project Relay device identity and session audit integration.
5. Multi-monitor switching inside a live session.
6. Clipboard and explicit audited file transfer permissions.
7. Reconnect/resume and remote restart.
8. Opt-in unattended access only after trusted-device enrollment/MFA policy.
9. Signed installer/updater, abuse controls and external security review.

See `ARCHITECTURE.md`, `SECURITY.md`, `PROJECT_RELAY_INTEGRATION.md` and `RESEARCH.md`.
