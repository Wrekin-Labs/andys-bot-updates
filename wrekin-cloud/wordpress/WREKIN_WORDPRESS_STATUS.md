# Wrekin WordPress Manager Status

## 2026-10-02

Integrated into `wrekin-cloud` on branch `wrekin-cloud-v0.1`.

### Implemented
- WordPress module registered in Wrekin Cloud dashboard/status API
- `GET /api/wordpress/capabilities`
- `POST /api/wordpress/inspect`
- `POST /api/wordpress/plan`
- action risk classifier
- explicit approval gates for core/plugin/theme updates
- hard block for paid-license bypass, 2FA bypass, payments and legal acceptance
- secret-payload rejection by default
- WordPress REST client
- public WordPress REST diagnostics
- safe HTTPS/public-host validation
- page edit checkpoint + rollback plan
- pluggable/redacting audit sink
- Project Relay host-action planning contract
- automated node:test suite
- live local smoke test against Electronic Repairs UK

### Verified
Local Wrekin Cloud inspection returned:
- site: https://electronicrepairsuk.com
- WordPress name: Electronic Repairs UK
- published pages: 26

### Safety model
Read-only inspection is automatic. Reversible content edits may execute after a checkpoint. Core/plugin/theme updates and restore operations require explicit approval. Paid licensing, 2FA, payments, legal acceptance and credential bypasses are never automated.

### Next
1. Add authenticated site registration using secret references, never raw secrets in project records.
2. Add plugin/theme/core dry-run and post-update verification adapters.
3. Add backup provider + restore checkpoints.
4. Add cron/cache/form/email diagnostics.
5. Implement Project Relay host adapter execution after approval.
6. Wire audit sink to Wrekin Base/Supabase.
7. Add performance audit adapter and dashboard site cards.
8. Validate write operations first on staging or explicit reversible test content.
