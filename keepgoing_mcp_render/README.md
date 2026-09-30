# KeepGoing v1.2 beta

**Current beta:** `1.2.0-beta.2` — adds the `continue_until_done` primary entrypoint, host-context passthrough, and stricter only-when-genuinely-blocked user stops.

KeepGoing is an MCP service for durable AI jobs. A KeepGoing job has its own stable job ID and can span multiple OpenAI Agents API turns. The server persists safe orchestration state, watches for completed/partial turns, and can start the next continuation without requiring the user to repeatedly type "continue".

v1.2 is developed behind `KEEPGOING_V12_ENABLED`. Keep the production v1.1 path available until the v1.2 database migration, webhook and live preflight are complete.

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

Before starting the durable job, the host may gather relevant context already available in the conversation and, when useful and permitted, from connected ChatGPT tools/plugins, then pass a concise context bundle into the job. The KeepGoing service itself does not have blanket access to private ChatGPT history or every installed plugin; those capabilities remain controlled by the ChatGPT host and their normal permissions.

Once the durable job starts, the server-side webhook/watchdog path advances `STATUS: PARTIAL` work automatically. The user should not need to type "continue" merely to move the same objective forward. A job stops only when it is completed, genuinely needs user input/approval, is cancelled, fails safely, or reaches its configured safety/cost budget.

## Customer flow

1. Subscribe to KeepGoing.
2. Receive a private activation token.
3. Connect `/mcp` in ChatGPT using OAuth.
4. Enter the activation token only on the KeepGoing OAuth page.
5. Start a durable job once.
6. KeepGoing reuses the same job ID while its server-side watchdog/webhook path advances the work.
7. Use `list_persistent_jobs` in a later chat to recover active jobs if needed.

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
- `list_tool_profiles` — discover approved background capability profiles before starting code/file/workstation jobs.

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

- `/` — product and subscription page
- `/health` — lightweight process/config health
- `/readiness` — production readiness, including live durable-store reachability when v1.2 is enabled
- `/mcp` — protected MCP endpoint
- `/openai/webhook` — signed OpenAI Agents session webhook receiver (v1.2)
- `/billing/claim` — Stripe claim endpoint
- `/billing/success` — Stripe activation page
- `/paypal/claim` — PayPal subscription claim
- `/paypal/webhook` — PayPal webhook
- `/stripe/webhook` — Stripe webhook

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
- `KEEPGOING_SUPABASE_URL` (or `SUPABASE_URL`)
- `KEEPGOING_SUPABASE_SERVICE_KEY`
- `OPENAI_WEBHOOK_SECRET`
- optional watchdog interval configuration

Optional owner background tools:

**Private GitHub worker**
- `KEEPGOING_WORKER_MCP_SECRET` — random internal bearer secret used only between OpenAI Agents and the private `/worker-mcp` endpoint.
- `KEEPGOING_GITHUB_TOKEN` — GitHub fine-grained token/PAT with only the required repository permissions.
- `KEEPGOING_GITHUB_REPOS` — comma-separated exact `owner/repo` allowlist.
- `KEEPGOING_GITHUB_BRANCH_PREFIX` — safe write prefix, default `keepgoing/`.
- `KEEPGOING_WORKER_MCP_URL` — optional override; defaults to `<public-base>/worker-mcp`.

When all required GitHub worker values are present, KeepGoing adds owner-only:
- `github-read` — repository metadata, directories, files, code search and comparisons.
- `github-write` — all read tools plus safe-branch creation, file create/update and pull-request opening. It cannot merge PRs, change repo settings or write directly to the default/protected branch.

**Project Relay**
- `KEEPGOING_RELAY_MCP_URL` — public HTTPS Project Relay MCP endpoint.
- Prefer `KEEPGOING_RELAY_MCP_CREDENTIAL_ID` for an OpenAI Agents Vault credential.
- Or use `KEEPGOING_RELAY_MCP_AUTHORIZATION` as a server-side authorization value when vault credentials are not used.
- `KEEPGOING_ENABLE_RELAY_ADMIN_PROFILE=true` — optional and off by default; exposes a broader destructive owner-only Relay admin profile.

When Relay is configured, KeepGoing adds:
- `relay-read` — diagnostics, approved-root reads/searches, processes/windows and supervised-app status.
- `relay-developer` — read tools plus approved-root text/document edits, bounded commands, sandbox/terminal work and supervised-app start/restart.
- `relay-admin` — only when explicitly enabled; includes filesystem delete, services, scheduled tasks, software administration, self-update and power actions.

**Other MCP servers**
- `KEEPGOING_TOOL_PROFILES_JSON` can define additional explicit HTTPS MCP profiles with per-server `allowed_tools` allowlists.
- Write-capable profiles must be owner-only.
- Secret headers are not accepted in JSON; use an OpenAI Vault `credential_id` or an environment authorization reference.

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


## Background tool profiles

The foreground ChatGPT connection and the durable OpenAI Agent session do not automatically share connector permissions. For a code/file/workstation objective, the host should call `list_tool_profiles`, select the least-powerful profile that can complete the job, and pass its name as `toolProfile` to `continue_until_done` or `start_persistent_job`.

Security rules:
- default profile is `web`;
- owner/write profiles never become available to non-owner accounts;
- every MCP server requires an explicit `allowed_tools` list;
- tool credentials are kept in server secret storage or OpenAI Agents Vault, not durable job rows;
- each durable job stores the profile name and policy hash used when it started;
- MCP/tool calls are audit-recorded as safe metadata only: tool type/name/server/status/turn, never arguments or outputs;
- tool calls count against the same hard per-job tool budget;
- changing a profile later does not silently broaden an already-created Agent session.
