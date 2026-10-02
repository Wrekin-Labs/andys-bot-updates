# Wrekin WordPress Connector

Secure WordPress-side connector for Wrekin Cloud.

## Security
- HMAC-SHA256 request signing.
- 5-minute replay window.
- Connector secret generated on activation and managed only by WordPress administrators.
- Update routes require an explicit approved=true flag in addition to a valid signature.
- Paid/licensed updates are not bypassed: if WordPress exposes no update package, the connector returns a licence/package-required error.
- No 2FA, payment, legal or credential bypass features.

## Endpoints
- GET /wp-json/wrekin/v1/status
- GET /wp-json/wrekin/v1/plugins
- GET /wp-json/wrekin/v1/themes
- GET /wp-json/wrekin/v1/cron
- GET /wp-json/wrekin/v1/forms
- POST /wp-json/wrekin/v1/cache/purge
- POST /wp-json/wrekin/v1/plugin/update-plan
- POST /wp-json/wrekin/v1/plugin/update
- POST /wp-json/wrekin/v1/theme/update-plan
- POST /wp-json/wrekin/v1/theme/update

Settings page: Settings -> Wrekin Connector.
