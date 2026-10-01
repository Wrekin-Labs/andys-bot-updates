# Wrekin infrastructure

This branch contains the deployment groundwork for replacing managed developer infrastructure gradually.

Current live bootstrap:
- Wrekin Cloud control plane
- Wrekin Runtime read-only bootstrap node
- Wrekin Monitor health checks
- managed Supabase temporarily stores control-plane state
- Render temporarily hosts bootstrap services

Prepared next:
- Wrekin Forge self-hosted source control
- Wrekin Base self-hosted backend

## Promotion rule

Do not move customer or production data merely because a self-hosted service starts successfully. A Wrekin service becomes production-capable only after backups, restore testing, monitoring, patching, TLS, access control and rollback have been verified.

## Secret rule

No passwords, API secrets, private keys, payment credentials or service-role tokens are committed to Git.
