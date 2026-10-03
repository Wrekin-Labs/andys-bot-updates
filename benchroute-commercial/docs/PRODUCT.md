# Product specification — BenchRoute v0.1

## Product promise

A repair workshop should be able to sign up, configure the business, invite staff and book its first real job without a developer or consultant touching the account.

## Core jobs-to-be-done

### Front counter
- book in a customer and item quickly
- record condition, fault, serial/IMEI, accessories and intake photos
- take a diagnostic fee or deposit
- print/email a booking receipt
- give the customer a tracking link

### Technician bench
- see what needs attention now
- add diagnosis, measurements, notes, parts and photos without navigating through a POS-heavy interface
- create a quote and request approval
- see previous repairs for the same customer/item
- record time and parts used
- hand over cleanly to another technician

### Owner / manager
- know what is overdue, waiting on parts, quoted, ready, unpaid or abandoned
- track revenue, labour, parts cost and margin
- manage staff access
- export all business data
- configure statuses, prices, templates, opening hours and branding

### Customer
- see status without creating an account
- approve/reject quotes
- read updates
- pay online when enabled
- download invoices/receipts

## Information architecture

Primary navigation:
1. Repairs
2. Tonight / Tasks
3. New repair
4. Customers
5. Enquiries
6. Parts / Stock
7. Quotes & Invoices
8. Diary
9. Reports
10. Team
11. Settings

On mobile, the first five remain pinned. Less-frequent tools live behind More.

## Commercial configuration

Every shop needs its own:
- name, logo, colours, address and contact details
- currency, tax/VAT mode and invoice numbering
- diagnostic fee defaults
- labour rates
- opening hours
- repair statuses and SLA targets
- customer email/SMS templates
- staff roles and permissions
- quote validity
- payment details / payment provider
- website enquiry form/widget configuration
- retention policy and export tools

## Differentiators to protect

1. **Bench-first technical workflow** — proper measurements, diagnostic notes and repair evidence rather than only ticket status.
2. **Broad electronics support** — not phone-only. Audio, hi-fi, amps, mixers, pedals, TVs, computers and vintage equipment fit naturally.
3. **Simple by default** — advanced modules remain optional.
4. **Customer communication built in** — website enquiry → repair → quote → status → invoice is one chain.
5. **AI as workshop copilot** — surface similar faults, overdue work, missing evidence and suggested customer summaries without replacing technician judgement.
6. **Owner-friendly controls** — exports, audit history and clear permissions.

## v0.1 release boundary

Required:
- tenant-safe auth and data isolation
- shop onboarding
- owner + staff accounts
- customers, repairs and statuses
- public enquiries
- attachments/photos
- quotes/invoices
- payments recorded manually + payment link field
- stock/parts
- customer tracking portal
- email notifications
- audit trail
- CSV export
- subscription entitlement checks
- responsive PWA

Not required for first beta:
- full EPOS/till
- payroll
- ecommerce catalogue
- trade-ins
- multi-warehouse
- accounting sync
- native mobile apps
- advanced SMS bundle
- franchise reporting

Those become optional modules after the repair workflow is commercially stable.
