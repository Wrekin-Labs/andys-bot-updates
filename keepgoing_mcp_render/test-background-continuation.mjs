import assert from "node:assert/strict";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { createWebhookProcessor } from "./webhook_processor.js";
import { createWatchdog } from "./watchdog.js";

class EventMemoryStore extends MemoryJobStore {
  constructor() {
    super();
    this.providerEvents = new Set();
  }

  async recordEvent({ providerEventId = null }) {
    if (providerEventId && this.providerEvents.has(providerEventId)) {
      return { inserted: false };
    }
    if (providerEventId) this.providerEvents.add(providerEventId);
    return { inserted: true };
  }
}

function durableEngine() {
  let turn = 1;
  let sends = 0;
  return {
    get sends() { return sends; },
    get turn() { return turn; },

    async getSession() {
      return { id: "sess_bg", status: "idle", required_actions: [] };
    },
    async listTurns() {
      return {
        data: [{
          id: "turn_" + turn,
          status: "completed",
          subagent_id: null,
          usage: { total_tokens: 100 }
        }]
      };
    },
    async listTurnItems(_sessionId, turnId) {
      const output = turn === 1
        ? "checkpoint complete\nSTATUS: PARTIAL"
        : "all done\nSTATUS: COMPLETED";
      return {
        data: [{
          id: "msg_" + turn,
          type: "message",
          turn_id: turnId,
          status: "completed",
          content: [{ type: "output_text", text: output }]
        }],
        found: true,
        truncated: false
      };
    },
    async listItems() {
      return { data: [] };
    },
    async sendMessage(_sessionId, _text, key) {
      assert.match(key, /^kg-cont-/);
      sends += 1;
      turn = 2;
      return { ok: true };
    },
    async cancelTurn() {
      return { ok: true };
    }
  };
}

async function seedWorkingJob(store, id, now) {
  const job = newJobRecord({
    id,
    ownerSubjectHash: "ownerhash",
    now,
    limits: {
      maxAttempts: 6,
      maxWallMs: 600_000,
      maxTotalTokens: 20_000,
      maxToolCalls: 3
    }
  });
  job.status = JOB_STATES.WORKING;
  job.providerSessionId = "sess_bg";
  job.currentRunId = "sess_bg";
  job.updatedAt = now;
  job.lastProgressAt = now;
  await store.createOrGet({ job, ownerSubjectHash: job.ownerSubjectHash });
  return job;
}

// Webhook path: no get/wait polling is involved. An idle provider event drives
// PARTIAL -> continuation, then a later idle event completes the same job.
{
  const store = new EventMemoryStore();
  const engine = durableEngine();
  let clock = 10_000;
  const orchestrator = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => ++clock
  });
  const job = await seedWorkingJob(
    store,
    "kgj_11111111111111111111111111111111",
    9_000
  );

  const processor = createWebhookProcessor({
    store,
    orchestrator,
    verify: async (raw) => JSON.parse(raw)
  });

  const first = await processor.ingest(
    JSON.stringify({
      id: "evt_partial",
      type: "agent.session.idle",
      data: { id: "sess_bg" }
    }),
    { "webhook-id": "wh_partial" }
  );
  const continued = await processor.process(first);
  assert.equal(continued.action, "continued");
  assert.equal(engine.sends, 1);
  assert.equal((await store.get(job.id)).status, JOB_STATES.WORKING);

  const second = await processor.ingest(
    JSON.stringify({
      id: "evt_complete",
      type: "agent.session.idle",
      data: { id: "sess_bg" }
    }),
    { "webhook-id": "wh_complete" }
  );
  const completed = await processor.process(second);
  assert.equal(completed.action, JOB_STATES.COMPLETED);
  assert.equal((await store.get(job.id)).status, JOB_STATES.COMPLETED);
  assert.equal(engine.sends, 1);
}

// Watchdog path: if the webhook is missed, a stale working job is reconciled
// and continued server-side, then a later watchdog pass completes it.
{
  const store = new EventMemoryStore();
  const engine = durableEngine();
  let clock = 100_000;
  const orchestrator = new KeepGoingOrchestrator({
    engine,
    store,
    now: () => clock
  });
  const job = await seedWorkingJob(
    store,
    "kgj_22222222222222222222222222222222",
    1_000
  );
  const watchdog = createWatchdog({
    store,
    orchestrator,
    now: () => clock,
    staleAfterMs: 30_000,
    cleanupEveryMs: 86_400_000
  });

  const firstPass = await watchdog.runOnce();
  assert.equal(firstPass.checked, 1);
  assert.equal(firstPass.results[0].action, "continued");
  assert.equal(engine.sends, 1);

  clock += 31_000;
  const secondPass = await watchdog.runOnce();
  assert.equal(secondPass.checked, 1);
  assert.equal(secondPass.results[0].action, JOB_STATES.COMPLETED);
  assert.equal((await store.get(job.id)).status, JOB_STATES.COMPLETED);
  assert.equal(engine.sends, 1);
}

console.log("background continuation integration tests passed");
