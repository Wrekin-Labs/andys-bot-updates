import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");

assert.match(source, /KEEPGOING_V12_ENABLED/);
assert.match(source, /KEEPGOING_V12_CANARY_ONLY/);
assert.match(source, /version: v12Access \? APP_VERSION : "1\.1\.0"/);
assert.match(source, /APP_VERSION = "1\.2\.0-beta\.6"/);
assert.match(source, /app\.get\("\/icon\.svg"/);
assert.match(source, /app\.get\("\/manifest\.json"/);
assert.match(source, /app\.get\("\/refunds"/);
assert.match(source, /app\.get\("\/robots\.txt"/);
assert.match(source, /app\.get\("\/sitemap\.xml"/);
assert.match(source, /app\.get\("\/faq"/);
assert.match(source, /app\.get\("\/status"/);
assert.match(source, /app\.get\("\/changelog"/);
assert.match(source, /app\.get\("\/subscribe"/);
assert.match(source, /req\.path === "\/subscribe"/);
assert.match(source, /The public plugin experience does not sell or upgrade digital subscriptions/);
assert.doesNotMatch(source, /href="\/subscribe"/);
assert.match(source, /og:title/);
assert.match(source, /twitter:card/);
assert.match(source, /app\.disable\("x-powered-by"\)/);
assert.match(source, /KEEPGOING_OWNER_TOKEN_HASH \|\| ""/);
assert.doesNotMatch(source, /300caf15b670e9aa648ffc6aa9f7249297566ff6b0ba37898ee4f2da7bd91697/);
assert.match(source, /req\.path\.startsWith\("\/oauth\/"\)/);
assert.match(source, /X-Robots-Tag/);
assert.match(source, /setup_error: Boolean\(paypalSetupError\)/);
assert.doesNotMatch(source, /webhook_id: paypalConfig\.webhook_id/);
assert.match(source, /Built for work that takes more than one turn/);
assert.match(source, /Install KeepGoing/);
assert.match(source, /Service status/);
assert.match(source, /href="\/faq"/);
assert.match(source, /href="\/changelog"/);
assert.match(source, /Refunds & cancellation/);
assert.match(source, /KEEPGOING_DURABLE_STORE_URL/);
assert.match(source, /proxyUrl: V12_DURABLE_STORE_URL/);
assert.match(source, /V12_CANARY_ONLY \|\| OPENAI_WEBHOOK_SECRET/);
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
assert.match(source, /toolName === "start_persistent_job" \|\| toolName === "continue_until_done"/);
assert.match(source, /access\._mcp_request_id = "mcp-" \+ digest/);
assert.match(source, /clientRequestId: args\.clientRequestId \|\| access\._mcp_request_id \|\| null/);
assert.match(source, /server\.registerTool\("list_persistent_jobs"/);
assert.match(source, /server\.registerTool\("resume_persistent_job"/);
assert.match(source, /server\.registerTool\("continue_until_done"/);
assert.match(source, /Prefer continue_until_done/);
assert.match(source, /context: z\.string\(\)\.max\(4000\)/);\nassert.doesNotMatch(source, /max\(20000\).*context|context: z\.string\(\)\.max\(20000\)/);\nassert.match(source, /Brief task-specific checkpoint only/);\nassert.match(source, /full conversation history, raw transcripts, credentials/);
assert.match(source, /durable_engine_ready: v12Configured\(\)/);
assert.match(source, /runtime\.store\?\.healthCheck/);
assert.match(source, /durable_store_ready: durableStoreReady/);
assert.match(source, /const commercialDurableReady = !V12_ENABLED \|\| Boolean/);
assert.match(source, /!V12_CANARY_ONLY &&[\s\S]{0,120}OPENAI_WEBHOOK_SECRET/);
assert.match(source, /commercialBlockers\.push\("live_checkout"\)/);
assert.match(source, /commercialBlockers\.push\("v12_owner_canary_only"\)/);
assert.match(source, /commercialBlockers\.push\("openai_webhook"\)/);
assert.match(source, /sell_ready: sellReady/);
assert.match(source, /runtime\.watchdog\.runOnce\(\)/);
assert.match(source, /name: "get_profile"[\s\S]{0,900}"openai\/profile": true/);
for (const title of [
  "Start persistent job",
  "Continue until done",
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
