# Wrekin WordPress Manager

Wrekin Cloud's WordPress management module.

## Current capabilities
- safe action classification
- explicit approval gates for WordPress core/plugin/theme updates
- paid-license, 2FA, payment and legal-acceptance blocks
- WordPress REST client
- site/page/plugin inspection primitives
- reversible page edit workflow
- deterministic checkpoint + rollback plan
- audit-sink interface
- node:test safety coverage

## Planned adapters
- WP-CLI / host bridge through Project Relay
- backup/checkpoint storage
- plugin/theme/core dry-run + post-update verification
- cron/cache/form/email checks
- performance audit adapter
- Supabase-backed site registry and audit history

This module does not bypass WordPress credentials, paid plugin licences, 2FA, payments or legal attestations.
