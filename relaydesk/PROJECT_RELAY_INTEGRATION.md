# Project Relay integration plan

RelayDesk should reuse Project Relay for **identity, device ownership, authorization and audit**, but it should not move screen frames or remote-input traffic through MCP.

## New authorization boundary

Create a distinct Project Relay scope such as `relay:support`. Do not treat the existing inspection scope as permission to start a remote-control session.

Attended flow:

1. Owner signs into Project Relay on the host endpoint.
2. Endpoint registers a durable device identity/public signing key.
3. Host creates a short-lived attended RelayDesk session.
4. The controller redeems the secure invitation and states the permissions it wants.
5. Host shows the person/device identity, fingerprint and requested permissions.
6. Host grants view only, view + control, or denies.
7. Control plane records metadata only; endpoints establish the encrypted data plane.

## Data-plane rule

The existing Project Relay MCP/HTTP gateway remains a control-plane integration. Real-time video, input, clipboard and files use a dedicated session transport:

- direct ICE/WebRTC/QUIC where possible;
- content-blind regional relay fallback;
- endpoint-to-endpoint authenticated encryption independent of the relay transport.

## Suggested Project Relay records

- `relaydesk_devices`: owner, public device key, display name, platform, revocation state.
- `relaydesk_sessions`: device, helper identity, requested/granted permissions, state, timestamps, transport path.
- `relaydesk_audit`: enrollment, session creation, accept/deny, permission changes, reconnect and end events.

Never store raw one-time secrets, screenshots, keystrokes, clipboard contents, transferred file contents or session encryption keys in these records.

## Unattended access

Keep disabled until a later milestone. Enrollment must be done locally by the owner and bind an explicit allowlist of helper accounts/devices, with MFA policy, revocation and a visible local status indicator.
