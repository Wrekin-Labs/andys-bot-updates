# Architecture — commercial direction

## Key finding
The current ERUK database is already partly tenant-shaped.

Most core ERA tables carry shop_id and use membership-aware row-level security:
- customers
- repairs
- inventory
- invoices
- attachments
- enquiries
- audit records
- scheduling
- purchase orders
- tasks

So the repair data model does not need rebuilding from zero.

## Separate commercial environment
Do not onboard paying shops into the existing ERUK/DeskRoute production Supabase project.

Create a dedicated BenchRoute Supabase project before external beta so:
- customer repair data is isolated from unrelated projects
- migrations are independently controlled
- backups and incidents are simpler
- billing limits are clean
- tenant boundaries are clearer

## Web app
- responsive PWA
- Vite + TypeScript
- Supabase Auth
- Supabase Postgres + RLS
- Supabase Storage
- Edge Functions for public forms, email, payments and privileged workflows

## Commercial services
- Stripe Billing
- Stripe Checkout / Customer Portal
- transactional email provider
- optional SMS after beta
- error monitoring and uptime
- automated backups and restore tests

## Tenant model
Tenant = repair shop.

Every business-owned record must have shop_id or derive from a shop-scoped parent.

Roles:
- owner
- manager
- technician
- reception
- finance
- custom role later

Never trust a client-supplied shop_id without membership enforcement.

## Provisioning flow
1. user creates account
2. server creates shop
3. user becomes owner
4. seed statuses, invoice sequence, templates and settings
5. create trial entitlement
6. onboarding wizard
7. invite staff
8. issue shop-scoped public enquiry key

## Configuration
Move ERUK-specific values into shop settings:
- name/address
- hours
- diagnostic fee
- labour rate
- tax mode
- currency
- payment details
- booking terms
- email recipients
- job numbering
- public form fields
- customer message templates

## Export
Owner can request shop-scoped customers, repairs, invoices and inventory CSV, plus complete JSON archive and attachment manifest.

## Release strategy
One commercial codebase, feature flags by plan/module, demo tenant, no per-customer forks.
