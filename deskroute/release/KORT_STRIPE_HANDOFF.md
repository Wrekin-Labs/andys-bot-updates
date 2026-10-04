# DeskRoute — Stripe Live Handoff for Kort

Date: 4 October 2026
Current DeskRoute release: 6.1.0-rc.2
Billing state: sandbox wired; live Stripe activation intentionally delegated to Kort.

## What is already done

DeskRoute has a commercial plan catalog in Supabase:

| Plan | Proposed monthly price | Seats | Brands | Conversations/mo | AI calls/mo |
|---|---:|---:|---:|---:|---:|
| Starter | £19 | 3 | 1 | 500 | 2,000 |
| Growth | £49 | 10 | 3 | 2,500 | 10,000 |
| Pro | £99 | 25 | 10 | 10,000 | 30,000 |

These are **proposed launch prices** and are currently configured only in Stripe sandbox.

Sandbox product/price IDs:
- Starter product `prod_VNcLRnVc7q0dT7`, price `price_1UMr6VAa3lMEDRWLDpP0gXnt`
- Growth product `prod_VNcLTGmi4OeRPj`, price `price_1UMr6dAa3lMEDRWLwD1hKNNs`
- Pro product `prod_VNcLFy5rGYjEFq`, price `price_1UMr6fAa3lMEDRWLOXgf7ajs`

Sandbox Managed Payments links exist and are stored in `cxroute_plans.stripe_test_payment_link`.

Stripe product tax code used in sandbox:
- `txcd_10103001` — Software as a Service (SaaS) - Business Use

DeskRoute's Stripe webhook path is:
`https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-email-ingest`

The webhook verifies Stripe signatures before processing events.

Events currently handled:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## What Kort needs to do for live Stripe

1. Finish/verify the **DeskRoute AI live Stripe account**.
2. Confirm whether **Managed Payments** is approved/eligible for the live account.
3. Confirm the final Starter/Growth/Pro pricing with Andy before creating live prices.
4. Create the live DeskRoute products and recurring monthly GBP prices.
5. Use the correct live product tax classification after reviewing the product/customer type.
6. Create live hosted Checkout/Payment Links or hosted Checkout Sessions.
7. Configure Stripe Customer Portal for:
   - payment method updates
   - invoices/receipts
   - cancellation at period end
   - plan changes only if we decide to allow self-serve upgrades/downgrades
8. Register the live webhook endpoint shown above and enable the event list above.
9. Put the live webhook signing secret into Supabase Vault as:
   - `deskroute-stripe-live-webhook-secret`
   Never commit the secret to GitHub.
10. Put live price IDs and live checkout/payment links into:
   - `cxroute_plans.stripe_live_price_id`
   - `cxroute_plans.stripe_live_payment_link`
11. Run one live £-value subscription with Andy/Kort as the controlled launch test.
12. Verify the DeskRoute `cxroute_subscriptions` row becomes active and contains the Stripe customer/subscription IDs.
13. Test cancellation-at-period-end and failed-payment handling.
14. Only then remove the "sandbox/commercial preview" wording from the public DeskRoute site.

## Important reconciliation rule

DeskRoute Checkout links append the DeskRoute workspace UUID as Stripe `client_reference_id`.
Stripe returns that in `checkout.session.completed`.
The webhook uses it to attach the Stripe subscription to the correct DeskRoute organisation.

Do not replace it with an email address, business name or other mutable field.

## Secrets

Never put these in the public website or repository:
- Stripe secret API key
- webhook signing secret
- Supabase service-role key
- VAPID private key
- database credentials

## Trial behaviour

New self-service DeskRoute workspaces are currently created with a **14-day trialing subscription** for the selected Starter/Growth/Pro plan.
The website chat stops treating an expired trial as active.
When a live Stripe checkout succeeds, billing should replace/update the workspace subscription with the active Stripe subscription.

## Final commercial checks before switching live billing on

- Final prices approved by Andy
- Live Stripe account activated
- Managed Payments eligibility confirmed, or normal Stripe + tax approach selected
- Customer Portal configured
- Live webhook verified
- Final Privacy Policy
- Final Terms
- DPA
- Subprocessor list
- Support contact and response expectations
- Cancellation/refund wording
- Backup/restore process documented

Do not switch the public site from sandbox-preview wording until those are complete.
