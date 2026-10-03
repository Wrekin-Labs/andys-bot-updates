# RelayDesk Rescue fallback

This feature branch adds a narrow emergency fallback for owner-controlled Windows PCs when the normal Project Relay cloud agent is unavailable.

## Scope

- tailnet/loopback-only HTTP access
- persistent rescue token
- 10-minute control lease
- screen snapshots
- native Windows mouse, key and Unicode text injection
- one fixed Recover Project Relay action
- automatic stale-heartbeat recovery every minute with a two-minute restart cooldown

The recovery action can only start these pre-existing scheduled tasks:

- Project Relay Cloud Agent
- Project Relay Cloud Watchdog

There is deliberately no arbitrary shell, command, task name or file-execution endpoint.

## Recovery layers

1. Project Relay 0.7.12 unattended recovery is the boot/no-login path.
2. RelayDesk Rescue is the logged-in-session fallback for screen/control and exact Relay recovery; it also self-heals a missing/stale normal Relay agent.
3. Normal RelayDesk attended sessions remain the primary TeamViewer/AnyDesk-style support path.

## Security

The rescue host rejects peers outside loopback and Tailscale CGNAT (100.64.0.0/10). API access requires a long random token. Mouse/keyboard/text actions also require an expiring control lease.

The rescue host is not intended to replace Windows authentication, UAC, Project Relay owner checks, or the attended RelayDesk consent model.
