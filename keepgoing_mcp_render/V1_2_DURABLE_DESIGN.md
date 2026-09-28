# KeepGoing v1.2 durable continuation design

## Status

Implementation status: **feature-flagged beta candidate on `keepgoing-v1.2-durable-agent`**.

The production v1.1 path remains available. v1.2 must not be enabled for paid traffic until the durable SQL migration, OpenAI webhook, live readiness probe and end-to-end production drills are complete.

## Why v1.2 exists

KeepGoing v1.1 preserves one OpenAI background Response ID and polls it. That removes many manual “continue” prompts, but one Response is still one finite model run.

v1.2 introduces a KeepGoing-owned durable job that can span multiple OpenAI Agent turns. The stable KeepGoing job ID survives client/chat disconnects and is independent of the provider session ID.

## Architecture

### Stable KeepGoing job

A durable job is created with an internal `kgj_...` ID before provider work begins.

The database stores only safe orchestration metadata:
- hashed owner/customer identifier;
- hashed client request identifier;
- provider session ID;
- state/version;
- attempt and budget counters;
- leases and idempotency keys;
- safe error codes/messages;
- timestamps and completion marker hashes/state.

It deliberately does not store raw prompts, model output, OAuth tokens, activation tokens or passwords.

### Provider engine

The v1.2 provider engine uses an OpenAI Agents API session:
- one durable KeepGoing job maps to one provider session;
- each continuation is another input/turn in that session;
- live web search can be enabled for the agent;
- provider turn status, tool outcomes and saved items are inspected before declaring completion;
- latest-turn items are paged newest-first by `turn_id`, so long session history does not hide the current result or tool usage.

### Job state machine

States:
- `queued`
- `working`
- `continuing`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `budget_exhausted`

Every root turn is instructed to end with exactly one marker:
- `STATUS: COMPLETED`
- `STATUS: NEEDS_USER`
- `STATUS: PARTIAL`

The marker is not trusted by itself. KeepGoing also checks:
- root turn status;
- failed/incomplete tool work;
- token/tool budgets;
- wall-clock deadline;
- attempt count;
- duplicate/repeated output.

## Concurrency and idempotency

### Start
1. Atomically reserve owner + hashed client request in Supabase.
2. Only the winning caller consumes one job quota allowance.
3. Only the winning caller creates the provider session.
4. Persist provider session ID using compare-and-set.
5. If the provider acknowledgement is lost, watchdog recovery searches provider session metadata by KeepGoing job ID rather than blindly starting a second session.

### Automatic continuation
1. Assess a terminal root turn exactly once using `lastAssessedTurnId`.
2. If PARTIAL/incomplete and within budgets, CAS-claim a continuation lease.
3. Generate deterministic provider idempotency key.
4. Send continuation.
5. If acknowledgement is lost, preserve the same key and retry that same continuation later.

### User-input resume
1. Job must be `input_required`.
2. Hash the supplied input into a deterministic resume idempotency key.
3. CAS-claim delivery before sending provider input.
4. Concurrent duplicate resumes do not both reach the provider.
5. If outcome is unknown, only the exact same input can be retried with the same key.

## Recovery

### Signed OpenAI webhook
The webhook endpoint:
- receives raw request body before JSON middleware;
- verifies the OpenAI signature;
- deduplicates provider event IDs;
- maps provider session to durable job;
- stores safe event metadata only;
- reconciles relevant session lifecycle events.

### Watchdog
The watchdog scans stale non-terminal jobs and:
- attaches a provider session after a lost start acknowledgement when it can be recovered safely;
- reconciles working/continuing jobs;
- never blindly creates a second provider session for an ambiguous start;
- repairs progress after missed webhook/client polling;
- runs bounded durable metadata retention on a slower cadence.

## Job recovery across chats

`list_persistent_jobs` returns only the authenticated customer's own safe job metadata.

A later/new ChatGPT conversation can:
1. list active jobs;
2. select the existing stable job ID;
3. get/wait for the current result;
4. resume it if it is `input_required`;
5. cancel it if needed.

