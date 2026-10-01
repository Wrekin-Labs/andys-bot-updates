# Changelog

## 0.2.0-alpha.3 — 2026-10-01

### Added
- GUI attended host with copyable secure invitation.
- Viewer connection dialog; command-line invite is no longer required.
- View-only vs view+control permission negotiation.
- Separate directional session keys for host→viewer and viewer→host.
- Sequence-numbered AES-256-GCM packets with replay rejection.
- Session-bound relay join verifier; raw invite secret is not sent to the relay.
- Relay join failure rate limiting.
- Startup monitor selection and full virtual-desktop option.
- Optional Windows DXGI Desktop Duplication capture through DXcam 0.3.0, with safe `mss` fallback.
- Viewer resolution/FPS indicator.
- Live monitor switching from the viewer toolbar without restarting the session.
- Stuck key/button release on disconnect.
- Windows PyInstaller build script.
- Project Relay integration plan and Supabase metadata schema proposal.
- End-to-end encrypted relay integration tests.

### Validation
- Python compile checks passed.
- 12 protocol/relay/end-to-end/backend-selection tests passed on 1 October 2026.

### Still alpha
- Capture is JPEG + `mss`, not native DXGI/WGC hardware video yet.
- Transport is WebSocket relay only; direct ICE/TURN path is not implemented yet.
- No unattended access, clipboard, file transfer, service-mode login screen, audio or remote restart.
- Windows EXEs must be built on Windows and are unsigned until the commercial signing/update milestone.
