import assert from "node:assert/strict";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES } from "./durable_job.js";

class TestStore extends MemoryJobStore {
  async findByRequest(owner, requestId) {
    const id = this.requests.get(String(owner || "") + ":" + String(requestId));
    return id ? this.get(id) : null;
  }
}

function engineWith(outputs) {
  let sends = 0;
  let creates = 0;
  return {
    get sends() { return sends; },
    get creates() { return creates; },
    async createSession() { creates++; return { id: "sess_test", status: "in_progress" }; },
    async getSession() { return { id: "sess_test", status: "idle", required_actions: [] }; },
    async listItems() {
      const text = outputs.shift() ?? "done\nSTATUS: COMPLETED";
      return { data: [{ type: "message", content: [{ type: "output_text", text }] }] };
    },
    async sendMessage() { sends++; return { ok: true }; },
    async cancelTurn() { return { ok: true }; }
  };
}

const store = new TestStore();
const engine = engineWith(["half\nSTATUS: PARTIAL", "done\nSTATUS: COMPLETED"]);
let clock = 10_000;
const kg = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });

const first = await kg.start({
  initialPrompt: "do it",
  instructions: "finish it",
  ownerSubjectHash: "owner",
  clientRequestId: "req-1",
  limits: { maxAttempts: 4 }
});
assert.equal(first.created, true);
assert.equal(first.job.status, JOB_STATES.WORKING);

const duplicate = await kg.start({
  initialPrompt: "do it",
  instructions: "finish it",
  ownerSubjectHash: "owner",
  clientRequestId: "req-1"
});
assert.equal(duplicate.created, false);
assert.equal(engine.creates, 1);

const [a, b] = await Promise.all([kg.reconcile("sess_test"), kg.reconcile("sess_test")]);
assert.equal(engine.sends, 1);
assert.ok(["continued", "already_claimed", "already_updated", "working"].includes(a.action));
assert.ok(["continued", "already_claimed", "already_updated", "working"].includes(b.action));

const done = await kg.reconcile("sess_test");
assert.equal(done.job.status, JOB_STATES.COMPLETED);

const terminal = await kg.reconcile("sess_test");
assert.equal(terminal.action, "terminal");

console.log("orchestrator tests passed");
