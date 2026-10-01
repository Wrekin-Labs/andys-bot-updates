# Wrekin Forge

Wrekin Forge is the Wrekin Labs source-control service: repositories, branches, pull requests, issues, releases and CI.

## Foundation

The bootstrap uses Forgejo rather than reimplementing Git. It is pinned to Forgejo 16.0.5 for a reproducible first deployment. Major upgrades must be reviewed and tested before promotion.

## Safe default

`docker-compose.yml` binds the Forgejo web port to `127.0.0.1` only. Put TLS/reverse proxy in front of it before exposing it publicly. Registration is disabled by default until Wrekin identity, invitations and billing are ready.

No real password, signing key, OAuth secret or SMTP credential belongs in this repository.

## First production host

Required before going live:
- persistent Linux host
- persistent SSD-backed volumes
- DNS and TLS
- firewall
- off-host backups
- monitoring
- restore test
- administrator account and recovery procedure

## Start after host provisioning

```bash
cp .env.example .env
# edit .env and generate a strong FORGE_DB_PASSWORD
docker compose pull
docker compose up -d
docker compose ps
```

Then complete the initial Forgejo setup through the TLS hostname.

## Next Wrekin layers

1. Wrekin SSO / organisation provisioning
2. protected branches and required checks
3. Forgejo Actions runners
4. Wrekin Deploy webhook integration
5. repository backup and restore verification
6. migration tooling from GitHub
