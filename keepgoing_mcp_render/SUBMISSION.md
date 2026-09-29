# KeepGoing — Public Plugin Submission Kit

Version: 1.2.0-beta.6 commercial beta candidate
Updated: 29 September 2026

## Listing

**Plugin name:** KeepGoing

**Category:** Productivity

**Short description:** Run substantial AI work as a durable job that can continue across multiple model turns without repeatedly asking you to type “continue”.

**Long description:** KeepGoing creates a stable durable job for substantial model work and research. The job is mapped to an OpenAI Agent session and can advance through multiple turns while KeepGoing persists safe orchestration state, enforces hard usage limits, and recovers from missed polling/webhooks. ChatGPT can later check, wait for, list, resume, or cancel the same job. KeepGoing does not control ChatGPT’s private reasoning, bypass platform safeguards or product limits, or force a new ChatGPT message after a chat turn has ended.

**Developer name:** Use the exact verified developer/business identity selected in the OpenAI Platform submission portal.

**Website:** https://keepgoing-mcp.onrender.com/  
**Support:** https://keepgoing-mcp.onrender.com/support  
**Privacy:** https://keepgoing-mcp.onrender.com/privacy  
**Terms:** https://keepgoing-mcp.onrender.com/terms  
**Security:** https://keepgoing-mcp.onrender.com/security  
**Refunds & cancellation:** https://keepgoing-mcp.onrender.com/refunds  
**Icon:** https://keepgoing-mcp.onrender.com/icon.svg  
**MCP server:** https://keepgoing-mcp.onrender.com/mcp

A branded production domain is recommended before public submission. If the Render subdomain is retained, use it consistently for OAuth discovery, privacy/terms, support and domain verification.

## Authentication

OAuth 2.1 authorization-code flow with PKCE S256.

Protected resource metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-protected-resource

Authorization-server metadata:
https://keepgoing-mcp.onrender.com/.well-known/oauth-authorization-server

Scope:
`keepgoing.jobs`

Existing KeepGoing account holders authenticate with a private activation token on KeepGoing’s OAuth page. ChatGPT receives short-lived OAuth credentials; the activation token is not embedded in the MCP endpoint URL. The public plugin does not initiate or promote new digital-service subscriptions.

## Commerce boundary

KeepGoing's public ChatGPT plugin experience is informational/authentication-only for existing accounts. Tool descriptions, starter prompts, OAuth pages, install pages and public listing pages do not initiate checkout, link to a transactional upgrade, or ask ChatGPT to sell a digital subscription.

A separate direct web route `/subscribe` exists for intentional off-plugin paid-beta sales. It is unlinked from the public plugin/listing experience, excluded from the sitemap, disallowed in robots.txt and served with no-store/noindex handling.
## Tools

### continue_until_done — “Continue until done”
Preferred entrypoint for “keep going / continue / finish this / until done”. Creates or idempotently reuses a durable KeepGoing job with maximum autonomous continuation semantics while preserving normal host/tool permissions.
- readOnlyHint: false
- destructiveHint: false
- idempotentHint: false
- openWorldHint: true
- OAuth scope: keepgoing.jobs
### start_persistent_job — “Start persistent job”
Creates or idempotently reuses a durable KeepGoing job.
- readOnlyHint: false
- destructiveHint: false
- idempotentHint: false
- openWorldHint: true
- OAuth scope: keepgoing.jobs

### get_persistent_job — “Get persistent job”
Reads current state and latest available output for one owned durable job.
- readOnlyHint: true
- destructiveHint: false
- idempotentHint: true
- openWorldHint: false
- OAuth scope: keepgoing.jobs

### wait_for_persistent_job — “Wait for persistent job”
Waits for a bounded interval on the same durable job ID.
- readOnlyHint: true
- destructiveHint: false
- idempotentHint: true
- openWorldHint: false
- OAuth scope: keepgoing.jobs

### cancel_persistent_job — “Cancel persistent job”
Cancels the owned durable job/provider turn.
- readOnlyHint: false
- destructiveHint: true
- idempotentHint: true
- openWorldHint: false
- OAuth scope: keepgoing.jobs

### list_persistent_jobs — “List persistent jobs”
Lists the authenticated customer’s own recent/active durable jobs using safe metadata only. It does not expose raw prompts.
- readOnlyHint: true
- destructiveHint: false
- idempotentHint: true
- openWorldHint: false
- OAuth scope: keepgoing.jobs

