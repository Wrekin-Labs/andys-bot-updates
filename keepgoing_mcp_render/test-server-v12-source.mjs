import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");

assert.match(source, /KEEPGOING_V12_ENABLED/);
assert.match(source, /createV12Service/);
assert.match(source, /createWatchdog/);
assert.match(source, /createOpenAIWebhookVerifier/);
assert.match(source, /express\.text\(\{ type: "application\/json"/);
assert.ok(
  source.indexOf('app.post("/openai/webhook"') <
  source.indexOf('app.use(express.json'),
  "OpenAI webhook must receive the raw body before JSON middleware"
);
assert.match(source, /authorise\(req, isStart && !V12_ENABLED\)/);
assert.match(source, /access\._mcp_request_id = "mcp-" \+ digest/);
assert.match(source, /clientRequestId: args\.clientRequestId \|\| access\._mcp_request_id \|\| null/);
assert.match(source, /server\.registerTool\("list_persistent_jobs"/);
assert.match(source, /server\.registerTool\("resume_persistent_job"/);
assert.match(source, /durable_engine_ready: v12Configured\(\)/);
assert.match(source, /sell_ready: engineReady && billingBackendReady && checkoutReady && durableOpsReady/);
assert.match(source, /runtime\.watchdog\.runOnce\(\)/);

console.log("server v1.2 source guards passed");
