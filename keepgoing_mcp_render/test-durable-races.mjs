// Race, retry, recovery and state-legality tests for the durable engine.
import assert from "node:assert/strict";
import { MemoryJobStore } from "./durable_store.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { createV12Service } from "./v12_service.js";
import { createWatchdog } from "./watchdog.js";
import { createWebhookProcessor } from "./webhook_processor.js";
import { JOB_STATES, newJobRecord, parseCompletionMarker, assessRun, isLegalTransition } from "./durable_job.js";
import { latestSessionText } from "./agents_engine.js";

const OWNER = "owner-hash-aaaaaaaaaaaaaaaa";
const OTHER = "owner-hash-bbbbbbbbbbbbbbbb";
let idCounter = 0;
const jobId = () => "kgj_" + (++idCounter).toString(16).padStart(32, "0");

function fakeEngine(overrides = {}) {
  const engine = {
    sent: [],
    cancels: [],
    turnStatus: "completed",
    output: "half done\nSTATUS: PARTIAL",
    turnId: "turn_1",
    async createSession() { return { id: "sess_" + (++idCounter) }; },
    async getSession() { return { status: "idle", required_actions: [] }; },
    async listTurns() { return { data: [{ id: engine.turnId, status: engine.turnStatus, subagent_id: null, usage: { total_tokens: 10 } }] }; },
    async listTurnItems(_s, turnId) {
      return { data: [{ type: "message", role: "assistant", turn_id: turnId, content: [{ type: "output_text", text: engine.output }] }] };
    },
    async sendMessage(sessionId, text, key) { engine.sent.push({ sessionId, text, key }); },
    async cancelTurn(sessionId, key) { engine.cancels.push({ sessionId, key }); },
    ...overrides
  };
  return engine;
}

async function seed(store, fields = {}) {
  const job = {
    ...newJobRecord({ id: jobId(), ownerSubjectHash: OWNER, engine: "agents", now: 1_000, limits: { maxAttempts: 6, maxWallMs: 3_600_000 } }),
    status: JOB_STATES.WORKING,
    providerSessionId: "sess_seed",
    ...fields
  };
  const created = await store.createOrGet({ job, ownerSubjectHash: job.ownerSubjectHash });
  return created.job;
}

// ---------------------------------------------------------------- markers
assert.equal(parseCompletionMarker("End with one of:\nSTATUS: COMPLETED\nSTATUS: NEEDS_USER\n...\nWork.\nSTATUS: PARTIAL"), "PARTIAL",
  "the final marker wins over restated options");
assert.equal(parseCompletionMarker("STATUS: COMPLETED is what I will say later\nSTATUS: PARTIAL"), "PARTIAL");
assert.equal(parseCompletionMarker("nothing here"), null);
assert.equal(parseCompletionMarker("done\r\nSTATUS: COMPLETED\r\n"), "COMPLETED", "CRLF output is recognised (pre-1.5 behaviour preserved)");
assert.equal(parseCompletionMarker("a\r\nSTATUS: PARTIAL\r\nmore\r\nSTATUS: COMPLETED"), "COMPLETED");
assert.equal(parseCompletionMarker("STATUS: COMPLETED please"), null, "marker must be alone on its line");
assert.equal(parseCompletionMarker("done\nSTATUS: COMPLETED   "), "COMPLETED");

// User input (which lists the markers) is never treated as agent output.
const promptOnly = {
  data: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Do X.\nEnd with:\nSTATUS: COMPLETED\nSTATUS: PARTIAL" }] }]
};
assert.equal(latestSessionText(promptOnly), "");
const promptThenAnswer = {
  data: [
    promptOnly.data[0],
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Answer\nSTATUS: COMPLETED" }] }
  ]
};
assert.equal(latestSessionText(promptThenAnswer), "Answer\nSTATUS: COMPLETED");

