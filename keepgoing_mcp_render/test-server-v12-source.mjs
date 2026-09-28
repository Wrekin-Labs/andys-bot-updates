import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");

assert.match(source, /KEEPGOING_V12_ENABLED/);
assert.match(source, /KEEPGOING_V12_CANARY_ONLY/);
assert.match(source, /function v12ForAccess\(access\)/);
assert.match(source, /if \(isStart && V12_ENABLED && !v12ForAccess\(access\)\)/);
assert.match(source, /validateCustomerToken\(access\._customer_token, true\)/);
assert.match(source, /const v12Access = v12ForAccess\(access\)/);
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
assert.match(source, /runtime\.store\?\.healthCheck/);
assert.match(source, /durable_store_ready: durableStoreReady/);
assert.match(source, /sell_ready: engineReady && billingBackendReady && checkoutReady && durableOpsReady/);
assert.match(source, /runtime\.watchdog\.runOnce\(\)/);
assert.match(source, /name: "get_profile"[\s\S]{0,900}"openai\/profile": true/);
for (const title of [
  "Start persistent job",
  "Get persistent job",
  "Wait for persistent job",
  "Cancel persistent job",
  "List persistent jobs",
  "Resume persistent job"
]) {
  assert.ok(source.includes('title: "' + title + '"'), "missing tool title: " + title);
}
assert.match(source, /name: "get_persistent_job"[\s\S]{0,1300}openWorldHint: false/);
assert.match(source, /name: "wait_for_persistent_job"[\s\S]{0,1500}openWorldHint: false/);
assert.match(source, /name: "cancel_persistent_job"[\s\S]{0,1200}destructiveHint: true[\s\S]{0,120}openWorldHint: false/);
assert.match(source, /name: "list_persistent_jobs"[\s\S]{0,1800}readOnlyHint: true[\s\S]{0,160}openWorldHint: false/);
assert.match(source, /name: "resume_persistent_job"[\s\S]{0,1500}readOnlyHint: false[\s\S]{0,200}openWorldHint: true/);

console.log("server v1.2 source guards passed");
