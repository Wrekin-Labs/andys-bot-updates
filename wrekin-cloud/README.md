# Wrekin Cloud bootstrap

This folder contains the first deployable Wrekin Cloud control-plane service.

## Purpose

Wrekin Cloud is the unified operating surface for:

- Wrekin Forge — Git/source control and CI
- Wrekin Base — database, auth, storage, realtime and APIs
- Wrekin Deploy — builds, previews, releases, domains and TLS
- Wrekin Runtime — web services, workers, cron and container nodes
- Wrekin Agents — AI agent execution and approvals
- Wrekin Relay — authorised workstation/local-software bridge
- Wrekin Monitor — logs, health, uptime and incidents
- Wrekin Secrets — scoped secret references and rotation
- Wrekin Billing — subscriptions, usage and provider adapters

## Bootstrap mode

This first service is deliberately dependency-light and contains no credentials. It exposes:

- `/` — dashboard
- `/health` — health endpoint
- `/api/status` — safe public module status

Managed Render and Supabase are being used only as bootstrap infrastructure while Wrekin Deploy, Runtime and Base are built out.

## Run

```bash
cd wrekin-cloud
npm start
```

Set `PORT` if required. Optional: `WREKIN_VERSION`.
