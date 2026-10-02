# Wrekin WordPress Connector

Secure WordPress-side connector for Wrekin Cloud.

## Version 0.3.0

### Security
- HMAC-SHA256 signed requests.
- 5-minute replay window.
- Connector token generated on activation and managed by WordPress administrators.
- One-time 10-minute pairing codes let WordPress pair outbound to Wrekin without exposing the connector token to the operator.
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

### Pairing
1. Generate a one-time pairing code from Wrekin Cloud.
2. In WordPress open **Settings -> Wrekin Connector**.
3. Enter the pairing code and choose **Pair with Wrekin Cloud**.
4. WordPress sends its connector secret directly to Wrekin Cloud over HTTPS.
5. Wrekin validates the one-time code, stores the secret in Vault, and updates the site registry with only a credential reference.

Release zip: `releases/wrekin-wordpress-connector-0.3.0.zip`
