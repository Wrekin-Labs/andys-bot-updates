# KeepGoing v1.2 beta rollout

This document describes the safe rollout of the durable KeepGoing engine. The current v1.1 Responses engine remains the default until the feature flag is deliberately enabled.

## What v1.2 changes

v1.2 separates a KeepGoing job from any single model response or ChatGPT turn.

It adds:
- durable job records;
- OpenAI Agents sessions for multi-turn continuation;
- server-side watchdog recovery;
- verified/deduplicated OpenAI webhooks;
- exactly-once continuation retries with OpenAI Idempotency-Key;
- completion, NEEDS_USER, failed, cancelled and budget-exhausted states;
- tool-call, token, attempt and wall-clock budgets;
- duplicate-start protection;
- owner isolation for job reads/cancellation;
- resume of the same job after user input is required.

## Required environment

Keep these values in Render secrets/environment settings only.

Existing:
- OPENAI_API_KEY
- OPENAI_MODEL
- KEEPGOING_AUTH_URL
- KEEPGOING_CLAIM_URL
- KEEPGOING_BILLING_INGEST_URL
- KEEPGOING_BILLING_INGEST_TOKEN
- KEEPGOING_OAUTH_SECRET
- KEEPGOING_OAUTH_CODE_URL

New for durable v1.2:
- KEEPGOING_SUPABASE_URL
- KEEPGOING_SUPABASE_SERVICE_KEY
- OPENAI_WEBHOOK_SECRET
- KEEPGOING_V12_WATCHDOG_INTERVAL_MS (optional; default 15000)
- KEEPGOING_V12_ENABLED

Do not put a service-role key, activation token, OAuth token or webhook secret in GitHub.

## Database rollout

The proposed schema is in:

    keepgoing_mcp_render/sql/durable_jobs.sql

Before applying it:
1. Review it in the target Supabase project.
2. Run Supabase security/database advisors.
3. Confirm the durable tables are not exposed to anon/authenticated users.
4. Apply through the normal reviewed migration workflow.
5. Test atomic reservation and optimistic version updates.

The durable tables store orchestration metadata only. They deliberately do not store raw prompts, model output, passwords, OAuth tokens or activation tokens.

## OpenAI webhook

Configure the OpenAI webhook destination as:

    https://<production-domain>/openai/webhook

The receiver:
- reads the unmodified raw request body;
- verifies it with the official OpenAI Node SDK;
- deduplicates on webhook-id;
- stores only safe event metadata;
- returns quickly;
- relies on the watchdog to repair missed processing.

## Staged deployment

### Stage 1 — code deployed, v1.2 off

Set:

    KEEPGOING_V12_ENABLED=false

Deploy the code and verify:
- /health reports the service online;
- /readiness still reports the existing engine;
- v1.1 start/get/wait/cancel still pass;
- no durable jobs are created.

### Stage 2 — durable infrastructure configured

Keep v1.2 disabled.

Add the Supabase and OpenAI webhook secrets, configure the webhook, then verify:
- invalid webhook signatures return 400;
- valid webhooks return 202;
- duplicate webhook-id values are ignored;
- no secret values appear in logs.

### Stage 3 — private canary

Use a staging/preview Render service from the v1.2 branch before changing the production flag.

Run the full test matrix below.

### Stage 4 — production enable

Only after the canary is green:

    KEEPGOING_V12_ENABLED=true

Verify /health and /readiness immediately.

## Required canary test matrix

1. Normal completion in one turn.
2. PARTIAL result automatically starts exactly one continuation.
3. Multiple simultaneous reconciliation calls still send one continuation.
4. Simulated lost acknowledgement retries the same Idempotency-Key.
5. Duplicate start with the same MCP request/client request ID returns the existing job.
6. Duplicate start does not consume a second job allowance.
7. Duplicate webhook is ignored.
8. Missed webhook is repaired by the watchdog.
9. Root turn failure becomes failed.
10. Completed turn with failed tool work does not count as completed.
11. NEEDS_USER stops continuation.
12. resume_persistent_job continues the same job after user input.
13. Cross-customer get/wait/cancel attempts return not found.
14. Cancellation is idempotent.
15. Token budget stops a running turn.
16. Tool-call budget stops a running turn.
17. Wall-clock budget stops a running turn.
18. Repeated identical PARTIAL output triggers loop protection.
19. More than 100 session items are paginated correctly.
20. Restart the web process while a job is active and verify recovery.

## Rollback

To stop creating/advancing v1.2 jobs:

    KEEPGOING_V12_ENABLED=false

The v1.1 code path remains present. Prefer draining or cancelling active v1.2 jobs before disabling the flag because durable kgj_ jobs require the v1.2 runtime to be read or advanced.

Do not drop the durable tables during rollback. Retain them until any active jobs and support investigations are resolved.

## Public-release gates

Before merging/enabling broadly:
- CI fully green.
- Database migration reviewed and applied.
- OpenAI webhook configured and signature test passed.
- Full canary matrix passed.
- Terms/privacy updated for durable job metadata and Agents sessions.
- Reviewer instructions updated for the fifth resume tool.
- Demo recording updated.
- Production domain verification complete.
- Payment/entitlement end-to-end test passed.
