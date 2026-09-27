# KeepGoing v1.0

KeepGoing is an MCP service for persistent AI background jobs. It starts one OpenAI background response, preserves the job ID, and keeps polling that same job instead of asking the user to repeatedly type "continue".

## Customer flow

1. Subscribe to KeepGoing.
2. The billing backend issues a private customer token.
3. The customer receives a private MCP endpoint.
4. Add the endpoint to ChatGPT as a personal plugin/connector.
5. Start a persistent job once. KeepGoing reuses the same job ID until it reaches a terminal state.

Never publish or share a customer's tokenised MCP URL.

## Plans

- Free: 3 jobs/month (rollout after paid beta)
- Pro: £7.99/month, 100 jobs/month
- Business: £29/month, 500 jobs/month

## MCP tools

- `start_persistent_job`
- `get_persistent_job`
- `wait_for_persistent_job`
- `cancel_persistent_job`

The server instructions tell the client to keep polling the same job ID automatically when work is still running.

## Production endpoints

- `/` — product and subscription page
- `/health` — basic health status
- `/readiness` — production readiness booleans
- `/mcp` — protected MCP endpoint
- `/billing/claim` — Stripe claim endpoint
- `/billing/success` — Stripe activation page
- `/paypal/claim` — PayPal subscription claim
- `/paypal/webhook` — PayPal webhook
- `/stripe/webhook` — Stripe webhook

## Required production environment

Store secrets in Render environment variables only. Do not commit secret values.

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `KEEPGOING_AUTH_URL`
- `KEEPGOING_CLAIM_URL`
- `KEEPGOING_BILLING_INGEST_URL`
- `KEEPGOING_BILLING_INGEST_TOKEN`
- `KEEPGOING_CONFIG_URL`
- `KEEPGOING_OWNER_TOKEN_HASH`

For PayPal live checkout:

- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

When PayPal credentials are available, KeepGoing creates the KeepGoing product, Pro and Business monthly plans, and webhook automatically, with IDs persisted through the billing configuration backend.

## Security

- Customer access is token protected.
- Quota is consumed only when a new persistent job starts.
- Billing and MCP responses use no-store caching where appropriate.
- Referrer policy is no-referrer.
- Framing is disabled.
- The owner credential is stored as a SHA-256 hash and can be overridden with `KEEPGOING_OWNER_TOKEN_HASH`.
- Webhook signatures are verified before billing events are accepted.

## Release check

Run:

```bash
npm install --omit=dev
npm run check
npm start
```

Then verify `/health`, `/readiness`, invalid-token rejection on `/mcp`, and a full paid checkout/claim in the selected payment provider before opening sales.