// A completed turn with no assistant text must continue, not complete.
{
  const job = newJobRecord({ id: jobId(), ownerSubjectHash: OWNER, now: 0, limits: { maxAttempts: 6 } });
  job.status = JOB_STATES.WORKING;
  const assessed = assessRun(job, { providerStatus: "completed", output: latestSessionText(promptOnly), now: 1 });
  assert.equal(assessed.status, JOB_STATES.CONTINUING);
}

// ------------------------------------------------------ transition legality
{
  const base = { providerSessionId: "sess_x", attempt: 2 };
  assert.equal(isLegalTransition({ ...base, status: "cancelled" }, { status: "working" }), false);
  assert.equal(isLegalTransition({ ...base, status: "completed" }, { status: "continuing" }), false);
  assert.equal(isLegalTransition({ ...base, status: "budget_exhausted" }, { status: "working" }), false);
  assert.equal(isLegalTransition({ ...base, status: "failed" }, { status: "working" }), false);
  assert.equal(isLegalTransition({ providerSessionId: null, attempt: 0, status: "failed" }, { status: "queued" }), true);
  assert.equal(isLegalTransition({ ...base, status: "input_required" }, { status: "working" }), true);
  assert.equal(isLegalTransition({ ...base, status: "working" }, { status: "bogus" }), false);
}

// ------------------------------------- store: absorbing states and owner
{
  const store = new MemoryJobStore();
  const job = await seed(store, { status: JOB_STATES.CANCELLED });
  const revived = await store.compareAndSet(job.id, job.version, { ...job, status: JOB_STATES.WORKING });
  assert.equal(revived.ok, false);
  assert.equal(revived.reason, "illegal_transition");
  const working = await seed(store);
  const stolen = await store.compareAndSet(working.id, working.version, { ...working, ownerSubjectHash: OTHER });
  assert.equal(stolen.ok, true);
  assert.equal(stolen.job.ownerSubjectHash, OWNER, "owner is immutable");
}

// ------------------------------------------ cancel survives version races
{
  const store = new MemoryJobStore();
  const engine = fakeEngine();
  const orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => 5_000 });
  const job = await seed(store);
  const realCas = store.compareAndSet.bind(store);
  let interfered = 0;
  store.compareAndSet = async (id, version, next) => {
    if (next.status === JOB_STATES.CANCELLED && interfered < 2) {
      interfered += 1;
      const current = await store.get(id);
      await realCas(id, current.version, { ...current, updatedAt: current.updatedAt + 1 }); // concurrent watchdog write
    }
    return realCas(id, version, next);
  };
  const cancelled = await orchestrator.cancel(job.id);
  assert.equal(cancelled.status, JOB_STATES.CANCELLED, "cancel retries instead of silently losing");
  assert.equal(interfered, 2);
  assert.equal(engine.cancels.length, 1, "provider cancel sent once across retries");
  store.compareAndSet = realCas;
  assert.equal((await orchestrator.cancel(job.id)).status, JOB_STATES.CANCELLED, "cancel is idempotent");
}

// ---------------------------- cancel while a continuation is in flight
{
  const store = new MemoryJobStore();
  let orchestrator;
  const engine = fakeEngine({
    async sendMessage(sessionId, text, key) {
      engine.sent.push({ sessionId, text, key });
      await orchestrator.cancel(currentId); // user cancels mid-delivery
    }
  });
  orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => 10_000 });
  const job = await seed(store);
  const currentId = job.id;
  const result = await orchestrator.reconcile(job.id);
  assert.equal(result.action, "already_updated");
  const after = await store.get(job.id);
  assert.equal(after.status, JOB_STATES.CANCELLED, "cancel wins; job is not flipped back to working");
  assert.ok(engine.cancels.some((c) => c.key.startsWith("kg-cancel-orphan-")), "the orphaned continuation turn is stopped");

  // Further reconciles never resurrect it, even if the provider reports a completed turn.
  engine.output = "all done\nSTATUS: COMPLETED";
  engine.turnId = "turn_2";
  const again = await orchestrator.reconcile(job.id);
  assert.equal(again.action, "terminal");
  assert.equal((await store.get(job.id)).status, JOB_STATES.CANCELLED);
}

