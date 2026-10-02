# Wrekin WordPress Connector

Secure WordPress-side connector for Wrekin Cloud.

## Version 0.2.0

### Security
- HMAC-SHA256 signed requests.
- 5-minute replay window.
- Connector token generated on activation and managed by WordPress administrators.
- Wrekin stores paired connector secrets in Supabase Vault by secret reference.
- Update routes require an explicit `approved=true` flag in addition to a valid signature.
- Paid/licensed updates are not bypassed: if WordPress exposes no update package, the connector returns a licence/package-required error.
- No 2FA, payment, legal or credential bypass features.

### Endpoints
- GET /wp-json/wrekin/v1/status
- GET /wp-json/wrekin/v1/plugins
- GET /wp-json/wrekin/v1/themes
- GET /wp-json/wrekin/v1/cron
- GET /wp-json/wrekin/v1/forms
- GET /wp-json/wrekin/v1/mail
- GET /wp-json/wrekin/v1/backup/capabilities
- POST /wp-json/wrekin/v1/cache/purge
- POST /wp-json/wrekin/v1/mail/test
- POST /wp-json/wrekin/v1/core/update-plan
- POST /wp-json/wrekin/v1/core/update
- POST /wp-json/wrekin/v1/plugin/update-plan
- POST /wp-json/wrekin/v1/plugin/update
- POST /wp-json/wrekin/v1/theme/update-plan
- POST /wp-json/wrekin/v1/theme/update

Settings page: **Settings -> Wrekin Connector**.

Release zip: `releases/wrekin-wordpress-connector.zip`

SHA-256: `B72271D8629C1819BE2B65C4378B6C86F939F91C3178636E641B6BC07B37CB06`

