# RelayDesk design research — 1 October 2026

The implementation deliberately follows established remote-support patterns without copying proprietary code.

## Windows capture

Microsoft documents Desktop Duplication as an API for desktop collaboration and remote desktop access. Frames are made available in GPU memory together with dirty regions, screen-to-screen move metadata and cursor information, allowing hardware-accelerated processing and compression. Windows Graphics Capture provides a system picker and a visible capture border and is useful where explicit user-selected capture is preferred.

References:
- https://learn.microsoft.com/en-us/windows-hardware/drivers/display/desktop-duplication-api
- https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api
- https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture

## Connectivity

ICE describes peer-to-peer connectivity discovery and TURN provides relay fallback when NAT/firewall conditions prevent a direct path. TURN is bandwidth-expensive, which is another reason to prefer direct paths and use relays only when needed.

References:
- https://www.rfc-editor.org/rfc/rfc8445.html
- https://www.rfc-editor.org/rfc/rfc8656.html

## Commercial-product patterns

Current TeamViewer documentation describes end-to-end protected sessions, a modern mutually authenticated TLS 1.3 handshake in current versions, AES-256-GCM session protection, allowlists/trusted-device controls and an explicit no-stealth design.

Current AnyDesk documentation exposes direct connections with routed fallback, separates attended acceptance from unattended access, and uses per-session permissions for input, clipboard and related features.

References:
- https://www.teamviewer.com/en-au/global/support/knowledge-base/teamviewer-remote/security/security-statement/
- https://support.anydesk.com/docs/settings
- https://support.anydesk.com/docs/unattended-access
- https://support.anydesk.com/docs/session-settings

## Consequence for RelayDesk

RelayDesk v0.2 keeps attended approval and a visible host application, encrypts session payloads endpoint-to-endpoint, and treats the relay as an opaque forwarder. Native DXGI capture, direct ICE/TURN connectivity, durable device identities and signed releases are the next production milestones.
