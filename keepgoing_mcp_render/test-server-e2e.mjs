// End-to-end test of server.js over real HTTP.
//
// Boots the actual server module in-process with emulated upstreams (OpenAI
// Agents API, Supabase PostgREST, billing auth) behind a fetch interceptor, then
// drives it as an MCP client. Covers auth, tool listing, start idempotency,
// cross-account isolation, quotas, cancellation, artifacts, reports, safe
// errors and graceful shutdown. No network access or real credentials needed.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
// `npm start` runs this suite on production boot, so the inherited environment
// may hold live credentials. Strip every KeepGoing/provider variable first; the
// fetch interceptor below also refuses any non-emulated, non-loopback request.
for (const key of Object.keys(process.env)) {
  if (/^(KEEPGOING_|PAYPAL_|STRIPE_|OPENAI_|SUPABASE_)/.test(key)) delete process.env[key];
}
const OWNER_TOKEN = "owner-token-" + crypto.randomBytes(8).toString("hex");
Object.assign(process.env, {
  PORT: String(PORT),
  KEEPGOING_V12_ENABLED: "1",
  KEEPGOING_V12_CANARY_ONLY: "",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  KEEPGOING_SUPABASE_URL: "https://supabase.test",
  KEEPGOING_SUPABASE_SERVICE_KEY: "service-role-test",
  KEEPGOING_DURABLE_STORE_URL: "",
  KEEPGOING_BILLING_INGEST_URL: "",
  KEEPGOING_AUTH_URL: "https://auth.test/validate",
  KEEPGOING_OAUTH_CODE_URL: "https://auth.test/oauth-code",
  KEEPGOING_OWNER_TOKEN_HASH: sha256(OWNER_TOKEN),
  KEEPGOING_OAUTH_SECRET: "x".repeat(40),
  KEEPGOING_LOG_LEVEL: "error",
  KEEPGOING_MAX_ACTIVE_JOBS_PRO: "2",
  KEEPGOING_MCP_RATE_LIMIT_PER_MINUTE: "1000",
  KEEPGOING_V12_WATCHDOG_INTERVAL_MS: "10000",
  KEEPGOING_ALLOW_QUERY_TOKEN: "",
  OPENAI_WEBHOOK_SECRET: ""
});

// ---------------------------------------------------------------- emulators
const realFetch = globalThis.fetch;
const db = { jobs: new Map(), events: [] };
const agents = { sessions: new Map(), seq: 0, idem: new Map(), failCreates: 0 };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function matchesFilter(row, key, raw) {
  const value = row[key];
  if (raw.startsWith("eq.")) return String(value ?? "") === raw.slice(3);
  if (raw.startsWith("lte.")) return Date.parse(value) <= Date.parse(raw.slice(4));
  if (raw.startsWith("in.(")) return raw.slice(4, -1).split(",").includes(String(value));
  if (raw.startsWith("not.in.(")) return !raw.slice(8, -1).split(",").includes(String(value));
  throw new Error("emulator: unsupported filter " + key + "=" + raw);
}

function rowMatches(row, params) {
  for (const [key, raw] of params) {
    if (["order", "limit", "select"].includes(key)) continue;
    if (key === "or") {
      const clauses = raw.slice(1, -1).split(",");
      const any = clauses.some((clause) => {
        const [col, op, ...rest] = clause.split(".");
        const arg = rest.join(".");
        if (op === "neq") return String(row[col] ?? "") !== arg;
        if (op === "is" && arg === "null") return row[col] == null;
        throw new Error("emulator: unsupported or clause " + clause);
      });
      if (!any) return false;
      continue;
    }
    if (!matchesFilter(row, key, raw)) return false;
  }
  return true;
}

