# Security and commercial readiness notes

## Existing strengths
The ERA schema already uses:
- shop_id across most business tables
- Supabase RLS
- membership helper functions
- role-aware permissions
- audit logging
- private attachment metadata
- public enquiry rate limiting
- server-side privileged functions

## Critical pre-beta work

### Cross-tenant policy audit
Test every policy as:
- owner in Shop A
- technician in Shop A
- owner in Shop B
- unauthenticated user

Automated tests must prove Shop A cannot read, update, insert against or delete Shop B data.

### Known measurement-policy issue
Current era_measurements policies contain an EXISTS clause comparing r.shop_id = r.shop_id, which is tautological.

Commercial code must verify:
- referenced repair_id exists
- repair.shop_id equals measurement.shop_id
- user is authorised for that same shop

Do not copy the current policy unchanged.

### Global configuration review
Any table with SELECT true or write rules not tied to shop_id must be classified as intentionally global or fixed.

### Storage
- private buckets by default
- short-lived signed URLs
- object paths prefixed by shop_id
- storage policies matching membership
- no public repair photos

### Public forms
- opaque shop public keys
- server-side validation
- rate limiting
- body-size caps
- no internal errors or secrets returned

### Billing entitlements
Subscription state is server-controlled. Client-side hiding is not authority.

### Exports and deletion
- owner-only
- audit logged
- background jobs for large exports
- retention window for account deletion
- legal retention handling for financial records

## Launch gate
No external paying shop until:
- tenant-isolation suite passes
- backup restore tested
- incident runbook exists
- privacy/DPA/subprocessor list exists
- owner can export all data
- subscription cancellation does not immediately destroy data
