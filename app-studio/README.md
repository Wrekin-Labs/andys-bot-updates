# Wrekin App Studio

Internal app-generation layer for the commercial multi-tenant platform.

## Current scope

- branded tenant registry
- per-tenant module configuration
- installable PWA manifest generation
- install/bootstrap configuration for a website
- safe read-only preview API
- starter demo tenants for The Smashroom and Electronic Repairs UK
- no credentials, payments, email sending or destructive actions

## Demo tenants

- `smashroom` — https://www.thesmashroom.co.uk
- `electronic-repairs-uk` — https://www.electronicrepairsuk.com

## Run

```bash
npm start
```

Default port: `3300`.

## Test

```bash
npm test
```

## API

- `GET /health`
- `GET /api/apps`
- `GET /api/apps/:slug`
- `GET /api/apps/:slug/manifest.webmanifest`
- `GET /api/apps/:slug/install-config`
- `POST /api/preview`

This module is deliberately separated from Wrekin Cloud and Runtime so app product work can evolve without weakening the control plane.


## v0.2 builder

App Studio now includes `/builder`, a browser-based tenant builder with:

- app name, slug and website domain
- brand colour controls
- standalone/fullscreen mode
- optional module selection
- live phone preview
- validation through the same preview/install-config API

`schema.sql` is a reviewed Supabase schema draft for tenant/version/install/audit persistence. It is server-only by default: RLS is enabled and direct `anon` / `authenticated` table access is revoked. The schema is not applied automatically.
