import assert from "node:assert/strict";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";

function makeJob({ id, now = 1_000, tokens = 100, stalls = 0 } = {}) {
  const job = newJobRecord({
    id,
    ownerSubjectHash: "owner-stall-test",
    now,
    limits: {
      maxAttempts: 6,
      maxWallMs: 60 * 60 * 1000,
      maxTotalTokens: 20_000,
      maxToolCalls: 10
    }
  });
  job.status = JOB_STATES.WORKING;
  job.providerSessionId = "sess_stall";
  job.currentRunId = "turn_stall";
  job.currentTurnTokens = tokens;
  job.currentTurnToolCalls = 0;
  job.lastProgressAt = now;
  job.updatedAt = now;
  job.stallRecoveryCount = stalls;
  return job;
}

function engineFor({ tokens = 100, turnStatus = "in_progress", cancelError = null } = {}) {
  const calls = { cancelled: [], sent: [] };
  const engine = {
    async getSession() { return { id: "sess_stall", status: "in_progress", required_actions: [] }; },
    async listTurns() {
      return { data: [{ id: "turn_stall", status: turnStatus, subagent_id: null, usage: { total_tokens: tokens } }] };
    },
    async listTurnItems() { return { data: [] }; },
    async listItems() { return { data: [] }; },
    async cancelTurn(sessionId, key) {
      calls.cancelled.push({ sessionId, key });
      if (cancelError) throw cancelError;
      return { ok: true };
    },
    async sendMessage(sessionId, text, key) {
      calls.sent.push({ sessionId, text, key });
      return { ok: true };
    }
  };
  return { engine, calls };
}

// A provider turn that reports "working" but has made no token/tool/turn progress
// for the whole stall window is restarted in the same durable job.
{
  const store = new MemoryJobStore();
  const seeded = makeJob({
    id: "kgj_11111111111111111111111111111111",
    now: 1_000,
    tokens: 100
  });
  await store.createOrGet({ job: seeded, ownerSubjectHash: seeded.ownerSubjectHash });
  const { engine, calls } = engineFor({ tokens: 100 });
  const orchestrator = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => 301_001,
    stallAfterMs: 300_000,
    maxStallRecoveries: 2
  });

  const result = await orchestrator.reconcile(seeded.id);
  assert.equal(result.action, "stall_recovered");
  assert.equal(calls.cancelled.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].text, /stall recovery/i);
  assert.equal(result.job.status, JOB_STATES.WORKING);
  assert.equal(result.job.stallRecoveryCount, 1);
  assert.equal(result.job.currentRunId, null);
  assert.equal(result.job.currentTurnTokens, 0);
  assert.equal(result.job.currentTurnToolCalls, 0);
  assert.equal(result.job.lastProgressAt, 301_001);
}

// A working turn that advances its token count is real progress and must not be
// cancelled even if its previous progress timestamp is old.
{
  const store = new MemoryJobStore();
  const seeded = makeJob({
    id: "kgj_22222222222222222222222222222222",
    now: 1_000,
    tokens: 100
  });
  await store.createOrGet({ job: seeded, ownerSubjectHash: seeded.ownerSubjectHash });
  const { engine, calls } = engineFor({ tokens: 101 });
  const orchestrator = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => 301_001,
    stallAfterMs: 300_000,
    maxStallRecoveries: 2
  });

  const result = await orchestrator.reconcile(seeded.id);
  assert.equal(result.action, "working");
  assert.equal(calls.cancelled.length, 0);
  assert.equal(calls.sent.length, 0);
  assert.equal(result.job.currentTurnTokens, 101);
  assert.equal(result.job.lastProgressAt, 301_001);
  assert.equal(result.job.stallRecoveryCount, 0);
}

// Repeated stalls are bounded. Once the configured recovery count is exhausted,
// KeepGoing fails safely rather than thrashing the provider forever.
{
  const store = new MemoryJobStore();
  const seeded = makeJob({
    id: "kgj_33333333333333333333333333333333",
    now: 1_000,
    tokens: 100,
    stalls: 2
  });
  await store.createOrGet({ job: seeded, ownerSubjectHash: seeded.ownerSubjectHash });
  const { engine, calls } = engineFor({ tokens: 100 });
  const orchestrator = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => 301_001,
    stallAfterMs: 300_000,
    maxStallRecoveries: 2
  });

  const result = await orchestrator.reconcile(seeded.id);
  assert.equal(result.action, "stalled_failed");
  assert.equal(calls.cancelled.length, 1);
  assert.equal(calls.sent.length, 0);
  assert.equal(result.job.status, JOB_STATES.FAILED);
  assert.equal(result.job.safeErrorCode, "provider_stalled");
}

console.log("stall recovery tests passed");