function postgrest(url, init) {
  const method = String(init.method || "GET").toUpperCase();
  const path = url.pathname;
  const params = [...url.searchParams.entries()];
  const body = init.body ? JSON.parse(init.body) : null;
  if (path === "/rest/v1/rpc/reserve_keepgoing_job") {
    const existing = body.p_client_request_hash
      ? [...db.jobs.values()].find((r) => r.owner_subject_hash === body.p_owner_subject_hash && r.client_request_hash === body.p_client_request_hash)
      : null;
    if (existing) return json(200, [existing]);
    const now = new Date().toISOString();
    const row = {
      job_id: body.p_job_id, owner_subject_hash: body.p_owner_subject_hash, client_request_hash: body.p_client_request_hash,
      engine: body.p_engine, provider_session_id: null, status: "queued", version: 1, attempt: 0,
      max_attempts: body.p_max_attempts, tokens_used: 0, token_budget_total: body.p_token_budget_total,
      tool_calls_used: 0, tool_call_budget_total: body.p_tool_call_budget_total, goal_hash: body.p_goal_hash,
      definition_hash: body.p_definition_hash, completion_marker: null, continuation_needed: false,
      continuation_claim_id: null, continuation_idempotency_key: null, last_assessed_turn_id: null,
      start_lease_until: body.p_start_lease_until, continuation_lease_until: null, repeated_output_count: 0,
      last_output_hash: null, safe_error_code: null, safe_error_message: null, started_at: now, updated_at: now,
      last_progress_at: now, wall_deadline_at: body.p_wall_deadline_at
    };
    db.jobs.set(row.job_id, row);
    return json(200, [row]);
  }
  if (path === "/rest/v1/rpc/cleanup_keepgoing_durable_state") return json(200, [{ deleted_jobs: 0, deleted_events: 0 }]);
  if (path === "/rest/v1/keepgoing_job_events") {
    if (method === "GET") return json(200, []);
    db.events.push(body);
    return json(201, [body]);
  }
  if (path === "/rest/v1/keepgoing_jobs") {
    let rows = [...db.jobs.values()].filter((row) => rowMatches(row, params));
    if (method === "GET") {
      const order = url.searchParams.get("order") || "";
      if (order === "updated_at.desc") rows.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      if (order === "updated_at.asc") rows.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
      const limit = Number(url.searchParams.get("limit") || 1000);
      return json(200, rows.slice(0, limit).map((r) => ({ ...r })));
    }
    if (method === "PATCH") {
      const updated = rows.map((row) => Object.assign(row, body));
      return json(200, updated.map((r) => ({ ...r })));
    }
  }
  throw new Error("emulator: unsupported PostgREST call " + method + " " + path);
}

function agentsApi(url, init) {
  const method = String(init.method || "GET").toUpperCase();
  const parts = url.pathname.replace(/^\/v1\/agents\/sessions\/?/, "").split("/").filter(Boolean);
  const idem = init.headers?.["Idempotency-Key"];
  if (method === "POST" && parts.length === 0) {
    if (agents.failCreates > 0) {
      agents.failCreates -= 1;
      return json(500, { error: { message: "upstream exploded; secret sk-live-abcdefghijklmnop leaked" } });
    }
    if (idem && agents.idem.has(idem)) return json(200, agents.idem.get(idem));
    const body = JSON.parse(init.body);
    const id = "sess_" + (++agents.seq);
    const session = {
      id, status: "running", metadata: body.metadata, required_actions: [],
      turns: [{ id: "turn_" + id + "_1", status: "in_progress", subagent_id: null, usage: { total_tokens: 0 } }],
      items: [{ id: "item_u1", turn_id: "turn_" + id + "_1", type: "message", role: "user", content: [{ type: "input_text", text: body.input }] }],
      artifacts: []
    };
    agents.sessions.set(id, session);
    const response = { id, status: session.status, metadata: session.metadata };
    if (idem) agents.idem.set(idem, response);
    return json(200, response);
  }
  if (method === "GET" && parts.length === 0) {
    return json(200, { data: [...agents.sessions.values()].map((s) => ({ id: s.id, metadata: s.metadata })), has_more: false });
  }
  const session = agents.sessions.get(parts[0]);
  if (!session) return json(404, { error: { message: "no such session" } });
  if (parts.length === 1) return json(200, { id: session.id, status: session.status, required_actions: session.required_actions });
  if (parts[1] === "turns") return json(200, { data: [...session.turns].reverse() });
  if (parts[1] === "items") {
    const order = url.searchParams.get("order");
    return json(200, { data: order === "desc" ? [...session.items].reverse() : [...session.items], has_more: false });
  }
  if (parts[1] === "events" && method === "POST") {
    if (idem && agents.idem.has(idem)) return json(200, agents.idem.get(idem));
    const event = JSON.parse(init.body).events[0];
    if (event.type === "agent.session.input.cancel") {
      const turn = session.turns.at(-1);
      if (turn && ["in_progress", "queued"].includes(turn.status)) turn.status = "cancelled";
      session.cancels = (session.cancels || 0) + 1;
    } else {
      const turnId = "turn_" + session.id + "_" + (session.turns.length + 1);
      session.turns.push({ id: turnId, status: "in_progress", subagent_id: null, usage: { total_tokens: 0 } });
      session.items.push({ id: "item_" + turnId, turn_id: turnId, type: "message", role: "user", content: event.input[0].content });
    }
    const response = { ok: true };
    if (idem) agents.idem.set(idem, response);
    return json(200, response);
  }
  if (parts[1] === "artifacts") {
    if (parts.length === 2) return json(200, { data: session.artifacts.map(({ content, ...meta }) => meta), has_more: false });
    const artifact = session.artifacts.find((a) => a.id === parts[2]);
    if (!artifact) return json(404, { error: { message: "no artifact" } });
    if (parts[3] === "content") return new Response(artifact.content, { status: 200 });
    const { content, ...meta } = artifact;
    return json(200, meta);
  }
  throw new Error("emulator: unsupported agents call " + method + " " + url.pathname);
}