### resume_persistent_job — “Resume persistent job”
Provides required user input to the same `input_required` durable job. Delivery is CAS-claimed and idempotency-keyed to prevent duplicate resumes.
- readOnlyHint: false
- destructiveHint: false
- idempotentHint: true
- openWorldHint: true
- OAuth scope: keepgoing.jobs

## Durable semantics reviewers should understand

A KeepGoing job has a stable `kgj_...` identifier that is distinct from the provider session ID.

The durable states are:
- `queued`
- `working`
- `continuing`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `budget_exhausted`

Every root model turn is required to end with one of:
- `STATUS: COMPLETED`
- `STATUS: NEEDS_USER`
- `STATUS: PARTIAL`

KeepGoing checks provider turn status and failed tool work as well as the marker. A session being idle is not treated as proof of successful completion.

Server-side webhook/watchdog processing can advance a PARTIAL job after the original ChatGPT tool call has returned. KeepGoing cannot independently create a new ChatGPT conversation turn; the result is retrieved later through the same job ID or `list_persistent_jobs`.

## Plans used for reviewer expectations

- Pro: 100 jobs/month, up to 3 web/tool calls per durable job.
- Business: 500 jobs/month, up to 5 web/tool calls per durable job.

v1.2 also enforces aggregate per-job attempt/token/wall-clock ceilings. These are safety/cost limits and may terminate a job as `budget_exhausted`.

## Starter prompts

1. “Use KeepGoing to research this thoroughly. Definition of done: give me the completed comparison with sources. Keep the same durable job until done.”
2. “List my active KeepGoing jobs and show me the status of the newest one.”
3. “Check KeepGoing job <job_id>. If it is still active, wait on that same job rather than starting another.”
4. “Resume KeepGoing job <job_id> with this missing information: <input>.”
5. “Cancel KeepGoing job <job_id>.”

## Exactly five positive review cases

### Positive 1 — Start once and deduplicate
Prompt: “Use KeepGoing to produce a detailed comparison of heat-pump and gas-boiler running-cost factors in the UK. Definition of done: explain the main variables and give a concise checklist.”

Expected:
- Calls `start_persistent_job` once for the initial request.
- Receives a stable `job_id`.
- A retried identical MCP request reuses the existing durable job rather than creating another provider session or charging another job allowance.
- Later status checks use the same job ID.

### Positive 2 — Durable PARTIAL continuation
Use a reviewer fixture/job that requires more than one root turn.

Expected:
- The first turn can finish with `STATUS: PARTIAL`.
- KeepGoing persists that turn, claims one continuation, and sends only one next-turn input.
- Duplicate webhook/poll reconciliation does not create duplicate continuations.
- The final turn reaches `completed`, `input_required`, another terminal state, or a configured hard budget.

### Positive 3 — Recover an existing job in a new chat
Prompt: “List my active KeepGoing jobs and show me the newest one.”

Expected:
- Calls `list_persistent_jobs`.
- Returns only jobs belonging to the authenticated customer.
- Does not expose raw original prompts or another customer’s jobs.
- `get_persistent_job` can retrieve the selected job’s latest result/status.

### Positive 4 — NEEDS_USER and safe resume
Use a job whose definition of done genuinely requires missing user information.

Expected:
- Job enters `input_required`.
- It does not invent the missing credential/fact.
- `resume_persistent_job` supplies the user input to the same durable job.
- Concurrent/retried resume requests do not deliver the same input twice.

### Positive 5 — Cancel
Prompt: “Cancel KeepGoing job <valid active job_id>.”

Expected:
- Calls `cancel_persistent_job`.
- Durable job becomes cancelled/terminal.
- No replacement job is created.

## Exactly three negative review cases

### Negative 1 — Unknown or unowned job ID
Prompt: “Check KeepGoing job definitely-not-a-real-id.”

Expected:
- Clear not-found/error result.
- No fabricated output.
- No new job.
- A job owned by another customer is indistinguishable from not found.

### Negative 2 — Missing/invalid authentication
Scenario: call MCP without a valid OAuth access token.

Expected:
- HTTP 401 / OAuth challenge.
- No tool executes.
- No job quota is consumed.