Raw original prompts are not returned by the job list.

## Safety and cost boundaries

Commercial default model: GPT-6 Luna unless explicitly overridden.

Current per-job ceilings:

### Pro
- 6 attempts/turns maximum;
- 20,000 aggregate model tokens;
- up to 3 web/tool calls when web is enabled;
- 2-hour wall-clock window.

### Business / owner
- 8 attempts/turns maximum;
- 30,000 aggregate model tokens;
- up to 5 web/tool calls when web is enabled;
- 4-hour wall-clock window.

These are hard ceilings, not target usage. Jobs stop earlier on completion or genuine user-input need.

## Durable schema security

`sql/durable_jobs.sql` implements:
- RLS on durable job/event tables;
- no anon/authenticated access;
- explicit service-role-only grants;
- atomic reservation RPC using `SECURITY INVOKER`;
- bounded retention cleanup RPC using `SECURITY INVOKER`;
- unique provider event IDs;
- unique owner + client-request hash;
- provider session uniqueness;
- optimistic versioning.

CI contains source guards for the RLS/grant/function boundaries.

## Production readiness

When v1.2 is enabled, `/readiness` requires:
- OpenAI API key;
- billing/auth backend configuration;
- durable Supabase configuration;
- successful live read-only access to both durable tables;
- OpenAI webhook secret.

Paid `sell_ready` also requires:
- checkout provider ready;
- OAuth configuration ready.

## Completed implementation phases

### Phase A — state machine and tests
Completed:
- durable job record/state machine;
- marker parser;
- loop detection;
- hard attempt/token/tool/wall budgets;
- unit tests.

### Phase B — server integration
Completed:
- stable KeepGoing-owned job IDs;
- durable Supabase store;
- atomic start reservation;
- client-request deduplication;
- quota reservation after durable claim;
- v1.2 MCP compatibility layer;
- job list/get/wait/cancel/resume;
- owner isolation;
- v1.1 fallback behind feature flag.

### Phase C — durability/recovery
Completed in code:
- signed OpenAI webhook verification;
- webhook deduplication;
- watchdog reconciliation;
- lost-start recovery by provider metadata;
- provider idempotency keys;
- duplicate continuation prevention;
- race-safe user-input resume;
- long-session latest-turn paging;
- bounded metadata retention;
- live durable-store readiness probe;
- CI coverage for the above.

### Phase D — protocol evolution
Future/optional:
- native MCP Tasks extension support when client capability negotiation and plugin-review compatibility justify it.
- Keep the current ordinary MCP tools as a compatibility surface.

## Remaining live deployment gates

Code completion is not the same as live readiness. Before enabling v1.2 for customers:

1. Apply `sql/durable_jobs.sql` through the normal production Supabase migration workflow.
2. Configure v1.2 Supabase service credentials only in secret storage.
3. Create/configure the OpenAI Agents webhook and save `OPENAI_WEBHOOK_SECRET`.
4. Enable `KEEPGOING_V12_ENABLED=true` in a staging/deployment slot first.
5. Confirm live `/readiness` including `durable_store_ready`.
6. Run real PARTIAL -> continuation -> COMPLETED.
7. Test duplicate start/continuation/resume under concurrency.
8. Test lost provider acknowledgement recovery.
9. Test missed webhook recovery through watchdog.
10. Test NEEDS_USER -> resume.
11. Test retention against disposable terminal jobs.
12. Complete live subscription/claim/cancellation testing.
13. Complete branded domain, publisher identity, reviewer credentials and OpenAI domain verification.
14. Disable canary-only mode only after all owner/live durability drills pass.
15. Record reviewer demo and run the portal tool scan.

## Definition of done for v1.2

A user can start one KeepGoing job, stop interacting with the chat, and the server can safely advance the job through multiple model turns until it becomes:
- completed;
- input_required;
- cancelled;
- failed; or
- budget_exhausted.

The system must not create duplicate starts, duplicate continuation turns, or duplicate user-input deliveries for one durable step, and it must not continue indefinitely.
