import assert from "node:assert/strict";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";

class AuditStore extends MemoryJobStore {
  constructor() {
    super();
    this.events = [];
  }
  async recordEvent(event) {
    if (this.events.some((row) => row.providerEventId === event.providerEventId)) {
      return { inserted: false };
    }
    this.events.push(structuredClone(event));
    return { inserted: true };
  }
}

const store = new AuditStore();
const engine = {
  async getSession() {
    return { id: "sess_audit", status: "idle", required_actions: [] };
  },
  async listTurns() {
    return {
      data: [{
        id: "turn_audit",
        status: "completed",
        subagent_id: null,
        usage: { total_tokens: 100 }
      }]
    };
  },
  async listTurnItems() {
    return {
      data: [
        {
          id: "mcp_1",
          type: "mcp_call",
          turn_id: "turn_audit",
          status: "completed",
          server_label: "github",
          name: "fetch_file",
          arguments: { path: "private/source.js", secret: "do-not-log" },
          output: { content: "private source contents" }
        },
        {
          id: "web_1",
          type: "web_search_call",
          turn_id: "turn_audit",
          status: "completed",
          action: { query: "private search phrase" }
        },
        {
          id: "msg_1",
          type: "message",
          turn_id: "turn_audit",
          status: "completed",
          content: [{ type: "output_text", text: "done\nSTATUS: COMPLETED" }]
        }
      ],
      found: true,
      truncated: false
    };
  },
  async cancelTurn() {}
};

const job = newJobRecord({
  id: "kgj_33333333333333333333333333333333",
  ownerSubjectHash: "ownerhash",
  now: 1_000,
  limits: {
    maxAttempts: 6,
    maxWallMs: 600_000,
    maxTotalTokens: 20_000,
    maxToolCalls: 3
  }
});
job.status = JOB_STATES.WORKING;
job.providerSessionId = "sess_audit";
await store.createOrGet({ job, ownerSubjectHash: job.ownerSubjectHash });

const orchestrator = new KeepGoingOrchestrator({
  engine,
  store,
  now: () => 2_000
});

const result = await orchestrator.reconcile(job.id);
assert.equal(result.job.status, JOB_STATES.COMPLETED);
assert.equal(store.events.length, 2);

const mcp = store.events.find((event) => event.safeDetail.type === "mcp_call");
assert.equal(mcp.safeDetail.tool_name, "fetch_file");
assert.equal(mcp.safeDetail.server_label, "github");
assert.equal(mcp.safeDetail.status, "completed");

const encoded = JSON.stringify(store.events);
assert.ok(!encoded.includes("private/source.js"));
assert.ok(!encoded.includes("do-not-log"));
assert.ok(!encoded.includes("private source contents"));
assert.ok(!encoded.includes("private search phrase"));

await orchestrator.reconcile(job.id);
assert.equal(store.events.length, 2);

console.log("tool audit tests passed");
