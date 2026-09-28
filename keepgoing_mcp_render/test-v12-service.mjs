import assert from "node:assert/strict";
import { createV12Service, planLimits } from "./v12_service.js";
import { MemoryJobStore } from "./durable_store.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";

let turn = 1;
const sent = [];
const engine = {
  async createSession() { return { id: "sess_service" }; },
  async getSession() { return { status: "idle", required_actions: [] }; },
  async listItems() {
    return { data: [{ content: [{ type: "output_text", text: turn === 1 ? "half\nSTATUS: PARTIAL" : "done\nSTATUS: COMPLETED" }] }] };
  },
  async listTurns() {
    return { data: [{ id: "turn_" + turn, status: "completed", subagent_id: null, usage: { total_tokens: 20 } }] };
  },
  async sendMessage(id, text, key) { sent.push({ id, text, key }); },
  async cancelTurn() {}
};

const store = new MemoryJobStore();
let clock = 1_000;
const orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });
const service = createV12Service({
  engine,
  store,
  orchestrator,
  model: "gpt-test",
  now: () => ++clock,
  sleep: async () => { clock += 2000; }
});

let quota = 0;
const started = await service.start({
  goal: "finish it",
  definitionOfDone: "done",
  ownerSubjectHash: "ownerhash",
  clientRequestId: "req-1",
  beforeCreateSession: async () => { quota++; }
});
assert.equal(started.status, JOB_STATES.WORKING);
assert.equal(started.model, "gpt-test");
assert.equal(quota, 1);

const duplicate = await service.start({
  goal: "finish it",
  definitionOfDone: "done",
  ownerSubjectHash: "ownerhash",
  clientRequestId: "req-1",
  beforeCreateSession: async () => { quota++; }
});
assert.equal(duplicate.duplicate, true);
assert.equal(quota, 1);

await orchestrator.reconcile(started.job_id);
assert.equal(sent.length, 1);

turn = 2;
await orchestrator.reconcile(started.job_id);
const finished = await service.get(started.job_id, "ownerhash");
assert.equal(finished.status, JOB_STATES.COMPLETED);
assert.match(finished.output, /COMPLETED/);

await assert.rejects(
  () => service.get(started.job_id, "different-owner"),
  /not found/i
);

const paused = newJobRecord({
  id: "kgj_dddddddddddddddddddddddddddddddd",
  ownerSubjectHash: "ownerhash",
  now: 5_000
});
paused.status = JOB_STATES.INPUT_REQUIRED;
paused.providerSessionId = "sess_service";
paused.lastAssessedTurnId = "turn_pause";
await store.createOrGet({ job: paused, ownerSubjectHash: "ownerhash" });

const resumed = await service.resume(
  paused.id,
  "Here is the missing information",
  "ownerhash"
);
assert.equal(resumed.status, JOB_STATES.WORKING);
assert.equal(sent.at(-1).id, "sess_service");
assert.match(sent.at(-1).key, /^kg-user-/);

const limits = planLimits("business", true);
assert.equal(limits.max_attempts, 10);
assert.equal(limits.max_total_tool_calls, 50);

console.log("v1.2 service tests passed");
