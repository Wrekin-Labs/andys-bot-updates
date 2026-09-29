# KeepGoing v1.2 beta

**Current beta:** `1.2.0-beta.6` — separates direct web subscriptions from the public ChatGPT plugin experience and limits host-supplied checkpoint context to the minimum task-specific text.

KeepGoing is an MCP service for durable AI jobs. A KeepGoing job has its own stable job ID and can span multiple OpenAI Agents API turns. The server persists safe orchestration state, watches for completed/partial turns, and can start the next continuation without requiring the user to repeatedly type "continue".

v1.2 remains feature-flagged behind `KEEPGOING_V12_ENABLED`. Production currently runs the durable engine in owner-canary mode with the durable store and watchdog live. Public paid rollout should keep canary-only mode until the signed OpenAI webhook and a live payment provider are configured and verified.

## What v1.2 changes

v1.1 preserved one OpenAI background Response ID and polled it.

v1.2 instead:
- reserves a stable KeepGoing job before provider work starts;
- maps that job to an OpenAI Agent session;
- validates each root turn as `COMPLETED`, `NEEDS_USER` or `PARTIAL`;
- automatically continues `PARTIAL` work within hard budgets;
- uses compare-and-set state plus idempotency keys to prevent duplicate starts/continuations;
- recovers missed webhook/poll events with a watchdog;
- lets a new chat list and recover the customer's active jobs;
- safely resumes the same job after genuine user input is required;
- keeps raw prompts, model output, OAuth tokens and activation tokens out of the durable job database.

KeepGoing does not control ChatGPT's private reasoning, bypass ChatGPT/OpenAI limits, or force a new ChatGPT message after a chat turn has already ended. The durable server job can continue independently; the user/client can later retrieve it by job ID.

## Autopilot host behaviour

When the user says **continue**, **keep going**, **finish it**, **until done**, **don't stop**, or equivalent, the ChatGPT host should prefer `continue_until_done`.

Before starting a durable job, the host may pass a brief task-specific checkpoint when it is genuinely needed. The field is intentionally capped at 4,000 characters and must not contain full chat transcripts, credentials, API keys, payment secrets or unrelated personal data. KeepGoing does not independently retrieve private ChatGPT history or every installed plugin.

Once the durable job starts, the server-side webhook/watchdog path advances `STATUS: PARTIAL` work automatically. The user should not need to type "continue" merely to move the same objective forward. A job stops only when it is completed, genuinely needs user input/approval, is cancelled, fails safely, or reaches its configured safety/cost budget.

## Customer flow

1. Have an existing KeepGoing account and private activation token provisioned outside the ChatGPT plugin experience.
2. Connect `/mcp` in ChatGPT using OAuth.
3. Enter the activation token only on the KeepGoing OAuth page.
4. Start a durable job once.
5. KeepGoing reuses the same job ID while its server-side watchdog/webhook path advances the work.
6. Use `list_persistent_jobs` in a later chat to recover active jobs if needed.

Never share an activation token, OAuth token or other account credential.

## Plans and technical limits

- Free: 3 jobs/month (rollout after paid beta).
- Pro: £7.99/month, 100 jobs/month, up to 3 web/tool calls per durable job.
- Business: £29/month, 500 jobs/month, up to 5 web/tool calls per durable job.

v1.2 also applies aggregate per-job continuation budgets:
- Pro: up to 6 turns/attempts, 20,000 aggregate model tokens, 2-hour wall-clock window.
- Business: up to 8 turns/attempts, 30,000 aggregate model tokens, 4-hour wall-clock window.

These are safety/cost ceilings, not promised consumption targets. A job stops earlier when completed or when user input is genuinely required.

## MCP tools

- `continue_until_done` — preferred natural-language autopilot entrypoint for "continue / keep going / finish it / until done".
- `start_persistent_job` — create or idempotently recover a durable job.
- `get_persistent_job` — read current status/result.
- `wait_for_persistent_job` — bounded wait on the same job ID.
- `cancel_persistent_job` — cancel the durable job/provider turn.
- `list_persistent_jobs` — list the authenticated customer's own recent/active jobs using safe metadata only.
- `resume_persistent_job` — deliver required user input to the same durable job with race-safe/idempotent delivery.

## Durable states

- `queued`
- `working`
- `continuing`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `budget_exhausted`

The model is instructed to end every root turn with one marker:
- `STATUS: COMPLETED`
- `STATUS: NEEDS_USER`
- `STATUS: PARTIAL`

The server validates that marker against provider turn state and tool failures; text alone does not decide success.

## Production endpoints

- `/` — public informational/plugin landing page (no subscription transaction UI)
- `/health` — lightweight process/config health
- `/readiness` — production readiness, including live durable-store reachability when v1.2 is enabled
- `/mcp` — protected MCP endpoint
- `/openai/webhook` — signed OpenAI Agents session webhook receiver (v1.2)
- `/subscribe` — direct web subscription checkout; intentionally unlinked/noindex from the public plugin experience
- `/billing/claim` — Stripe claim endpoint
- `/billing/success` — Stripe activation page
- `/paypal/claim` — PayPal subscription claim
- `/paypal/webhook` — PayPal webhook
- `/stripe/webhook` — Stripe webhook
- `/icon.svg` — hosted KeepGoing brand icon
- `/manifest.json` — app/web manifest
- `/privacy` — privacy policy
- `/terms` — terms of service
- `/refunds` — refunds & cancellation policy
- `/support` — support page
- `/security` — security overview

