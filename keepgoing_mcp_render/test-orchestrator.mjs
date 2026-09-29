import assert from "node:assert/strict";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";

function engineWith({ failFirstSend = false } = {}) {
  let sends = 0;
  let creates = 0;
  let turn = 1;
  let failedOnce = false;
  const seenProviderIds = [];
  const idempotencyKeys = [];
  const startIdempotencyKeys = [];
  const scopedTurns = [];

  return {
    get sends() { return sends; },
    get creates() { return creates; },
    get seenProviderIds() { return seenProviderIds; },
    get idempotencyKeys() { return idempotencyKeys; },
    get startIdempotencyKeys() { return startIdempotencyKeys; },
    get scopedTurns() { return scopedTurns; },
    advance() { turn += 1; },

    async createSession(options = {}) {
      creates++;
      startIdempotencyKeys.push(options.idempotencyKey || null);
      await Promise.resolve();
      return { id: "sess_test", status: "in_progress" };
    },
    async getSession(id) {
      seenProviderIds.push(id);
      return { id, status: "idle", required_actions: [] };
    },
    async listItems(id) {
      seenProviderIds.push(id);
      const text = turn === 1
        ? "half\nSTATUS: PARTIAL"
        : "done\nSTATUS: COMPLETED";
      return { data: [{ type: "message", content: [{ type: "output_text", text }] }] };
    },
    async listTurnItems(id, turnId) {
      seenProviderIds.push(id);
      scopedTurns.push(turnId);
      const text = turn === 1
        ? "half\nSTATUS: PARTIAL"
        : "done\nSTATUS: COMPLETED";
      return {
        data: [{
          id: "message_" + turn,
          type: "message",
          turn_id: turnId,
          status: "completed",
          content: [{ type: "output_text", text }]
        }],
        found: true,
        truncated: false
      };
    },
    async listTurns(id) {
      seenProviderIds.push(id);
      return {
        data: [{
          id: "turn_" + turn,
          status: "completed",
          subagent_id: null,
          usage: { total_tokens: 25 }
        }]
      };
    },
    async sendMessage(id, _text, idempotencyKey) {
      seenProviderIds.push(id);
      sends++;
      idempotencyKeys.push(idempotencyKey);
      if (failFirstSend && !failedOnce) {
        failedOnce = true;
        throw new Error("connection dropped after provider acceptance");
      }
      return { ok: true };
    },
    async cancelTurn(id) {
      seenProviderIds.push(id);
      return { ok: true };
    }
  };
}

async function startJob(kg, beforeCreateSession = null) {
  const request = {
    initialPrompt: "do it",
    instructions: "finish it",
    ownerSubjectHash: "owner",
    clientRequestId: "req-1",
    limits: { maxAttempts: 4 },
    beforeCreateSession
  };
  const [startA, startB] = await Promise.all([kg.start(request), kg.start(request)]);
  const first = startA.created ? startA : startB;
  const duplicate = startA.created ? startB : startA;

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.match(first.job.id, /^kgj_[a-f0-9]{32}$/);
  assert.equal(first.job.providerSessionId, "sess_test");
  assert.equal(first.job.status, JOB_STATES.WORKING);
  assert.equal(first.job.id, duplicate.job.id);
  return first.job.id;
}

// Normal concurrent reconciliation: only one continuation may be sent.
{
  const store = new MemoryJobStore();
  const engine = engineWith();
  let clock = 10_000;
  const kg = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });
  let quotaReservations = 0;
  const jobId = await startJob(kg, async () => { quotaReservations++; });

  assert.equal(engine.creates, 1);
  assert.equal(engine.startIdempotencyKeys.length, 1);
  assert.match(engine.startIdempotencyKeys[0], /^kg-start-kgj_/);
  assert.equal(quotaReservations, 1);

  const [a, b] = await Promise.all([kg.reconcile(jobId), kg.reconcile(jobId)]);
  assert.equal(engine.sends, 1);
  assert.ok([
    "continued",
    "already_claimed",
    "already_updated",
    "continuation_pending",
    "already_assessed"
  ].includes(a.action));
  assert.ok([
    "continued",
    "already_claimed",
    "already_updated",
    "continuation_pending",
    "already_assessed"
  ].includes(b.action));
  assert.equal(engine.idempotencyKeys.length, 1);
  assert.match(engine.idempotencyKeys[0], /^kg-cont-/);
  assert.ok(engine.scopedTurns.every((turnId) => turnId === "turn_1"));

  const repeated = await kg.reconcile(jobId);
  assert.equal(repeated.action, "already_assessed");
  assert.equal(engine.sends, 1);

  engine.advance();
  const done = await kg.reconcile(jobId);
  assert.equal(done.job.status, JOB_STATES.COMPLETED);
  assert.equal(done.job.attempt, 2);
  assert.ok(engine.scopedTurns.includes("turn_2"));

  const terminal = await kg.reconcile(jobId);
  assert.equal(terminal.action, "terminal");
  assert.ok(engine.seenProviderIds.every((id) => id === "sess_test"));
}

