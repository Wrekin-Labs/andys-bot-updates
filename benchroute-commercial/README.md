# BenchRoute Commercial

Working commercialisation project for the Electronic Repairs UK Repair Desk.

## Goal

Turn the proven ERUK workshop system into a secure, multi-tenant subscription SaaS for independent electronics repair shops.

## Working position

**BenchRoute** — repair-shop software built around the bench, not the till.

Primary target:
- independent electronics repair workshops
- audio / hi-fi / amplifier repairers
- musical equipment repairers
- computer and general electronics repairers
- phone/device repair shops that want a simpler workflow

## Product principles

1. Fast on a phone at the counter and on a desktop at the bench.
2. No feature bloat in the default workflow.
3. Proper technical repair records: measurements, diagnostics, photos, parts, notes and history.
4. Customer communication and tracking without extra admin.
5. Shop-owned data with simple export.
6. UK-first commercial setup, with internationalisation later.
7. AI assists staff but does not hide or overwrite repair history.
8. Secure tenant isolation at the database layer.

## Current status

The live ERUK system already proves much of the core workflow:
- customers and repairs
- public website enquiries
- quotes and invoices
- payments
- stock and purchase orders
- attachments/photos
- measurements
- customer portal and repair updates
- staff tasks, alerts and PWA
- audit trail and role-aware access

Commercial work starts by separating product configuration from ERUK-specific behaviour, then adding onboarding, billing, tenant administration, imports/exports and release controls.

See docs/ for market research, architecture, product design, pricing hypotheses and launch roadmap.