## Required production environment

Store secrets in Render/environment-secret storage only. Never commit secret values.

Core:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (commercial default currently uses GPT-6 Luna unless overridden)
- `KEEPGOING_AUTH_URL`
- `KEEPGOING_CLAIM_URL`
- `KEEPGOING_BILLING_INGEST_URL`
- `KEEPGOING_BILLING_INGEST_TOKEN`
- `KEEPGOING_CONFIG_URL`
- `KEEPGOING_OWNER_TOKEN_HASH`
- `KEEPGOING_OAUTH_SECRET`
- `KEEPGOING_OAUTH_CODE_URL`
- `KEEPGOING_PUBLIC_BASE_URL`

v1.2 durable engine:
- `KEEPGOING_V12_ENABLED=true`
- `KEEPGOING_V12_CANARY_ONLY=true` during owner-only staged validation; set false/omit only after the live drills pass
- either direct durable-store credentials (`KEEPGOING_SUPABASE_URL` / `SUPABASE_URL` plus `KEEPGOING_SUPABASE_SERVICE_KEY`) **or** the narrow durable-store proxy (`KEEPGOING_DURABLE_STORE_URL` plus `KEEPGOING_DURABLE_STORE_TOKEN`)
- `OPENAI_WEBHOOK_SECRET` for production signed-webhook processing
- optional watchdog interval configuration

Apply `sql/durable_jobs.sql` through the normal reviewed Supabase migration workflow before enabling v1.2. The schema uses RLS plus explicit service-role-only access.

PayPal live checkout:
- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

## Security and reliability

- OAuth 2.1 authorization-code flow with PKCE protects ChatGPT connections.
- Durable job ownership is scoped to the authenticated customer hash.
- Client request IDs are hashed before durable storage.
- Start, continuation and resume paths use durable reservation/CAS plus provider idempotency keys.
- Signed OpenAI webhooks are verified before processing.
- Webhook event IDs are deduplicated.
- The watchdog repairs missed webhook/poll progress without blindly creating a duplicate provider session.
- Active jobs have hard attempt, token, tool-call and wall-clock limits.
- Durable metadata retention is bounded; active jobs are not deleted by retention cleanup.
- The durable database stores orchestration metadata/hashes rather than raw prompts/model output.
- Sensitive HTTP responses use no-store caching where appropriate.
- Secrets are redacted from safe watchdog/service errors.

## Release check

From `keepgoing_mcp_render`:

```bash
npm install --omit=dev
npm run verify
npm start
```

Recommended staged rollout: first enable `KEEPGOING_V12_ENABLED=true` together with `KEEPGOING_V12_CANARY_ONLY=true`. This exposes v1.2 only to the owner account while ordinary subscribers remain on v1.1 with normal quota charging. Remove/disable canary-only mode only after the owner drills pass.

Before enabling v1.2 for paid customers, verify:
1. CI passes on the exact release commit.
2. `sql/durable_jobs.sql` is applied to the intended Supabase project.
3. `/readiness` reports `ok: true`, `durable_engine_ready: true`, `durable_store_ready: true`, and `openai_webhook_ready: true`.
4. Invalid OAuth/token access is rejected without consuming quota.
5. A real durable test job progresses PARTIAL -> continuation -> COMPLETED.
6. Duplicate starts return the original job and consume quota once.
7. `NEEDS_USER` -> `resume_persistent_job` resumes the same job once.
8. A missed webhook is repaired by the watchdog.
9. PayPal/Stripe subscription claim and cancellation flows are tested in the selected live provider.
10. Privacy, Terms, Support and Security pages match the deployed data flow.

## Current commercial beta status

As of the beta.6 candidate:
- OAuth connection is live and verified with the owner account.
- Durable engine, durable store and watchdog recovery are live in owner-canary mode.
- The public informational site, hosted icon/manifest, FAQ, status, changelog, Privacy, Terms, Refunds & cancellation, Support and Security pages are live.
- Direct subscription checkout is isolated from the public plugin/listing experience and remains unavailable until live PayPal REST credentials are added to Render.
- Automatic subscription-token provisioning and cancellation/suspension revocation are implemented.
- The signed OpenAI webhook endpoint is implemented but `OPENAI_WEBHOOK_SECRET` is not yet configured; owner canary currently relies on watchdog recovery.
- Public directory submission/approval, reviewer credentials and final publisher/domain verification remain external release steps and must not be reported as completed until actually approved.

Production readiness remains intentionally strict: `sell_ready` must stay false until live checkout, signed webhook delivery and non-canary durable rollout are all genuinely ready.
## Public-plugin commerce boundary

The public ChatGPT plugin/listing experience is informational and authentication-only for existing KeepGoing accounts. It does not initiate a new digital-service subscription or promote an upgrade inside ChatGPT.

Direct paid-beta checkout is isolated at `/subscribe`, is not linked from the public plugin website/install/FAQ/sitemap, and is marked noindex/no-store. This direct web route is for users who intentionally arrive outside the ChatGPT plugin experience.
