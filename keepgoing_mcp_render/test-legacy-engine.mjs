import assert from "node:assert/strict";
import { createLegacyEngine, isLegacyJobId, outputText } from "./legacy_engine.js";

const responses = new Map();
const calls = [];
let seq = 0;
async function fetchImpl(url, init = {}) {
  const path = new URL(url).pathname.replace(/^\/v1/, "");
  calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (init.method === "POST" && path === "/responses") {
    const body = JSON.parse(init.body);
    const id = "resp_test" + String(++seq).padStart(6, "0");
    responses.set(id, { id, status: "in_progress", metadata: body.metadata, output_text: "" });
    return json(200, responses.get(id));
  }
  const match = path.match(/^\/responses\/([^/]+)(\/cancel)?$/);
  if (match) {
    const row = responses.get(decodeURIComponent(match[1]));
    if (!row) return json(404, { error: { message: "No response found" } });
    if (match[2]) { row.status = "cancelled"; return json(200, row); }
    return json(200, row);
  }
  return json(500, { error: { message: "unexpected" } });
}

let clock = 0;
const engine = createLegacyEngine({
  apiKey: "sk-test",
  model: "gpt-test",
  fetchImpl,
  limitsForTier: () => ({ maxOutputTokens: 100, maxToolCalls: 2 }),
  sleep: async () => { clock += 2000; },
  now: () => clock
});

const started = await engine.start({ goal: "g", definitionOfDone: "d", mode: "balanced", allowWeb: true, tier: "pro", ownerSubjectHash: "owner-a" });
assert.match(started.job_id, /^resp_/);
const created = calls.find((c) => c.method === "POST" && c.path === "/responses").body;
assert.equal(created.metadata.keepgoing_owner, "owner-a", "legacy jobs are bound to their owner at creation");
assert.equal(created.background, true);
assert.equal(created.max_tool_calls, 2);
await assert.rejects(() => engine.start({ goal: "g", definitionOfDone: "d", ownerSubjectHash: "" }), /identity/);

// Owner can read; another account cannot read, wait on or cancel it.
const own = await engine.get(started.job_id, "owner-a");
assert.equal(own.status, "in_progress");
await assert.rejects(() => engine.get(started.job_id, "owner-b"), /KeepGoing job not found/);
await assert.rejects(() => engine.wait(started.job_id, "owner-b", false, 1), /KeepGoing job not found/);
const cancelCallsBefore = calls.filter((c) => c.path.endsWith("/cancel")).length;
await assert.rejects(() => engine.cancel(started.job_id, "owner-b"), /KeepGoing job not found/);
assert.equal(calls.filter((c) => c.path.endsWith("/cancel")).length, cancelCallsBefore, "no cancel is sent for a foreign job");

// Admin may act on any job.
assert.equal((await engine.get(started.job_id, "anyone", true)).job_id, started.job_id);

// Malformed and unknown ids are indistinguishable from foreign ones.
await assert.rejects(() => engine.get("../responses", "owner-a"), /KeepGoing job not found/);
await assert.rejects(() => engine.get("resp_doesnotexist01", "owner-a"), /KeepGoing job not found/);

// Pre-1.5 responses without owner metadata are refused unless explicitly allowed.
responses.set("resp_unbound000001", { id: "resp_unbound000001", status: "completed", metadata: {}, output_text: "old" });
await assert.rejects(() => engine.get("resp_unbound000001", "owner-a"), /KeepGoing job not found/);
const permissive = createLegacyEngine({ apiKey: "sk", model: "m", fetchImpl, limitsForTier: () => ({}), allowUnboundReads: true });
assert.equal((await permissive.get("resp_unbound000001", "owner-a")).output, "old");

// Wait polls until terminal or deadline.
const waiting = await engine.wait(started.job_id, "owner-a", false, 4);
assert.equal(waiting.should_continue_polling, true);
responses.get(started.job_id).status = "completed";
responses.get(started.job_id).output_text = "done\nSTATUS: COMPLETED";
const done = await engine.wait(started.job_id, "owner-a", false, 4);
assert.equal(done.should_continue_polling, false);
assert.match(done.output, /COMPLETED/);

// Cancel of an already-terminal job does not call the provider.
const before = calls.filter((c) => c.path.endsWith("/cancel")).length;
assert.equal((await engine.cancel(started.job_id, "owner-a")).status, "completed");
assert.equal(calls.filter((c) => c.path.endsWith("/cancel")).length, before);

assert.equal(isLegacyJobId("resp_abc12345"), true);
assert.equal(isLegacyJobId("kgj_" + "a".repeat(32)), false);
assert.equal(outputText({ output: [{ content: [{ type: "output_text", text: "a" }, { type: "output_text", text: "b" }] }] }), "a\nb");

console.log("legacy engine tests passed");
