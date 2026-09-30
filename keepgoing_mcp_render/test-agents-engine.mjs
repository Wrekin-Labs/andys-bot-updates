import assert from "node:assert/strict";
import { classifySession, createAgentsEngine, latestRootTurn, latestSessionText, turnHasFailedWork, turnToolCallCount } from "./agents_engine.js";

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    async json() {
      if (url.endsWith("/agents/sessions")) return { id: "sess_abc", status: "in_progress" };
      if (url.includes("/items")) {
        return { data: [{ type: "message", content: [{ type: "output_text", text: "done\nSTATUS: COMPLETED" }] }] };
      }
      if (url.includes("/turns")) {
        return {
          data: [{
            id: "turn_root",
            status: "completed",
            subagent_id: null,
            usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
          }]
        };
      }
      if (init?.method === "GET") return { id: "sess_abc", status: "idle", required_actions: [] };
      return { ok: true };
    }
  };
};

const engine = createAgentsEngine({
  apiKey: "test-key",
  model: "gpt-6-astra",
  fetchImpl: fakeFetch
});

const created = await engine.createSession({
  prompt: "research this",
  instructions: "finish the job",
  allowWeb: true,
  reasoningEffort: "high"
});
assert.equal(created.id, "sess_abc");
const createBody = JSON.parse(calls[0].init.body);
assert.equal(createBody.environment.type, "none");
assert.equal(createBody.agent.model, "gpt-6-astra");
assert.equal(createBody.agent.tools[0].type, "web_search");
assert.equal(createBody.agent.tools[0].mode, "live");

const mcpCreated = await engine.createSession({
  prompt: "edit the repo",
  instructions: "use approved tools",
  allowWeb: false,
  mcpTools: [{
    type: "mcp",
    server_label: "github",
    transport: {
      type: "http",
      server_url: "https://mcp.example.com/github"
    },
    allowed_tools: ["search", "fetch_file"],
    connection_origin: "service",
    required: true,
    credential_id: "cred_123"
  }]
});
assert.equal(mcpCreated.id, "sess_abc");
const mcpBody = JSON.parse(calls.at(-1).init.body);
assert.equal(mcpBody.agent.tools.length, 1);
assert.equal(mcpBody.agent.tools[0].type, "mcp");
assert.equal(mcpBody.agent.tools[0].server_label, "github");
assert.deepEqual(mcpBody.agent.tools[0].allowed_tools, ["search", "fetch_file"]);
assert.equal(mcpBody.agent.tools[0].credential_id, "cred_123");

await assert.rejects(
  () => engine.createSession({
    prompt: "bad",
    mcpTools: [{ type: "not-mcp" }]
  }),
  /Invalid KeepGoing MCP tool configuration/
);
assert.equal(calls[0].init.headers["OpenAI-Beta"], "agents=v1");

await engine.sendMessage("sess_abc", "continue", "kg-cont-test");
const sentCall = calls.at(-1);
const sent = JSON.parse(sentCall.init.body);
assert.equal(sent.events[0].type, "agent.session.input.message");
assert.equal(sent.events[0].input[0].content[0].text, "continue");
assert.equal(sentCall.init.headers["Idempotency-Key"], "kg-cont-test");

await engine.cancelTurn("sess_abc");
const cancelled = JSON.parse(calls.at(-1).init.body);
assert.equal(cancelled.events[0].type, "agent.session.input.cancel");

const items = await engine.listItems("sess_abc");
assert.equal(latestSessionText(items), "done\nSTATUS: COMPLETED");

const turns = await engine.listTurns("sess_abc");
assert.equal(latestRootTurn(turns).id, "turn_root");

const allItems = await engine.listAllItems("sess_abc");
assert.equal(allItems.data.length, 1);
assert.equal(allItems.truncated, false);

const pagedCalls = [];
const pagedEngine = createAgentsEngine({
  apiKey: "test-key",
  fetchImpl: async (url, init) => {
    pagedCalls.push(url);
    const parsed = new URL(url);
    const after = parsed.searchParams.get("after");
    const page = after
      ? { data: [{ id: "i2", type: "message", turn_id: "t", status: "completed", content: [{ type: "output_text", text: "second" }] }], has_more: false, last_id: "i2" }
      : { data: [{ id: "i1", type: "message", turn_id: "t", status: "completed", content: [{ type: "output_text", text: "first" }] }], has_more: true, last_id: "i1" };
    return { ok: true, status: 200, async json() { return page; } };
  }
});
const paged = await pagedEngine.listAllItems("sess_abc", { maxPages: 5 });
assert.equal(paged.data.length, 2);
assert.equal(paged.truncated, false);
assert.equal(pagedCalls.length, 2);
assert.match(pagedCalls[1], /after=i1/);