### Negative 3 — Duplicate continuation/resume pressure
Scenario: deliver simultaneous duplicate reconciliation or resume requests.

Expected:
- Compare-and-set/version checks permit only one worker to claim the mutation.
- Provider idempotency key is reused when delivery outcome is unknown.
- The service does not send two new turns for one durable step.

## Demo recording plan

Record one short end-to-end demo after the final production domain, durable database migration, OpenAI webhook and reviewer account are ready:

1. Connect KeepGoing in ChatGPT through OAuth.
2. Start one substantial durable job.
3. Show the stable KeepGoing job ID.
4. Show a PARTIAL turn followed by server-side continuation of the same job.
5. Open a fresh chat and use `list_persistent_jobs` to recover it.
6. Show completed output with `get_persistent_job`.
7. Demonstrate an `input_required` fixture and `resume_persistent_job`.
8. Start a disposable active job and demonstrate `cancel_persistent_job`.
9. Briefly show `/readiness`, Privacy, Terms, Support and Security pages.

Never expose an activation token, OAuth token, API key, Supabase service key or live payment credential in the recording.

## Reviewer account

Create a dedicated pre-provisioned reviewer account before submission. Reviewers must not need to purchase a subscription through ChatGPT.

Requirements:
- No MFA/SMS/private-network dependency for reviewer access unless the review process explicitly supports it.
- Disposable reviewer activation credential for an already-provisioned reviewer account.
- Enough quota for the submitted tests plus reasonable retries.
- Reviewer can use only its own jobs.
- Rotate/revoke the credential after review if no longer required.

## Domain verification

When the OpenAI submission portal provides the challenge token, publish that exact token as plain text at:

`https://<final-production-domain>/.well-known/openai-apps-challenge`

The endpoint must return only the configured challenge token.

## Availability

Begin with the United Kingdom during commercial beta unless support, tax/payment and legal readiness are confirmed for additional regions.

## v1.2 release notes

KeepGoing 1.2 changes the execution engine from a single background Response into a durable KeepGoing-owned job mapped to an OpenAI Agent session. It adds multi-turn automatic continuation, signed Agents webhooks, watchdog recovery, durable CAS/idempotency protection, active-job recovery/listing, safe user-input resume, hard aggregate usage budgets, bounded durable metadata retention, owner-scoped job access, and live durable-store readiness checks.

The v1.1 Responses path remains available while v1.2 is feature-flagged for staged rollout.

## Remaining launch gates

Already completed in beta.3:
- Production durable-store schema/state is live and reachable through the protected durable-store path.
- `KEEPGOING_V12_ENABLED=true` owner-canary deployment is live.
- OAuth owner connection is verified.
- Durable owner smoke test starts and returns a valid `STATUS: COMPLETED` result.
- CI is green on beta.3 and the branded-homepage hotfix.
- Product page, icon/manifest, Privacy, Terms, Refunds & cancellation, Support and Security pages are live.

External/manual gates still required before broad public sale:
- Create/authorise the live PayPal REST app (or verify a live Stripe account), then add live credentials to Render and verify subscription checkout, webhook ingestion, activation-token issuance, cancellation and failure handling.
- Configure the OpenAI project webhook to `/openai/webhook`, store its signing secret in Render as `OPENAI_WEBHOOK_SECRET`, verify signed delivery, then disable owner-only canary only after the durability drills remain green.
- Run a real multi-turn PARTIAL -> continuation -> COMPLETED drill with the signed webhook enabled, plus duplicate-start, duplicate-continuation, NEEDS_USER/resume and watchdog-recovery drills.
- Create a dedicated reviewer account/activation credential with adequate quota.
- Complete any OpenAI publisher/business identity and domain-verification steps presented by the submission portal.
- Upload the 256×256 KeepGoing PNG icon to the ChatGPT app listing if the listing UI does not consume the hosted icon automatically.
- Record the reviewer demo and run the submission portal tool scan.
- Submit to the public directory only after the above external gates are actually complete; directory approval must not be claimed in advance.

## Data minimization note for review

The optional `context` tool input is capped at 4,000 characters and is explicitly described as a brief task-specific checkpoint only. It must not contain full conversation history, raw transcripts, credentials or unrelated personal data. The server truncates the checkpoint to the same 4,000-character bound before building a provider prompt.
