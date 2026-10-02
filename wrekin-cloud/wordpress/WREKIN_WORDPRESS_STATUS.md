# Wrekin WordPress Manager Status

## 2026-10-02

Wrekin WordPress Manager is integrated into `wrekin-cloud` on branch `wrekin-cloud-v0.1` and deployed on Render.

### Live control plane
- Wrekin Cloud WordPress API version: 0.4.0
- Control-plane bearer authentication enabled
- Supabase-backed WordPress registry configured
- Supabase Vault-backed connector secret store configured
- Sensitive WordPress endpoints require WREKIN_CONTROL_TOKEN
- Unauthenticated inspection requests return 401
- Registry contains Electronic Repairs UK and The Smash Room

### Implemented APIs
- GET /api/wordpress/capabilities
- GET /api/wordpress/registry/status
- GET /api/wordpress/sites
- POST /api/wordpress/sites
- POST /api/wordpress/inspect
- POST /api/wordpress/check
- POST /api/wordpress/plan
- POST /api/wordpress/update/plan
- POST /api/wordpress/update/verify
- POST /api/wordpress/host/plan
- POST /api/wordpress/connector/*

### Wrekin WordPress Connector
Connector version 0.2.0 adds:
- HMAC-SHA256 signed requests with replay-window checking
- WordPress/PHP/site status
- plugin inventory and update availability
- theme inventory and update availability
- WordPress core update plan + approved execution
- plugin update plan + approved execution
- theme update plan + approved execution
- no package / paid-license bypass protection
- cron inspection
- Contact Form 7 and WP Mail SMTP detection
- mail transport status
- approved mail test
- cache purge with approval
- backup-provider capability detection
- admin settings page with generated connector token

Release:
`releases/wrekin-wordpress-connector.zip`

SHA-256:
`B72271D8629C1819BE2B65C4378B6C86F939F91C3178636E641B6BC07B37CB06`

### Safety model
Read-only inspection is automatic only after Wrekin control authentication. Site connector calls additionally require HMAC signatures using a Vault-stored site secret. Core/plugin/theme updates, cache purge, mail tests and restore operations require an explicit approval signal. Paid licensing, 2FA, payments, legal acceptance and credential bypasses are never automated.

### Tests
Wrekin Cloud WordPress test suite currently passes 22/22.

### Remaining work
1. Install and pair connector v0.2.0 on Electronic Repairs UK.
2. Install and pair connector v0.2.0 on The Smash Room.
3. Add provider-specific backup create/restore adapters.
4. Add performance/PageSpeed adapter and WordPress site cards to Wrekin dashboard.
5. Add approved Project Relay execution adapter for host/file/CLI fallbacks.
6. Run staged write/update verification after connectors are paired.


### Live connector rollout
- Electronic Repairs UK: connector v0.2.0 installed and active; public probe returns the expected signed-endpoint 401 challenge.
- The Smash Room: connector not yet installed because the current WordPress admin session is logged out.
- Canonical install package is releases/wrekin-wordpress-connector.zip.

