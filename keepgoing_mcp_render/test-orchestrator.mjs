import assert from "node:assert/strict";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES } from "./durable_job.js";

function engineWith(outputs) {
  let sends = 0;
  let creates = 0;
  const seenProviderIds = [];
  return {
    get sends() { return sends; },
    get creates() { return creates; },
    get seenProviderIds() { return seenProviderIds; },
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
      const text = outputs.shift() ?? "done\nSTATUS: COMPLETED";
      return { data: [{ type: "message", content: [{ type: "output_text", text }] }] };
    },
    async sendMessage(id) {
      seenProviderIds.push(id);
      sends++;
      return { ok: true };
    },
    async cancelTurn(id) {
      seenProviderIds.push(id);
      return { ok: true };
    }
  };
}

const store = new MemoryJobStore();
const engine = engineWith(["half\nSTATUS: PARTIAL", "done\nSTATUS: COMPLETED"]);
let clock = 10_000;
const kg = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });

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
assert.equal(engine.creates, 1);
assert.match(first.job.id, /^kgj_[a-f0-9]{32}$/);
assert.equal(first.job.providerSessionId, "sess_test");
assert.equal(first.job.status, JOB_STATES.WORKING);
assert.equal(first.job.id, duplicate.job.id);

const jobId = first.job.id;
const [a, b] = await Promise.all([kg.reconcile(jobId), kg.reconcile(jobId)]);
assert.equal(engine.sends, 1);
assert.ok(["continued", "already_claimed", "already_updated", "working"].includes(a.action));
assert.ok(["continued", "already_claimed", "already_updated", "working"].includes(b.action));
assert.ok(engine.seenProviderIds.every((id) => id === "sess_test"));

const done = await kg.reconcile(jobId);
assert.equal(done.job.status, JOB_STATES.COMPLETED);

const terminal = await kg.reconcile(jobId);
assert.equal(terminal.action, "terminal");

console.log("orchestrator tests passed");