// ------------------------------------------- input_required can be cancelled
{
  const store = new MemoryJobStore();
  const engine = fakeEngine();
  const orchestrator = new KeepGoingOrchestrator({ engine, store });
  const job = await seed(store, { status: JOB_STATES.INPUT_REQUIRED });
  assert.equal((await orchestrator.cancel(job.id)).status, JOB_STATES.CANCELLED);
  const done = await seed(store, { status: JOB_STATES.COMPLETED });
  assert.equal((await orchestrator.cancel(done.id)).status, JOB_STATES.COMPLETED, "completed jobs stay completed");
}

// --------------------------------------------------------------- resume
{
  const store = new MemoryJobStore();
  const engine = fakeEngine();
  const orchestrator = new KeepGoingOrchestrator({ engine, store });
  let clock = 50_000;
  const service = createV12Service({ engine, store, orchestrator, now: () => ++clock, sleep: async () => {} });

  // A stale unresolved key from an EARLIER checkpoint no longer wedges the job.
  const stale = await seed(store, {
    status: JOB_STATES.INPUT_REQUIRED,
    lastAssessedTurnId: "turn_new",
    continuationIdempotencyKey: "kg-user-" + "x" + "-turn_old-abcdef"
  });
  await store.compareAndSet(stale.id, stale.version, {
    ...stale,
    continuationIdempotencyKey: "kg-user-" + stale.id + "-turn_old-abcdef",
    continuationLeaseUntil: null
  });
  const resumed = await service.resume(stale.id, "here is the answer", OWNER);
  assert.equal(resumed.status, JOB_STATES.WORKING);
  assert.equal(engine.sent.length, 1);

  // Same-checkpoint unresolved delivery still blocks a DIFFERENT input...
  const pending = await seed(store, { status: JOB_STATES.INPUT_REQUIRED, lastAssessedTurnId: "turn_9" });
  const failingEngine = fakeEngine({ async sendMessage() { throw Object.assign(new Error("socket hang up"), { code: "provider_unreachable" }); } });
  const failingService = createV12Service({ engine: failingEngine, store, orchestrator: new KeepGoingOrchestrator({ engine: failingEngine, store }), now: () => ++clock });
  await assert.rejects(() => failingService.resume(pending.id, "first answer", OWNER), /socket hang up/);
  await assert.rejects(() => service.resume(pending.id, "a different answer", OWNER), /Previous user input delivery is unresolved/);
  // ...but the exact same input can be retried safely with the same idempotency key.
  const retried = await service.resume(pending.id, "first answer", OWNER);
  assert.equal(retried.status, JOB_STATES.WORKING);
  const keys = engine.sent.map((s) => s.key);
  assert.equal(keys.at(-1).startsWith("kg-user-" + pending.id + "-turn_9-"), true);

  // Concurrent identical resumes send exactly one message.
  const racer = await seed(store, { status: JOB_STATES.INPUT_REQUIRED, lastAssessedTurnId: "turn_r" });
  const sentBefore = engine.sent.length;
  const results = await Promise.all([
    service.resume(racer.id, "same", OWNER),
    service.resume(racer.id, "same", OWNER)
  ]);
  assert.equal(engine.sent.length - sentBefore, 1, "only one delivery under a race");
  assert.ok(results.some((r) => r.status === JOB_STATES.WORKING));

  // Another owner cannot resume.
  const foreign = await seed(store, { status: JOB_STATES.INPUT_REQUIRED });
  await assert.rejects(() => service.resume(foreign.id, "x", OTHER), /KeepGoing job not found/);
  await assert.rejects(() => service.resume("not-a-job-id", "x", OWNER), /KeepGoing job not found/);
}

