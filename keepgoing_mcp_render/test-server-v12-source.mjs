import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");

assert.match(source, /KEEPGOING_V12_ENABLED/);
assert.match(source, /KEEPGOING_V12_CANARY_ONLY/);
assert.match(source, /version: v12Access \? APP_VERSION : "1\.1\.0"/);
assert.match(source, /APP_VERSION = "1\.4\.0-beta\.24"/);
assert.match(source, /app\.get\("\/icon\.svg"/);
assert.match(source, /app\.get\("\/icon\.png"/);
assert.match(source, /keepgoing-icon\.png/);
assert.match(source, /app\.get\("\/\.well-known\/security\.txt"/);
assert.match(source, /function setOAuthPageHeaders\(res\)/);
assert.match(source, /Content-Security-Policy/);
assert.match(source, /form-action/);
assert.match(source, /stripe_claim_error/);
assert.match(source, /paypal_claim_error/);
assert.match(source, /claim_upstream_error/);
assert.doesNotMatch(source, /return res\.status\(502\)\.json\(\{ error: String\(error\?\.message \|\| error\) \}\)/);
assert.match(source, /PayPal bootstrap failed:", safeLogError\(error\)/);
assert.match(source, /function fetchWithTimeout\(url, init = \{\}, timeoutMs = 10_000\)/);
assert.match(source, /app\.get\("\/owner\/paypal-setup"/);
assert.match(source, /app\.post\("\/owner\/paypal-setup"/);
assert.match(source, /PAYPAL_BOOTSTRAP_TOKEN_HASH/);
assert.match(source, /credentials_encrypted/);
assert.match(source, /sealToken\(PAYPAL_CREDENTIAL_PREFIX/);
assert.match(source, /unsealToken\(PAYPAL_CREDENTIAL_PREFIX/);
assert.match(source, /async function loadStoredPayPalCredentials\(\)/);
assert.match(source, /async function persistPayPalCredentials\(clientId, clientSecret\)/);
assert.match(source, /await paypalAccessTokenFor\(id, secret\)/);
assert.match(source, /req\.path\.startsWith\("\/owner\/"\)/);
assert.doesNotMatch(source, /client_secret[^\n]{0,120}res\.json/);
assert.match(source, /crypto\.randomUUID\(\)/);
assert.match(source, /X-Request-Id/);
assert.match(source, /httpServer\.requestTimeout = 90_000/);
assert.match(source, /httpServer\.headersTimeout = 15_000/);
assert.match(source, /httpServer\.keepAliveTimeout = 5_000/);
assert.match(source, /process\.once\("SIGTERM"/);
assert.match(source, /process\.once\("SIGINT"/);
assert.match(source, /function gracefulShutdown\(signal\)/);
assert.match(source, /paypal_webhook_verify_failed"[\s\S]{0,160}verification_status/);
assert.doesNotMatch(source, /paypal_webhook_verify_failed", verify\.status, verification\)/);
assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
assert.match(source, /fetchWithTimeout\(BILLING_INGEST_URL/);
assert.match(source, /fetchWithTimeout\(BILLING_CONFIG_URL/);
assert.match(source, /fetchWithTimeout\(PAYPAL_BASE \+ "\/v1\/oauth2\/token"/);
assert.match(source, /fetchWithTimeout\(PAYPAL_BASE \+ path/);
assert.match(source, /fetchWithTimeout\(OAUTH_CODE_URL/);
assert.match(source, /fetchWithTimeout\(AUTH_URL/);
assert.ok((source.match(/fetchWithTimeout\(CLAIM_URL/g) || []).length >= 2);
assert.match(source, /SoftwareApplication/);
assert.match(source, /app\.get\("\/manifest\.json"/);
assert.match(source, /app\.get\("\/refunds"/);
assert.match(source, /app\.get\("\/robots\.txt"/);
assert.match(source, /app\.get\("\/sitemap\.xml"/);
assert.match(source, /app\.get\("\/faq"/);
assert.match(source, /app\.get\("\/status"/);
assert.match(source, /app\.get\("\/changelog"/);
assert.match(source, /app\.get\("\/subscribe"/);
assert.match(source, /req\.path === "\/subscribe"/);
assert.match(source, /Purchasing and account upgrades are not part of the ChatGPT plugin experience/);
assert.match(source, /Connect existing account/);
assert.match(source, /Existing customers connect with their private activation token/);
assert.match(source, /The ChatGPT plugin does not initiate purchases or upgrades/);
assert.match(source, /explicitly asks KeepGoing/);
assert.match(source, /const ownerAutoContinue = Boolean\(access\?\.admin \|\| access\?\.tier === "owner"\)/);
assert.match(source, /OWNER MODE: Treat plain continuation phrases/);
assert.match(source, /continue, keep going, finish it, until done/);
assert.match(source, /ownerAutoContinue \? ownerV12Instructions : publicV12Instructions/);
assert.ok((source.match(/description: startToolDescription/g) || []).length >= 2);
assert.ok((source.match(/description: continueToolDescription/g) || []).length >= 2);
assert.match(source, /Public\/customer connections retain explicit KeepGoing intent requirements/);
assert.doesNotMatch(source, /PRIMARY entrypoint for/);
const oauthAuthorizeStart = source.indexOf('app.get("/oauth/authorize"');
const oauthAuthorizeEnd = source.indexOf('app.post("/oauth/authorize"', oauthAuthorizeStart);
assert.ok(oauthAuthorizeStart >= 0 && oauthAuthorizeEnd > oauthAuthorizeStart, "OAuth authorize GET handler must be present");
const oauthAuthorizeSource = source.slice(oauthAuthorizeStart, oauthAuthorizeEnd);
assert.match(oauthAuthorizeSource, /Connect KeepGoing/);
assert.match(oauthAuthorizeSource, /activation_token/);
assert.match(oauthAuthorizeSource, /does not sell, upgrade or change subscriptions/);
assert.doesNotMatch(oauthAuthorizeSource, /paypal\.Buttons|paypal\.com\/sdk|£7\.99|£29|setupMessage|proAction|bizAction/);

const publicRootStart = source.indexOf('app.get("/",');
const publicRootEnd = source.indexOf('app.get("/icon.svg"', publicRootStart);
assert.ok(publicRootStart >= 0 && publicRootEnd > publicRootStart, "public root handler must be present");
const publicRootSource = source.slice(publicRootStart, publicRootEnd);
assert.doesNotMatch(publicRootSource, /paypal\.Buttons|paypal\.com\/sdk|href="\/subscribe"/);
assert.doesNotMatch(publicRootSource, /£7\.99|£29|3 jobs\/month|100 jobs\/month|500 jobs\/month|<h3>Free<\/h3>|<h3>Pro<\/h3>|<h3>Business<\/h3>/);
const sitemapStart = source.indexOf('app.get("/sitemap.xml"');
const sitemapEnd = source.indexOf('app.get("/faq"', sitemapStart);
assert.ok(sitemapStart >= 0 && sitemapEnd > sitemapStart, "sitemap handler must be present");
assert.doesNotMatch(source.slice(sitemapStart, sitemapEnd), /\/subscribe/);
const installStart = source.indexOf('app.get("/install"');
const installEnd = source.indexOf('app.get("/privacy"', installStart);
assert.ok(installStart >= 0 && installEnd > installStart, "install handler must be present");
assert.doesNotMatch(source.slice(installStart, installEnd), /\/subscribe|paypal\.Buttons|paypal\.com\/sdk/);
const subscribeStart = source.indexOf('app.get("/subscribe"');
const subscribeEnd = source.indexOf('app.get("/",', subscribeStart);
assert.ok(subscribeStart >= 0 && subscribeEnd > subscribeStart, "direct subscribe handler must be present");
assert.match(source.slice(subscribeStart, subscribeEnd), /\/paypal\/start-subscription/);
assert.match(source.slice(subscribeStart, subscribeEnd), /Continue with PayPal/);
assert.doesNotMatch(source.slice(subscribeStart, subscribeEnd), /paypal\.Buttons|paypal\.com\/sdk/);
assert.match(source, /og:title/);
assert.match(source, /twitter:card/);
assert.match(source, /app\.disable\("x-powered-by"\)/);
assert.match(source, /KEEPGOING_OWNER_TOKEN_HASH \|\| ""/);
assert.doesNotMatch(source, /300caf15b670e9aa648ffc6aa9f7249297566ff6b0ba37898ee4f2da7bd91697/);
assert.match(source, /req\.path\.startsWith\("\/oauth\/"\)/);
assert.match(source, /X-Robots-Tag/);
assert.match(source, /setup_error: Boolean\(paypalSetupError && !paypalSetupComplete\)/);
assert.doesNotMatch(source, /webhook_id: paypalConfig\.webhook_id/);
assert.match(source, /Built for work that takes more than one turn/);
assert.match(source, /Install KeepGoing/);
assert.match(source, /Service status/);
assert.match(source, /href="\/faq"/);
assert.match(source, /href="\/changelog"/);
assert.match(source, /Refunds & cancellation/);
assert.match(source, /KEEPGOING_DURABLE_STORE_URL/);
assert.match(source, /proxyUrl: V12_DURABLE_STORE_URL/);
assert.match(source, /const durableOpsReady = !V12_ENABLED \|\| Boolean/);
assert.match(source, /function v12ForAccess\(access\)/);
assert.match(source, /if \(isStart && V12_ENABLED && !v12ForAccess\(access\)\)/);
assert.match(source, /validateCustomerToken\(access\._customer_token, true\)/);
assert.match(source, /const v12Access = v12ForAccess\(access\)/);
assert.match(source, /createV12Service/);
assert.match(source, /createWatchdog/);
assert.match(source, /createOpenAIWebhookVerifier/);
assert.doesNotMatch(source, /signing_secret[^\n]{0,80}res\.json/);
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
assert.match(source, /server\.registerTool\("list_job_artifacts"/);
assert.match(source, /server\.registerTool\("read_job_artifact"/);
assert.match(source, /Prefer continue_until_done/);
assert.match(source, /context: z\.string\(\)\.max\(4000\)/);
assert.match(source, /context: \{ type: "string", maxLength: 4000/);
assert.match(source, /codingWorkspace: z\.boolean\(\)\.default\(false\)/);
assert.match(source, /repositoryUrl: z\.string\(\)\.url\(\)\.max\(500\)/);
assert.match(source, /repositoryRef: z\.string\(\)\.max\(200\)/);
assert.match(source, /workspaceFiles: z\.array\(z\.object\(\{/);
assert.match(source, /path: z\.string\(\)\.min\(1\)\.max\(180\)/);
assert.match(source, /content: z\.string\(\)\.max\(32000\)/);
assert.match(source, /workspaceFiles: Array\.isArray\(args\.workspaceFiles\) \? args\.workspaceFiles : \[\]/);
assert.match(source, /codingWorkspace: \{ type: "boolean", default: false/);
assert.match(source, /repositoryUrl: \{ type: "string", format: "uri", maxLength: 500/);
assert.match(source, /repositoryRef: \{ type: "string", maxLength: 200/);
assert.match(source, /workspaceFiles: \{[\s\S]{0,120}type: "array"[\s\S]{0,120}maxItems: 8/);
assert.match(source, /codingWorkspace: Boolean\(args\.codingWorkspace\)/);
assert.match(source, /repositoryUrl: args\.repositoryUrl \|\| null/);
assert.match(source, /repositoryRef: args\.repositoryRef \|\| null/);
assert.match(source, /Coding workspace requires KeepGoing durable v1\.2\+/);
assert.doesNotMatch(source, /context: z\.string\(\)\.max\(20000\)|context: \{ type: "string", maxLength: 20000/);
assert.match(source, /Brief task-specific checkpoint only/);
assert.match(source, /full conversation history, raw transcripts, credentials/);
assert.match(source, /durable_engine_ready: v12Configured\(\)/);
assert.match(source, /runtime\.store\?\.healthCheck/);
assert.match(source, /durable_store_ready: durableStoreReady/);
assert.match(source, /const commercialDurableReady = !V12_ENABLED \|\| Boolean/);
assert.match(source, /durableStoreReady &&[\s\S]{0,120}!V12_CANARY_ONLY/);
assert.match(source, /commercialBlockers\.push\("live_checkout"\)/);
assert.match(source, /commercialBlockers\.push\("v12_owner_canary_only"\)/);
assert.match(source, /const continuationMode = V12_ENABLED/);
assert.match(source, /"watchdog\+webhook" : "watchdog"/);
assert.match(source, /watchdog_ready:/);
assert.doesNotMatch(source, /commercialBlockers\.push\("openai_webhook"\)/);
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
  "Resume persistent job",
  "List job artifacts",
  "Read job artifact"
]) {
  assert.ok(source.includes('title: "' + title + '"'), "missing tool title: " + title);
}
assert.match(source, /name: "get_persistent_job"[\s\S]{0,1300}openWorldHint: false/);
assert.match(source, /name: "wait_for_persistent_job"[\s\S]{0,1500}openWorldHint: false/);
assert.match(source, /name: "cancel_persistent_job"[\s\S]{0,1200}destructiveHint: true[\s\S]{0,120}openWorldHint: false/);
assert.match(source, /name: "list_persistent_jobs"[\s\S]{0,1800}readOnlyHint: true[\s\S]{0,160}openWorldHint: false/);
assert.match(source, /name: "resume_persistent_job"[\s\S]{0,1500}readOnlyHint: false[\s\S]{0,200}openWorldHint: true/);
assert.match(source, /name: "list_job_artifacts"[\s\S]{0,1800}readOnlyHint: true[\s\S]{0,180}openWorldHint: false/);
assert.match(source, /name: "read_job_artifact"[\s\S]{0,1800}readOnlyHint: true[\s\S]{0,180}openWorldHint: false/);

console.log("server v1.2 source guards passed");

assert.doesNotMatch(source, /ensureOpenAIWebhookSetup/);
assert.doesNotMatch(source, /agent\.session\.idle/);

assert.match(source, /setup_error: Boolean\(paypalSetupError && !paypalSetupComplete\)/);
