# KeepGoing v1.2 durable continuation design

## Why this upgrade

KeepGoing v1.1 correctly avoids duplicate background starts by preserving a single OpenAI response ID and polling it. The weakness is that a single response can finish incomplete or PARTIAL, and the service itself does not yet own a durable multi-attempt job lifecycle.

v1.2 separates the KeepGoing job from any one model response.

## Research-backed design

### MCP Tasks patterns to adopt
The official MCP Tasks extension uses a stable task ID, durable states, tasks/get polling, explicit input_required state, cancellation, and a recommended polling interval. KeepGoing should mirror those semantics internally even while exposing ordinary MCP tools for broad ChatGPT compatibility.

References:
- https://github.com/modelcontextprotocol/ext-tasks
- https://tasks.extensions.modelcontextprotocol.io/

### Durable execution patterns
Long-running workflow systems converge on:
- checkpoint completed work;
- retry only the failed/unfinished step;
- use idempotency keys;
- persist state before acknowledging work;
- hard concurrency/rate/budget limits;
- durable waits for user/external input;
- replay/reconcile after crashes.

References:
- https://github.com/inngest/inngest
- https://github.com/temporalio/sdk-typescript
- https://github.com/AndresSaa/mcp-durable-tasks

### Recommended OpenAI engine direction
Use a stable KeepGoing-owned job ID and map it to a durable OpenAI session/conversation when available. Each continuation becomes another turn/response under that job. Polling remains a client convenience; a server-side worker/webhook path should own progress.

Fallback: keep the existing Responses API background engine during migration.

## Job state machine

States:
- queued
- working
- continuing
- input_required
- completed
- failed
- cancelled
- budget_exhausted

Every model attempt must end with:
- STATUS: COMPLETED
- STATUS: NEEDS_USER
- STATUS: PARTIAL

The server validates the marker against provider status and budgets. It does not trust text alone.

## Hard safety/cost stops

Each job has:
- maximum continuation attempts;
- total token budget;
- total tool-call budget;
- wall-clock deadline;
- repeated-output loop detector.

A job stops rather than continuing forever when any hard limit is reached.

## Duplicate prevention

Add a client_request_id/idempotency key to start_persistent_job. Repeated starts with the same customer + client_request_id return the existing job instead of consuming another job quota.

## Recovery/watchdog

A watchdog should periodically reconcile non-terminal jobs:
1. read persisted job state;
2. fetch current provider state;
3. update progress;
4. if PARTIAL/incomplete and under budget, enqueue exactly one continuation;
5. if NEEDS_USER, stop in input_required;
6. if stale but provider still working, leave it alone;
7. if webhook/poll was missed, repair state idempotently.

## Observability

Record only safe metadata:
- job ID;
- hashed customer subject;
- provider run/session IDs;
- state transitions;
- attempt number;
- token/tool usage;
- timestamps;
- safe error code.

Do not log activation tokens, OAuth tokens, passwords or raw private credentials.

## Implementation sequence

### Phase A — prototype (this branch)
- durable_job.js state machine;
- completion marker parser;
- loop detection;
- hard budgets;
- unit tests.

### Phase B — server integration
- persist job records in the billing/backend store;
- add client_request_id;
- return completion_state and continuation_needed from get/wait;
- continuation worker creates the next provider run automatically;
- expose progress/attempt/budget summary.

### Phase C — durability
- signed OpenAI webhook receiver;
- webhook deduplication;
- watchdog/reconciliation endpoint or scheduled worker;
- retry/backoff for transient provider failures;
- crash/restart tests.

### Phase D — protocol upgrade
- optionally support MCP Tasks when client capability negotiation confirms support;
- retain current ordinary tools for compatibility.

## Definition of done for v1.2

A user can start one KeepGoing job, close or stop interacting with the chat, and the server can safely advance that job through multiple model attempts until:
- completed;
- user input is genuinely required;
- cancelled;
- failed;
- or a hard configured budget is reached.

It must never create duplicate continuations for the same attempt and must never continue indefinitely.