// -------------------------------------- start dedupe + active-job quota
{
  const store = new MemoryJobStore();
  const engine = fakeEngine({ turnStatus: "in_progress" });
  const orchestrator = new KeepGoingOrchestrator({ engine, store });
  const service = createV12Service({ engine, store, orchestrator });
  let quota = 0;
  const gate = async () => { quota += 1; };
  const first = await service.start({ goal: "g1", ownerSubjectHash: OWNER, clientRequestId: "window-1-key", beforeCreateSession: gate, maxActiveJobs: 1 });
  assert.equal(first.duplicate, false);
  // At the cap, a retry whose original key is only in the previous window still resolves to the same job.
  const retry = await service.start({
    goal: "g1", ownerSubjectHash: OWNER, clientRequestId: "window-2-key", fallbackRequestIds: ["window-1-key"],
    beforeCreateSession: gate, maxActiveJobs: 1
  });
  assert.equal(retry.job_id, first.job_id);
  assert.equal(retry.duplicate, true);
  assert.equal(quota, 1, "a duplicate never consumes quota");
  await assert.rejects(
    () => service.start({ goal: "g2", ownerSubjectHash: OWNER, clientRequestId: "other", beforeCreateSession: gate, maxActiveJobs: 1 }),
    (error) => error.code === "active_job_limit" && /Too many active KeepGoing jobs \(1\/1\)/.test(error.message)
  );
  // Another owner is unaffected by this owner's cap.
  const otherStart = await service.start({ goal: "g2", ownerSubjectHash: OTHER, clientRequestId: "other", beforeCreateSession: gate, maxActiveJobs: 1 });
  assert.equal(otherStart.duplicate, false);
  assert.notEqual(otherStart.job_id, first.job_id, "request ids are scoped per owner");
}

// ----------------------------------------------- watchdog: no overlap
{
  const store = new MemoryJobStore();
  let release;
  const gateway = new Promise((resolve) => { release = resolve; });
  const orchestrator = {
    async reconcile() { await gateway; return { action: "working" }; }
  };
  const job = await seed(store);
  await store.compareAndSet(job.id, job.version, { ...job, updatedAt: 0 });
  const watchdog = createWatchdog({ store, orchestrator, now: () => 1_000_000 });
  const firstRun = watchdog.runOnce();
  const second = await watchdog.runOnce();
  assert.equal(second.skipped, true, "overlapping pass is skipped");
  assert.equal(watchdog.status().running, true);
  release();
  const done = await firstRun;
  assert.equal(done.checked, 1);
  await watchdog.idle();
  assert.equal(watchdog.status().running, false);
}

// -------------------- watchdog: failing jobs are deferred, then dead-lettered
{
  const store = new MemoryJobStore();
  const engine = fakeEngine({ async getSession() { throw Object.assign(new Error("session gone"), { status: 404, code: "provider_rejected" }); } });
  let clock = 100_000;
  const orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => clock });
  const stuck = await seed(store, { wallDeadlineAt: 200_000 });
  await store.compareAndSet(stuck.id, stuck.version, { ...stuck, updatedAt: 0 });
  const healthy = await seed(store);
  await store.compareAndSet(healthy.id, healthy.version, { ...healthy, updatedAt: 10 });
  const watchdog = createWatchdog({ store, orchestrator, now: () => clock, limit: 1 });

  const pass1 = await watchdog.runOnce();
  assert.equal(pass1.results[0].job_id, stuck.id);
  assert.equal(pass1.results[0].action, "error");
  const deferred = await store.get(stuck.id);
  assert.equal(deferred.safeErrorCode, "recovery_retrying");
  assert.equal(deferred.updatedAt, clock, "failing job moves to the back of the queue");

  const pass2 = await watchdog.runOnce();
  assert.equal(pass2.results[0].job_id, healthy.id, "a failing job no longer starves healthy ones");

  clock = 200_000 + 15 * 60_000 + 1;
  await store.compareAndSet(stuck.id, (await store.get(stuck.id)).version, { ...(await store.get(stuck.id)), updatedAt: 0 });
  const pass3 = await watchdog.runOnce();
  assert.equal(pass3.results[0].action, "dead_lettered");
  const dead = await store.get(stuck.id);
  assert.equal(dead.status, JOB_STATES.FAILED);
  assert.equal(dead.safeErrorCode, "recovery_failed");
  assert.ok(engine.cancels.some((c) => c.key.startsWith("kg-deadletter-")));
}

