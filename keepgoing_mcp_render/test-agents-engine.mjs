import assert from "node:assert/strict";
import { classifySession, createAgentsEngine, latestSessionText } from "./agents_engine.js";

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    async json() {
      if (url.endsWith("/agents/sessions")) return { id: "sess_abc", status: "in_progress" };
      if (url.includes("/items")) return { data: [{ type: "message", content: [{ type: "output_text", text: "done\nSTATUS: COMPLETED" }] }] };
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
assert.equal(calls[0].init.headers["OpenAI-Beta"], "agents=v1");

await engine.sendMessage("sess_abc", "continue");
const sent = JSON.parse(calls.at(-1).init.body);
assert.equal(sent.events[0].type, "agent.session.input.message");
assert.equal(sent.events[0].input[0].content[0].text, "continue");

await engine.cancelTurn("sess_abc");
const cancelled = JSON.parse(calls.at(-1).init.body);
assert.equal(cancelled.events[0].type, "agent.session.input.cancel");

const items = await engine.listItems("sess_abc");
assert.equal(latestSessionText(items), "done\nSTATUS: COMPLETED");

const session = await engine.getSession("sess_abc");
assert.deepEqual(classifySession(session, "done"), { providerStatus: "completed", output: "done" });
assert.equal(classifySession({ status: "in_progress" }, "").providerStatus, "working");
assert.equal(classifySession({ status: "failed" }, "").providerStatus, "failed");
assert.equal(classifySession({ status: "idle", required_actions: [{ type: "function_call" }] }, "").providerStatus, "action_required");

await assert.rejects(() => engine.getSession("../bad"), /valid session id/);

console.log("agents engine tests passed");