// Unknown delivery outcome: retry the same continuation key, never a new one.
{
  const store = new MemoryJobStore();
  const engine = engineWith({ failFirstSend: true });
  let clock = 20_000;
  const kg = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });
  const jobId = await startJob(kg);

  await assert.rejects(
    () => kg.reconcile(jobId),
    /connection dropped/
  );
  const afterUnknown = await kg.get(jobId);
  assert.equal(afterUnknown.status, JOB_STATES.CONTINUING);
  assert.equal(afterUnknown.lastAssessedTurnId, "turn_1");
  assert.equal(engine.sends, 1);

  const retried = await kg.reconcile(jobId);
  assert.equal(retried.action, "continued");
  assert.equal(engine.sends, 2);
  assert.equal(engine.idempotencyKeys[0], engine.idempotencyKeys[1]);

  engine.advance();
  const done = await kg.reconcile(jobId);
  assert.equal(done.job.status, JOB_STATES.COMPLETED);
}

// Active-turn budget enforcement cancels runaway provider work.
{
  const store = new MemoryJobStore();
  let cancelled = 0;
  const engine = {
    async getSession() { return { status: "in_progress", required_actions: [] }; },
    async listItems() { return { data: [] }; },
    async listTurns() {
      return { data: [{ id: "turn_hot", status: "in_progress", subagent_id: null, usage: { total_tokens: 1200 } }] };
    },
    async cancelTurn() { cancelled++; }
  };
  const job = newJobRecord({
    id: "kgj_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ownerSubjectHash: "ownerhash",
    now: 1_000,
    limits: { maxTotalTokens: 1000, maxWallMs: 600_000, maxAttempts: 4 }
  });
  job.status = JOB_STATES.WORKING;
  job.providerSessionId = "sess_hot";
  await store.createOrGet({ job, ownerSubjectHash: "ownerhash" });

  const kg = new KeepGoingOrchestrator({ engine, store, now: () => 2_000 });
  const result = await kg.reconcile(job.id);
  assert.equal(result.job.status, JOB_STATES.BUDGET_EXHAUSTED);
  assert.equal(cancelled, 1);
}

// Lost acknowledgement during initial session creation is recovered by metadata.
{
  const store = new MemoryJobStore();
  let quotaReservations = 0;
  let creates = 0;
  const engine = {
    async createSession() {
      creates++;
      throw new Error("connection dropped after session creation");
    },
    async findSessionByMetadata(key, value) {
      assert.equal(key, "keepgoing_job_id");
      assert.match(value, /^kgj_/);
      return { id: "sess_recovered_start", metadata: { [key]: value } };
    },
    async cancelTurn() {}
  };
  let clock = 30_000;
  const kg = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });

  await assert.rejects(
    () => kg.start({
      initialPrompt: "recover me",
      instructions: "finish",
      ownerSubjectHash: "owner-recovery",
      clientRequestId: "req-recovery",
      beforeCreateSession: async () => { quotaReservations++; }
    }),
    /connection dropped/
  );

  const pending = await store.listOwnerJobs("owner-recovery", { activeOnly: true });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, JOB_STATES.QUEUED);
  assert.equal(pending[0].providerSessionId, null);
  assert.equal(quotaReservations, 1);
  assert.equal(creates, 1);

  const recovered = await kg.recoverStart(pending[0].id);
  assert.equal(recovered.action, "start_recovered");
  assert.equal(recovered.job.status, JOB_STATES.WORKING);
  assert.equal(recovered.job.providerSessionId, "sess_recovered_start");
  assert.equal(quotaReservations, 1);
  assert.equal(creates, 1);
}

console.log("orchestrator tests passed");
