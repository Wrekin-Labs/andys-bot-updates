# KeepGoing v1.5 beta

**Current beta:** `1.5.0-beta.1` (artifact-finalisation line) — durable multi-turn jobs, public-GitHub coding workspaces, bounded selected-file handoff, checksummed artifact manifests and job reports, alongside watchdog-first recovery, idempotent startup/continuation, owner auto-continue, secure external PayPal checkout and runtime hardening.

The release version lives in `package.json` only; `server.js`, `/version`, `/readiness` and `plugin.json` (checked by tests) follow it.

## What's new in 1.5.0-beta.1

Security
- Legacy (v1.1) jobs are bound to their owner via Responses metadata; get/wait/cancel refuse other accounts' ids. Previously any authenticated customer could read or cancel any response id in KeepGoing's OpenAI project.
- Durable owner identity fails closed instead of falling back to a shared tier-wide owner.
- Query-string tokens (`/mcp?token=`) are refused unless `KEEPGOING_ALLOW_QUERY_TOKEN=1`.
- Tool errors are client-safe: KeepGoing validation messages pass through, provider/store internals are replaced by a generic message with a request reference.
- Stripe webhooks accept every `v1` signature during secret rotation.
- Per-IP and per-account MCP rate limits; per-account caps on concurrently running jobs.

Durable correctness
- Start requests without `clientRequestId` derive their idempotency key from the JSON-RPC id **and** the arguments (10-minute window). The old key used the JSON-RPC id alone, so an unrelated later job could silently return an earlier one.
- Cancel retries on version conflicts, stops a continuation that was in flight, and works on `input_required` jobs. Completed/cancelled/budget-exhausted jobs can never be resurrected (application CAS filter + optional DB trigger).
- Completion markers are read from agent output only (never the prompt), using the final marker.
- `resume_persistent_job` no longer wedges permanently after an unconfirmed delivery from an earlier checkpoint.
- Watchdog: no overlapping passes, failing jobs are deferred instead of starving the queue, jobs unrecoverable after their deadline are dead-lettered as `recovery_failed`, and shutdown drains an in-flight pass. Provider turns that stay `working` without advancing their turn/token/tool progress for the stall window are restarted in the same durable job, with bounded retry count.
- Provider (30 s) and store (10 s) calls are bounded and classified (`provider_timeout`, `provider_rate_limited`, `store_timeout`, …).

Artifacts and coding
- Deterministic artifact manifest (sorted; name, MIME type, size, `readable` flag); strict `/workspace/outputs/` path validation (no `..`, no directory entries).
- `read_job_artifact` streams with a hard 500 KB cap, rejects binary content, and returns a SHA-256 checksum.
- New read-only `get_job_report` tool: status, progress, budget diagnostics, checksummed result excerpt, artifact manifest and next step.
- Coding jobs are told to treat repository content as untrusted and to finish with `/workspace/outputs/changes.patch` and `REPORT.md`.
- Wider credential-file rejection for selected-file handoff (`.netrc`, `.git-credentials`, `.ssh/`, `.aws/`, keystores, Terraform state, service-account JSON…).

Operations
- Structured JSON logs (`logger.js`) with request ids and secret redaction; startup configuration validation (`config_check.js`) that logs variable names, never values.
- `/version` capability endpoint; `/readiness` adds `release`, `config_ok`, `watchdog`.
- `npm run preflight -- --v12` now requires the watchdog (webhook only with `--webhook`); `--release=<version>` catches stale deployments.

KeepGoing is an MCP service for durable AI jobs. A KeepGoing job has its own stable job ID and can span multiple OpenAI Agents API turns. The server persists safe orchestration state, watches for completed/partial turns, and can start the next continuation without requiring the user to repeatedly type "continue".

v1.2 remains feature-flagged behind `KEEPGOING_V12_ENABLED`. Production now runs the durable engine beyond owner-canary mode with the durable store and watchdog live. The watchdog durability drills and live PayPal readiness checks have passed. OpenAI webhook delivery remains optional for the current Agents-session engine.

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

## Coding workspace (beta.23)

Coding jobs no longer have to rely only on prompt context.

Set `codingWorkspace=true` on `start_persistent_job` or `continue_until_done`. Optionally provide:

- `repositoryUrl` — a **public** `https://github.com/owner/repo` URL.
- `repositoryRef` — an optional safe branch, tag or commit-like Git ref.

KeepGoing creates the smallest OpenAI-hosted sandbox, clones the repo into `/workspace/project`, and keeps that workspace across turns in the durable Agent session. The Agent can inspect files, edit locally, run tests and write useful patch/report outputs under `/workspace/outputs`.

Safety boundary for this first release:

- public GitHub repositories only;
- embedded GitHub usernames/passwords/tokens in URLs are rejected;
- no private-repository credential flow;
- no GitHub push credentials are supplied;
- the Agent is explicitly told not to push;
- sandbox outbound networking is restricted to common source/package hosts;
- local Bash/apply-patch work does not consume the 3/5 external web/MCP/function-call allowance;
- failed shell commands still prevent a false `COMPLETED` result.

