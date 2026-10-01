# Wrekin Base

Wrekin Base is the Wrekin Labs backend platform: PostgreSQL, authentication, object storage, realtime, REST/GraphQL APIs and functions.

## Bootstrap strategy

Use the official self-hosted Supabase Docker distribution as the compatibility foundation, then put Wrekin's own control plane, provisioning, monitoring, backup policy and developer UX around it.

Do not copy managed-Supabase credentials into this repository.

## Host profile

The current Supabase self-hosting documentation lists 4 GB RAM / 2 CPU / 40 GB SSD as minimum for all components and 8 GB+ RAM / 4 CPU / 80 GB+ SSD as recommended. Wrekin should provision above those figures when Forge, Runtime and monitoring share the same host.

## Deployment policy

Production must have:
- Linux + Docker Engine + Docker Compose
- private database network
- TLS at the edge
- generated asymmetric signing keys and API keys
- object-storage persistence
- scheduled encrypted backups
- tested restore procedure
- OS/service patching
- health checks and alerting
- secrets outside Git
- separate staging and production environments

## Official install source

When a Linux host is provisioned, bootstrap from Supabase's official `docker/` distribution rather than maintaining a forked copy of their whole stack. Record the exact upstream commit used for every Wrekin Base release.

Wrekin-specific overrides belong under this directory; upstream files should remain traceable.

## Migration plan

1. provision `Wrekin Base staging`
2. recreate Wrekin control-plane schema from migrations
3. export/import non-secret application data
4. rotate credentials
5. test auth, storage, realtime and functions
6. run security advisors and restore test
7. promote one low-risk Wrekin project first
8. move remaining projects gradually

The existing managed Supabase projects remain the bootstrap production data source until these checks pass.
