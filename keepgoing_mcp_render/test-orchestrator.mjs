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

// Lost acknowledgement during initial session creation is recovered inline by metadata.
{
  const store = new MemoryJobStore();
  let quotaReservations = 0;
  let creates = 0;
  const startKeys = [];
  const engine = {
    async createSession(options = {}) {
      creates++;
      startKeys.push(options.idempotencyKey);
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

  const started = await kg.start({
    initialPrompt: "recover me",
    instructions: "finish",
    ownerSubjectHash: "owner-recovery",
    clientRequestId: "req-recovery",
    beforeCreateSession: async () => { quotaReservations++; }
  });

  assert.equal(started.created, true);
  assert.equal(started.job.status, JOB_STATES.WORKING);
  assert.equal(started.job.providerSessionId, "sess_recovered_start");
  assert.equal(quotaReservations, 1);
  assert.equal(creates, 1);
  assert.match(startKeys[0], /^kg-start-kgj_/);
}

// A transient provider failure retries the same idempotent session start.
{
  const store = new MemoryJobStore();
  let creates = 0;
  const startKeys = [];
  const engine = {
    async createSession(options = {}) {
      creates++;
      startKeys.push(options.idempotencyKey);
      if (creates === 1) {
        const error = new Error("temporary provider outage");
        error.status = 503;
        throw error;
      }
      return { id: "sess_retry_ok", status: "in_progress" };
    },
    async findSessionByMetadata() { return null; },
    async cancelTurn() {}
  };
  let clock = 40_000;
  const kg = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => ++clock,
    sleep: async () => {}
  });

  const started = await kg.start({
    initialPrompt: "retry safely",
    instructions: "finish",
    ownerSubjectHash: "owner-retry",
    clientRequestId: "req-retry"
  });

  assert.equal(started.job.status, JOB_STATES.WORKING);
  assert.equal(started.job.providerSessionId, "sess_retry_ok");
  assert.equal(creates, 2);
  assert.equal(startKeys[0], startKeys[1]);
  assert.match(startKeys[0], /^kg-start-kgj_/);
}

// A failed pre-turn reservation can be revived by the same client request
// without consuming quota twice or changing the durable job id.
{
  const store = new MemoryJobStore();
  let creates = 0;
  let available = false;
  let quotaReservations = 0;
  const startKeys = [];
  const engine = {
    async createSession(options = {}) {
      creates++;
      startKeys.push(options.idempotencyKey);
      if (!available) {
        const error = new Error("provider unavailable");
        error.status = 503;
        throw error;
      }
      return { id: "sess_revived", status: "in_progress" };
    },
    async findSessionByMetadata() { return null; },
    async cancelTurn() {}
  };

  let clock = 100_000;
  const kg = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => clock,
    sleep: async () => {}
  });
  const request = {
    initialPrompt: "revive me",
    instructions: "finish",
    ownerSubjectHash: "owner-revive",
    clientRequestId: "req-revive",
    beforeCreateSession: async () => { quotaReservations++; }
  };

  await assert.rejects(() => kg.start(request), /provider unavailable/);
  const pending = await store.findByRequest("owner-revive", "req-revive");
  assert.equal(pending.status, JOB_STATES.QUEUED);
  const durableJobId = pending.id;
  assert.equal(quotaReservations, 1);
  assert.equal(creates, 3);
  assert.equal(new Set(startKeys).size, 1);

  clock += 61_000;
  const failed = await kg.recoverStart(durableJobId);
  assert.equal(failed.job.status, JOB_STATES.FAILED);
  assert.equal(failed.job.safeErrorCode, "start_not_recovered");

  available = true;
  const revived = await kg.start(request);
  assert.equal(revived.created, false);
  assert.equal(revived.job.id, durableJobId);
  assert.equal(revived.job.status, JOB_STATES.WORKING);
  assert.equal(revived.job.providerSessionId, "sess_revived");
  assert.equal(quotaReservations, 1);
  assert.equal(new Set(startKeys).size, 1);
}



// Coding workspace survives transient provider start retries.
{
  const store = new MemoryJobStore();
  const workspaces = [];
  let creates = 0;
  const engine = {
    async createSession(options = {}) {
      creates++;
      workspaces.push(options.workspace);
      if (creates === 1) {
        const error = new Error("temporary provider failure");
        error.status = 503;
        throw error;
      }
      return { id: "sess_workspace_retry", status: "in_progress" };
    },
    async findSessionByMetadata() { return null; },
    async cancelTurn() {}
  };
  let clock = 200_000;
  const kg = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => ++clock,
    sleep: async () => {}
  });
  const workspace = {
    enabled: true,
    repositoryUrl: "https://github.com/chipblock2/project-relay",
    repositoryRef: "main"
  };
  const started = await kg.start({
    initialPrompt: "fix it",
    instructions: "use workspace",
    ownerSubjectHash: "owner-workspace",
    clientRequestId: "req-workspace",
    workspace
  });
  assert.equal(started.job.status, JOB_STATES.WORKING);
  assert.equal(creates, 2);
  assert.deepEqual(workspaces, [workspace, workspace]);
}

console.log("orchestrator tests passed");