Hosted coding workspaces have shorter wall-clock ceilings to bound container cost: Pro 30 minutes; Business/owner 60 minutes.

### Selected local/uncommitted files (beta.24)

When a coding task depends on text files that are not yet in the public repository, the foreground client can explicitly pass `workspaceFiles` with only the task-relevant files already available in the current task context.

Limits:
- up to 8 files;
- up to 32 KB UTF-8 text per file;
- up to 128 KB total;
- safe relative project paths only;
- selected files are overlaid into `/workspace/project` after the repository checkout;
- high-risk key/config filename patterns are rejected;
- validation happens before durable reservation/quota use;
- the file bodies are sent in the provider session-creation request and are not written into KeepGoing's durable job database.

This is a bounded handoff, not general filesystem access. KeepGoing still cannot browse arbitrary files on the user's computer.

Files intentionally written by the Agent under `/workspace/outputs` are published by the hosted session as immutable artifacts after a completed turn. KeepGoing exposes:
- `list_job_artifacts` — safe metadata for published output files owned by that job.
- `read_job_artifact` — reads small text artifacts such as patches, diffs, Markdown, JSON or logs (up to 512 KB).

Files outside `/workspace/outputs` are not exposed by these tools.


## Plans and technical limits

- Free: 3 jobs/month (rollout after paid beta).
- Pro: £7.99/month, 100 jobs/month, up to 3 web/tool calls per durable job.
- Business: £29/month, 500 jobs/month, up to 5 web/tool calls per durable job.

The durable engine also applies aggregate per-job continuation budgets:
- Pro: up to 6 turns/attempts, 20,000 aggregate model tokens, 2-hour wall-clock window for normal jobs; 30 minutes when a coding workspace is enabled.
- Business: up to 8 turns/attempts, 30,000 aggregate model tokens, 4-hour wall-clock window for normal jobs; 60 minutes when a coding workspace is enabled.

These are safety/cost ceilings, not promised consumption targets. A job stops earlier when completed or when user input is genuinely required.

## MCP tools

- `continue_until_done` — preferred natural-language autopilot entrypoint for "continue / keep going / finish it / until done".
- `start_persistent_job` — create or idempotently recover a durable job.
- `get_persistent_job` — read current status/result.
- `wait_for_persistent_job` — bounded wait on the same job ID.
- `cancel_persistent_job` — cancel the durable job/provider turn.
- `list_persistent_jobs` — list the authenticated customer's own recent/active jobs using safe metadata only.
- `resume_persistent_job` — deliver required user input to the same durable job with race-safe/idempotent delivery.
- `list_job_artifacts` — list patch/report artifacts published by an owned coding job.
- `read_job_artifact` — read a small text patch/report artifact (≤ 500 KB) from an owned coding job, with SHA-256.
- `get_job_report` — read-only, deterministic summary of an owned job (status, diagnostics, checksummed result excerpt, artifact manifest, next step).

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
- `/version` — release, engine, tool names, limits and feature flags for support/compatibility checks (no account data)
- `/mcp` — protected MCP endpoint
- `/openai/webhook` — signed OpenAI Agents session webhook receiver (v1.2)
- `/subscribe` — direct web subscription checkout; intentionally unlinked/noindex from the public plugin experience
- `/billing/claim` — Stripe claim endpoint
- `/billing/success` — Stripe activation page
- `/paypal/start-subscription` — server-side PayPal subscription creation and approval redirect
- `/paypal/return` — validated PayPal approval return route
- `/paypal/claim` — PayPal subscription activation claim
- `/paypal/webhook` — PayPal webhook
- `/stripe/webhook` — Stripe webhook
- `/icon.svg` — hosted vector KeepGoing brand icon
- `/icon.png` — hosted 256×256 PNG app/social icon
- `/.well-known/security.txt` — standard security contact metadata
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
- optional `OPENAI_WEBHOOK_SECRET` only when a compatible OpenAI webhook event stream is used; watchdog continuation does not require it
- optional watchdog interval configuration

Apply `sql/durable_jobs.sql` through the normal reviewed Supabase migration workflow before enabling v1.2. The schema uses RLS plus explicit service-role-only access. For 1.5, also apply `sql/durable_jobs_v1_5.sql` (re-runnable; adds the no-resurrection/owner-immutability trigger, recovery index, and four provider-progress fields used by bounded stall recovery). Apply this migration before deploying the 1.5 service code. `sql/verify_durable_migrations.sql` exercises both against a scratch PostgreSQL database.

