import assert from "node:assert/strict";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES } from "./durable_job.js";

function engineWith({ failFirstSend = false } = {}) {
  let sends = 0;
  let creates = 0;
  let turn = 1;
  let failedOnce = false;
  const seenProviderIds = [];
  const idempotencyKeys = [];

  return {
    get sends() { return sends; },
    get creates() { return creates; },
    get seenProviderIds() { return seenProviderIds; },
    get idempotencyKeys() { return idempotencyKeys; },
    advance() { turn += 1; },

    async createSession() {
      creates++;
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

async function startJob(kg) {
  const request = {
    initialPrompt: "do it",
    instructions: "finish it",
    ownerSubjectHash: "owner",
    clientRequestId: "req-1",
    limits: { maxAttempts: 4 }
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
  const jobId = await startJob(kg);

  assert.equal(engine.creates, 1);

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

  const repeated = await kg.reconcile(jobId);
  assert.equal(repeated.action, "already_assessed");
  assert.equal(engine.sends, 1);

  engine.advance();
  const done = await kg.reconcile(jobId);
  assert.equal(done.job.status, JOB_STATES.COMPLETED);
  assert.equal(done.job.attempt, 2);

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

console.log("orchestrator tests passed");