// ------------------------------- persistence failure after send is safe
{
  const store = new MemoryJobStore();
  const engine = fakeEngine();
  let clock = 1_000;
  const orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => clock });
  const job = await seed(store);
  const realCas = store.compareAndSet.bind(store);
  let failNextWorking = true;
  store.compareAndSet = async (id, version, next) => {
    if (failNextWorking && next.status === JOB_STATES.WORKING) {
      failNextWorking = false;
      throw Object.assign(new Error("store timed out"), { code: "store_timeout" });
    }
    return realCas(id, version, next);
  };
  await assert.rejects(() => orchestrator.reconcile(job.id), /store timed out/);
  const claimed = await store.get(job.id);
  assert.equal(claimed.status, JOB_STATES.CONTINUING, "claim stays durable");
  const firstKey = engine.sent[0].key;
  clock += 120_000; // lease expired
  await orchestrator.reconcile(job.id);
  assert.equal(engine.sent.length, 2);
  assert.equal(engine.sent[1].key, firstKey, "retry reuses the same idempotency key, so the provider dedupes");
  assert.equal((await store.get(job.id)).status, JOB_STATES.WORKING);
}

// -------------------------------------------------- webhook replays
{
  const store = new MemoryJobStore();
  const recorded = new Set();
  store.recordEvent = async ({ providerEventId }) => {
    if (recorded.has(providerEventId)) return { inserted: false };
    recorded.add(providerEventId);
    return { inserted: true };
  };
  const job = await seed(store, { providerSessionId: "sess_hook" });
  let reconciles = 0;
  const processor = createWebhookProcessor({
    store,
    orchestrator: { async reconcile() { reconciles += 1; return { action: "working" }; } },
    verify: async (raw) => JSON.parse(raw)
  });
  const body = JSON.stringify({ id: "evt_1", type: "agent.session.idle", data: { id: "sess_hook" } });
  const first = await processor.ingest(body, new Headers({ "webhook-id": "wh_1" }));
  const replay = await processor.ingest(body, new Headers({ "webhook-id": "wh_1" }));
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  await processor.process(first);
  await processor.process(replay);
  assert.equal(reconciles, 1, "a replayed webhook never reconciles twice");
  assert.equal(first.jobId, job.id);
}

console.log("durable race and recovery tests passed");

// ------------------------------------------ retry policy by error class
{
  const { isDefinitiveRejection } = await import("./job_orchestrator.js");
  for (const status of [408, 409, 425, 429, 500, 503, 0]) assert.equal(isDefinitiveRejection({ status }), false, String(status));
  for (const status of [400, 401, 403, 404, 422]) assert.equal(isDefinitiveRejection({ status }), true, String(status));

  // A 429 at start is retried (not marked start_rejected) and the job still starts.
  const store = new MemoryJobStore();
  let attempts = 0;
  const engine = fakeEngine({
    async createSession() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
      return { id: "sess_after_429" };
    }
  });
  const orchestrator = new KeepGoingOrchestrator({ engine, store, sleep: async () => {} });
  const started = await orchestrator.start({ initialPrompt: "p", instructions: "i", ownerSubjectHash: OWNER, clientRequestId: "r429" });
  assert.equal(started.created, true);
  assert.equal(started.job.status, JOB_STATES.WORKING);
  assert.equal(attempts, 2);

  // A 429 on cancel is surfaced (retry later) instead of pretending nothing was running.
  const job = await seed(store);
  const limited = new KeepGoingOrchestrator({
    engine: fakeEngine({ async cancelTurn() { throw Object.assign(new Error("rate limited"), { status: 429 }); } }),
    store
  });
  await assert.rejects(() => limited.cancel(job.id), /rate limited/);
  assert.equal((await store.get(job.id)).status, JOB_STATES.WORKING, "job is not marked cancelled while its turn may still run");
  console.log("retry-policy tests passed");
}