Optional 1.5 tuning (all have safe defaults):
- `KEEPGOING_MAX_ACTIVE_JOBS_PRO` / `_BUSINESS` / `_OWNER` (defaults 5 / 15 / 50 running jobs)
- `KEEPGOING_MCP_RATE_LIMIT_PER_MINUTE` (default 120 per account; 2× per IP)
- `KEEPGOING_PROVIDER_TIMEOUT_MS` (default 30000), `KEEPGOING_STORE_TIMEOUT_MS` (default 10000)
- `KEEPGOING_STALL_AFTER_MS` (default 300000 / 5 minutes), `KEEPGOING_MAX_STALL_RECOVERIES` (default 2)
- `KEEPGOING_LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`)
- `KEEPGOING_ALLOW_QUERY_TOKEN=1` — temporary escape hatch to accept `?token=` (not recommended)
- `KEEPGOING_LEGACY_ALLOW_UNBOUND_READS=1` — temporary escape hatch to let customers read legacy jobs created before owner binding

PayPal live checkout:
- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

## Security and reliability

- OAuth 2.1 authorization-code flow with PKCE protects ChatGPT connections.
- Durable job ownership is scoped to the authenticated customer hash.
- Client request IDs are hashed before durable storage.
- Start, continuation and resume paths use durable reservation/CAS plus provider idempotency keys. Transient initial-session failures are retried with the same start key and accepted sessions can be recovered by durable job metadata.
- Signed OpenAI webhooks are verified before processing.
- Webhook event IDs are deduplicated.
- The watchdog repairs missed webhook/poll progress without blindly creating a duplicate provider session.
- Active jobs have hard attempt, token, external-tool-call and wall-clock limits.
- Coding workspaces use a restricted outbound network and reject repository URLs containing credentials.
- Coding workspace shell/apply-patch operations are local sandbox work, not counted as paid web/MCP/function calls.
- Durable metadata retention is bounded; active jobs are not deleted by retention cleanup.
- The durable database stores orchestration metadata/hashes rather than raw prompts/model output.
- Sensitive HTTP responses use no-store caching where appropriate.
- OAuth authorization pages use a restrictive Content Security Policy and noindex/no-store handling.
- Upstream PayPal/billing/auth/claim requests have bounded timeouts so provider stalls fail promptly.
- Customer-facing billing claim failures use generic errors while server logs use sanitized diagnostics.
- Secrets are redacted from safe watchdog/service errors.
- PayPal activation-token claims require a server-generated random claim binding that must match the subscription `custom_id` returned by PayPal.

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
3. `/readiness` reports `ok: true`, `durable_engine_ready: true`, `durable_store_ready: true`, and `watchdog_ready: true`.
4. Invalid OAuth/token access is rejected without consuming quota.
5. A real durable test job progresses PARTIAL -> continuation -> COMPLETED.
6. Duplicate starts return the original job and consume quota once.
7. `NEEDS_USER` -> `resume_persistent_job` resumes the same job once.
8. A missed webhook is repaired by the watchdog.
9. PayPal/Stripe subscription claim and cancellation flows are tested in the selected live provider.
10. Privacy, Terms, Support and Security pages match the deployed data flow.

## Current commercial beta status

Production evidence below was recorded for the beta.24 candidate. It has **not** been re-collected for 1.5.0-beta.1; repeat the release checks above on the 1.5 deployment before relying on it.

As of the beta.24 candidate:
- OAuth connection is live and verified with the owner account.
- Durable engine, durable store and watchdog recovery are live with owner-canary mode disabled.
- Live durability drills have passed, including multi-turn continuation, watchdog recovery and launch smoke testing.
- The public informational site, hosted icon/manifest, FAQ, status, changelog, Privacy, Terms, Refunds & cancellation, Support and Security pages are live.
- Direct subscription checkout is isolated from the public plugin/listing experience and is live through PayPal in production mode. Beta.19 uses a server-side PayPal approval redirect so checkout does not depend on embedded PayPal button rendering.
- PayPal credentials are recoverable after restart through protected encrypted storage, and production startup reports PayPal live subscriptions ready.
- Automatic subscription-token provisioning and cancellation/suspension revocation are implemented. PayPal activation claims are bound to a random checkout-specific `custom_id`, so a subscription ID alone cannot rotate access.
- The signed OpenAI webhook endpoint remains available as an optional accelerator; the tested watchdog is the production durability mechanism for the current Agents-session engine.
- `/readiness` reports no commercial blockers and `sell_ready: true` when the production dependencies are healthy.
- Beta.23 adds the opt-in public-GitHub coding workspace so durable coding jobs can inspect/edit/test real files instead of failing with a no-files tooling limit.
- Beta.24 adds explicit selected-file handoff so a small set of task-relevant local/uncommitted UTF-8 files can be overlaid into the hosted coding workspace without broad PC access.
- Public directory submission/approval, reviewer credentials and final publisher/domain verification remain external release steps and must not be reported as completed until actually approved.
## Public-plugin commerce boundary

The public ChatGPT plugin/listing experience is authentication and existing-account functionality only. It does not show subscription plans, initiate a new digital-service subscription, link to transactional checkout, or promote upgrades inside ChatGPT.

Direct paid-beta checkout is isolated at `/subscribe`, is not linked from the public plugin website/install/FAQ/status/sitemap or advertised in plugin metadata, and is marked noindex/no-store. This direct web route exists outside the ChatGPT plugin acquisition and upgrade experience.