const turnPageCalls = [];
const turnPageEngine = createAgentsEngine({
  apiKey: "test-key",
  fetchImpl: async (url) => {
    turnPageCalls.push(url);
    const parsed = new URL(url);
    const after = parsed.searchParams.get("after");
    const page = !after
      ? {
          data: [
            { id: "i5", type: "web_search_call", turn_id: "turn_current", status: "completed" },
            { id: "i4", type: "message", turn_id: "turn_current", status: "completed", content: [{ type: "output_text", text: "final current" }] }
          ],
          has_more: true,
          last_id: "i4"
        }
      : {
          data: [
            { id: "i3", type: "reasoning", turn_id: "turn_current", status: "completed", summary: [] },
            { id: "i2", type: "message", turn_id: "turn_old", status: "completed", content: [{ type: "output_text", text: "old result" }] }
          ],
          has_more: true,
          last_id: "i2"
        };
    return { ok: true, status: 200, async json() { return page; } };
  }
});
const currentTurnItems = await turnPageEngine.listTurnItems(
  "sess_abc",
  "turn_current",
  { maxPages: 10 }
);
assert.deepEqual(currentTurnItems.data.map((item) => item.id), ["i3", "i4", "i5"]);
assert.equal(currentTurnItems.found, true);
assert.equal(currentTurnItems.truncated, false);
assert.equal(turnPageCalls.length, 2);
assert.match(turnPageCalls[0], /order=desc/);
assert.match(turnPageCalls[1], /after=i4/);
assert.equal(latestSessionText(currentTurnItems), "final current");
assert.equal(turnToolCallCount(currentTurnItems, "turn_current"), 1);
assert.ok(!currentTurnItems.data.some((item) => item.turn_id === "turn_old"));

await assert.rejects(
  () => turnPageEngine.listTurnItems("sess_abc", "../bad"),
  /valid turn id/
);

const recoveryCalls = [];
const recoveryEngine = createAgentsEngine({
  apiKey: "test-key",
  fetchImpl: async (url) => {
    recoveryCalls.push(url);
    const parsed = new URL(url);
    const after = parsed.searchParams.get("after");
    const page = after
      ? { data: [{ id: "sess_target", metadata: { keepgoing_job_id: "kgj_target" } }], has_more: false, last_id: "sess_target" }
      : { data: [{ id: "sess_other", metadata: { keepgoing_job_id: "kgj_other" } }], has_more: true, last_id: "sess_other" };
    return { ok: true, status: 200, async json() { return page; } };
  }
});
const recovered = await recoveryEngine.findSessionByMetadata("keepgoing_job_id", "kgj_target");
assert.equal(recovered.id, "sess_target");
assert.equal(recoveryCalls.length, 2);
assert.match(recoveryCalls[1], /after=sess_other/);

const session = await engine.getSession("sess_abc");
assert.deepEqual(
  classifySession(session, "done", turns, items),
  { providerStatus: "completed", output: "done", turnId: "turn_root", tokensUsed: 30, toolCallsUsed: 0, toolFailureDetected: false }
);

const failedItems = {
  data: [
    { type: "mcp_call", turn_id: "turn_root", status: "failed", error: "tool failed" }
  ]
};
assert.equal(turnHasFailedWork(failedItems, "turn_root"), true);
assert.equal(turnToolCallCount(failedItems, "turn_root"), 1);
assert.equal(
  classifySession(session, "done\nSTATUS: COMPLETED", turns, failedItems).providerStatus,
  "incomplete"
);

// Idle alone is not proof of success.
assert.equal(classifySession({ status: "idle" }, "", { data: [] }).providerStatus, "working");
assert.equal(
  classifySession({ status: "idle" }, "", { data: [{ id: "t2", status: "failed", subagent_id: null }] }).providerStatus,
  "failed"
);
assert.equal(
  classifySession({ status: "idle" }, "", { data: [{ id: "t3", status: "cancelled", subagent_id: null }] }).providerStatus,
  "cancelled"
);
assert.equal(
  classifySession({ status: "in_progress" }, "", { data: [{ id: "t4", status: "in_progress", subagent_id: null }] }).providerStatus,
  "working"
);
assert.equal(
  classifySession({ status: "idle", required_actions: [{ type: "function_call" }] }, "", turns).providerStatus,
  "action_required"
);

await assert.rejects(() => engine.getSession("../bad"), /valid session id/);
await assert.rejects(() => engine.listTurns("../bad"), /valid session id/);
await assert.rejects(() => engine.sendMessage("sess_abc", "x", "bad\nkey"), /valid idempotency key/);

console.log("agents engine tests passed");