function completeTurn(sessionId, text, tokens = 50) {
  const session = agents.sessions.get(sessionId);
  const turn = session.turns.at(-1);
  turn.status = "completed";
  turn.usage = { total_tokens: tokens };
  session.status = "idle";
  session.items.push({ id: "item_a_" + turn.id, turn_id: turn.id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.origin === "https://api.openai.com") return agentsApi(url, init);
  if (url.origin === "https://supabase.test") return postgrest(url, init);
  if (url.origin === "https://auth.test") {
    const { token } = JSON.parse(init.body);
    const customers = {
      "cust-A-token": { allowed: true, tier: "pro", subject: "customer_a" },
      "cust-B-token": { allowed: true, tier: "pro", subject: "customer_b" }
    };
    return customers[token] ? json(200, customers[token]) : json(401, { allowed: false, error: "invalid_token" });
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init);
  throw new Error("e2e test blocked an unexpected outbound request to " + url.origin);
};

// ------------------------------------------------------------------ server
await import("./server.js");
const base = "http://127.0.0.1:" + PORT;
for (let i = 0; i < 50; i++) {
  try { if ((await realFetch(base + "/health")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 50));
}

let rpcSeq = 100;
async function mcp(token, method, params = {}, { id = ++rpcSeq, query = "" } = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers["x-keepgoing-token"] = token;
  const response = await realFetch(base + "/mcp" + query, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  let body = null;
  if (type.includes("text/event-stream")) {
    const data = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    body = data.length ? JSON.parse(data.at(-1)) : null;
  } else {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, headers: response.headers, body };
}

async function call(token, name, args, opts) {
  const res = await mcp(token, "tools/call", { name, arguments: args }, opts);
  assert.equal(res.status, 200, "HTTP status for " + name + ": " + JSON.stringify(res.body));
  assert.ok(res.body?.result, "JSON-RPC result for " + name + ": " + JSON.stringify(res.body));
  return res.body.result;
}

// ---------------------------------------------------------- public routes
const health = await (await realFetch(base + "/health")).json();
assert.equal(health.ok, true);
const version = await (await realFetch(base + "/version")).json();
assert.equal(version.release, pkg.version);
assert.ok(version.tools.durable.includes("get_job_report"));
assert.equal(version.features.remote_push, false);
const readiness = await (await realFetch(base + "/readiness")).json();
assert.equal(readiness.release, pkg.version);
assert.equal(typeof readiness.config_ok, "boolean");
assert.equal(readiness.durable_store_ready, true);
assert.ok(!JSON.stringify(readiness).includes("KEEPGOING_"), "readiness must not leak env var names");

// ------------------------------------------------------------------ auth
const unauth = await mcp(null, "tools/list");
assert.equal(unauth.status, 401);
assert.match(unauth.headers.get("www-authenticate") || "", /Bearer/);
const queryToken = await mcp(null, "tools/list", {}, { query: "?token=" + encodeURIComponent(OWNER_TOKEN) });
assert.equal(queryToken.status, 401, "query-string tokens are refused by default");
const badToken = await mcp("not-a-token", "tools/list");
assert.equal(badToken.status, 401);

// ------------------------------------------------------------- tools/list
const listed = await mcp(OWNER_TOKEN, "tools/list");
const tools = listed.body.result.tools;
const names = tools.map((t) => t.name);
for (const name of ["get_profile", "start_persistent_job", "continue_until_done", "get_persistent_job", "wait_for_persistent_job",
  "cancel_persistent_job", "list_persistent_jobs", "list_job_artifacts", "read_job_artifact", "get_job_report", "resume_persistent_job"]) {
  assert.ok(names.includes(name), "tools/list includes " + name);
}
const reportTool = tools.find((t) => t.name === "get_job_report");
assert.equal(reportTool.annotations.readOnlyHint, true);
assert.equal(reportTool.annotations.openWorldHint, false);
assert.deepEqual(reportTool.securitySchemes, [{ type: "oauth2", scopes: ["keepgoing.jobs"] }]);
for (const tool of tools) {
  assert.equal(tool.inputSchema.additionalProperties, false, tool.name + " input schema is closed");
  assert.ok(tool.annotations && typeof tool.annotations.readOnlyHint === "boolean", tool.name + " has annotations");
}

// ---------------------------------------------- start + idempotency fix
const A = "cust-A-token";
const B = "cust-B-token";
const alpha = await call(A, "start_persistent_job", { goal: "alpha objective" }, { id: 1 });
assert.ok(!alpha.isError, JSON.stringify(alpha));
assert.match(alpha.structuredContent.job_id, /^kgj_[0-9a-f]{32}$/);
assert.equal(alpha.structuredContent.duplicate, false);
const alphaRetry = await call(A, "start_persistent_job", { goal: "alpha objective" }, { id: 1 });
assert.equal(alphaRetry.structuredContent.job_id, alpha.structuredContent.job_id, "identical retry reuses the job");
assert.equal(alphaRetry.structuredContent.duplicate, true);
const beta = await call(A, "start_persistent_job", { goal: "beta objective, unrelated" }, { id: 1 });
assert.notEqual(beta.structuredContent.job_id, alpha.structuredContent.job_id,
  "a different goal with a reused JSON-RPC id must start a new job (pre-1.5 returned the old one)");
const explicit = await call(A, "get_persistent_job", { job_id: beta.structuredContent.job_id });
assert.equal(explicit.structuredContent.status, "working");
assert.equal(explicit.structuredContent.output, "", "the job prompt (user input) is never reported as output");

// ---------------------------------------------------- active-job quota
const third = await call(A, "start_persistent_job", { goal: "gamma objective" });
assert.equal(third.isError, true);
assert.match(third.content[0].text, /Too many active KeepGoing jobs \(2\/2\)/);

// ------------------------------------------------ cross-account isolation
const alphaId = alpha.structuredContent.job_id;
for (const [name, args] of [
  ["get_persistent_job", { job_id: alphaId }],
  ["wait_for_persistent_job", { job_id: alphaId, wait_seconds: 1 }],
  ["cancel_persistent_job", { job_id: alphaId }],
  ["resume_persistent_job", { job_id: alphaId, input: "hi" }],
  ["list_job_artifacts", { job_id: alphaId }],
  ["read_job_artifact", { job_id: alphaId, artifact_id: "art_1" }],
  ["get_job_report", { job_id: alphaId }]
]) {
  const result = await call(B, name, args);
  assert.equal(result.isError, true, name + " must refuse another account's job");
  assert.match(result.content[0].text, /KeepGoing job not found/, name);
}
const bList = await call(B, "list_persistent_jobs", { activeOnly: false });
assert.equal(bList.structuredContent.jobs.length, 0);
const aList = await call(A, "list_persistent_jobs", {});
assert.equal(aList.structuredContent.jobs.length, 2);
const malformed = await call(A, "get_persistent_job", { job_id: "../../etc/passwd" });
assert.match(malformed.content[0].text, /KeepGoing job not found/);

// ------------------------------------------------------- cancellation
const betaId = beta.structuredContent.job_id;
const cancelled = await call(A, "cancel_persistent_job", { job_id: betaId });
assert.equal(cancelled.structuredContent.status, "cancelled");
const cancelledAgain = await call(A, "cancel_persistent_job", { job_id: betaId });
assert.equal(cancelledAgain.structuredContent.status, "cancelled", "cancel is idempotent");
const betaSession = db.jobs.get(betaId).provider_session_id;
assert.equal(agents.sessions.get(betaSession).turns.at(-1).status, "cancelled", "provider turn was cancelled");

// ------------------------------------- completion via watchdog + artifacts
const alphaSession = db.jobs.get(alphaId).provider_session_id;
const patch = "diff --git a/x b/x\n+fixed\n";
agents.sessions.get(alphaSession).artifacts.push(
  { id: "art_patch", path: "/workspace/outputs/changes.patch", size_bytes: Buffer.byteLength(patch), turn_id: "t", content: patch },
  { id: "art_report", path: "/workspace/outputs/REPORT.md", size_bytes: 9, turn_id: "t", content: "# Report\n" },
  { id: "art_escape", path: "/workspace/outputs/../etc/passwd", size_bytes: 10, turn_id: "t", content: "root:x" },
  { id: "art_project", path: "/workspace/project/.env", size_bytes: 10, turn_id: "t", content: "SECRET=1" },
  { id: "art_big", path: "/workspace/outputs/huge.log", size_bytes: 900_000, turn_id: "t", content: "x" }
);
completeTurn(alphaSession, "Implemented the fix.\nWORK_COMPLETED: yes\nSTATUS: COMPLETED");
const row = db.jobs.get(alphaId);
row.updated_at = new Date(Date.now() - 120_000).toISOString();
let alphaDone = null;
for (let i = 0; i < 70; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (db.jobs.get(alphaId).status === "completed") { alphaDone = true; break; }
}
assert.ok(alphaDone, "watchdog reconciled the completed turn");

const artifacts = await call(A, "list_job_artifacts", { job_id: alphaId });
assert.ok(!artifacts.isError, JSON.stringify(artifacts));
const manifest = artifacts.structuredContent.artifacts;
assert.deepEqual(manifest.map((a) => a.path), ["/workspace/outputs/REPORT.md", "/workspace/outputs/changes.patch", "/workspace/outputs/huge.log"],
  "manifest is sorted and excludes traversal and non-output paths");
assert.equal(manifest.find((a) => a.name === "huge.log").readable, false);
assert.equal(manifest.find((a) => a.name === "changes.patch").mime_type, "text/x-diff");

const read = await call(A, "read_job_artifact", { job_id: alphaId, artifact_id: "art_patch" });
assert.ok(!read.isError, JSON.stringify(read));
assert.equal(read.structuredContent.sha256, sha256(patch));
assert.equal(read.structuredContent.text, patch);
const escape = await call(A, "read_job_artifact", { job_id: alphaId, artifact_id: "art_escape" });
assert.equal(escape.isError, true);

const report = await call(A, "get_job_report", { job_id: alphaId });
assert.ok(!report.isError, JSON.stringify(report));
assert.equal(report.structuredContent.status, "completed");
assert.equal(report.structuredContent.terminal, true);
assert.equal(report.structuredContent.result.sha256, sha256("Implemented the fix.\nWORK_COMPLETED: yes\nSTATUS: COMPLETED"));
assert.equal(report.structuredContent.artifacts.length, 3);
const reportAgain = await call(A, "get_job_report", { job_id: alphaId });
assert.deepEqual(reportAgain.structuredContent, report.structuredContent, "report is deterministic");

// ------------------------------------------------------ safe errors
// Three consecutive provider 500s exhaust the orchestrator's transient retries.
agents.failCreates = 3;
const failing = await call(A, "start_persistent_job", { goal: "this start will hit a provider 500", clientRequestId: "fail-1" });
assert.equal(failing.isError, true);
assert.doesNotMatch(failing.content[0].text, /sk-live|exploded/, "provider internals are not echoed to the client");
assert.match(failing.content[0].text, /ref /, "client error carries a support reference");

// Quota freed after cancel/complete: a new start is allowed again.
const delta = await call(A, "start_persistent_job", { goal: "delta objective" });
assert.ok(!delta.isError, JSON.stringify(delta));

// ------------------------------------------------ reflected XSS guard
const xss = await (await realFetch(base + "/billing/success?session_id=" + encodeURIComponent("</script><script>alert(1)</script>"))).text();
assert.doesNotMatch(xss, /<script>alert/i, "query values cannot break out of the inline script");
const okSession = await (await realFetch(base + "/billing/success?session_id=cs_test_abc123")).text();
assert.match(okSession, /const sessionId="cs_test_abc123"/);
const subscribeXss = await (await realFetch(base + "/subscribe?subscription_id=I-ABC&claim_id=" + encodeURIComponent("</script>"))).text();
assert.doesNotMatch(subscribeXss, /claimId="<\/script>/);

console.log("server end-to-end tests passed");

// --------------------------------------------------- graceful shutdown
const exitWatch = setTimeout(() => {
  console.error("graceful shutdown did not complete");
  process.exit(1);
}, 12_000);
exitWatch.unref();
process.on("exit", (code) => {
  if (code !== 0) console.error("server exited with code " + code);
});
if (process.platform === "win32") process.emit("SIGTERM");
else process.kill(process.pid, "SIGTERM");
