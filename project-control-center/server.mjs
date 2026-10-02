import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startAdapters } from "./adapters.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Math.max(1, Number(process.env.PORT || 8787));
const HOST = String(process.env.HOST || "127.0.0.1");
const LOCAL_VIEW = HOST === "127.0.0.1" || HOST === "::1" || HOST === "localhost";
const CONTROL_TOKEN = String(process.env.PROJECT_CONTROL_TOKEN || "");
const MAX_EVENTS = 500;
const clients = new Set();

const projects = new Map();
const events = [];

try {
  const registry = JSON.parse(await readFile(path.join(ROOT, "projects.json"), "utf8"));
  for (const item of registry) seedProject(item.id, item.name, item.type || "project");
} catch {
  seedProject("keepgoing", "KeepGoing", "AI orchestration");
  seedProject("project-relay", "Project Relay", "Remote control");
  seedProject("github", "GitHub / CI", "Source control");
}

function seedProject(id, name, type) {
  projects.set(id, {
    id, name, type,
    status: "unknown",
    stage: "Waiting for signal",
    progress: null,
    blocker: null,
    needs_owner: false,
    last_message: null,
    updated_at: null,
    source: "registry"
  });
}

function authorized(req) {
  if (!CONTROL_TOKEN) return false;
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const alt = String(req.headers["x-project-control-token"] || "");
  return token === CONTROL_TOKEN || alt === CONTROL_TOKEN;
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(text);
}

function cleanString(value, max = 500) {
  return value == null ? null : String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function cleanProgress(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeEvent(raw = {}) {
  const projectId = cleanString(raw.project_id, 80);
  if (!projectId || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(projectId)) {
    throw new Error("invalid project_id");
  }
  const allowed = new Set(["unknown","queued","working","healthy","blocked","needs_owner","failed","completed","paused"]);
  const status = allowed.has(String(raw.status || "")) ? String(raw.status) : "working";
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    project_name: cleanString(raw.project_name, 120),
    status,
    stage: cleanString(raw.stage, 180),
    progress: cleanProgress(raw.progress),
    blocker: cleanString(raw.blocker, 300),
    needs_owner: Boolean(raw.needs_owner || status === "needs_owner"),
    message: cleanString(raw.message, 800),
    source: cleanString(raw.source, 80) || "external",
    job_id: cleanString(raw.job_id, 200),
    attempt: Number.isFinite(Number(raw.attempt)) ? Math.max(0, Math.trunc(Number(raw.attempt))) : null,
    max_attempts: Number.isFinite(Number(raw.max_attempts)) ? Math.max(0, Math.trunc(Number(raw.max_attempts))) : null,
    timestamp: new Date().toISOString()
  };
}

function applyEvent(evt) {
  const old = projects.get(evt.project_id) || {};
  projects.set(evt.project_id, {
    id: evt.project_id,
    name: evt.project_name || old.name || evt.project_id,
    type: old.type || "project",
    status: evt.status,
    stage: evt.stage || old.stage || null,
    progress: evt.progress,
    blocker: evt.blocker,
    needs_owner: evt.needs_owner,
    last_message: evt.message,
    job_id: evt.job_id,
    attempt: evt.attempt,
    max_attempts: evt.max_attempts,
    updated_at: evt.timestamp,
    source: evt.source
  });
  events.unshift(evt);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  broadcast({ type: "event", event: evt, snapshot: snapshot() });
}

function snapshot() {
  const rows = [...projects.values()].sort((a,b) => {
    const weight = s => s === "needs_owner" ? 0 : s === "failed" ? 1 : s === "blocked" ? 2 : s === "working" ? 3 : 4;
    return weight(a.status) - weight(b.status) || a.name.localeCompare(b.name);
  });
  return {
    generated_at: new Date().toISOString(),
    projects: rows,
    totals: {
      all: rows.length,
      active: rows.filter(p => ["queued","working"].includes(p.status)).length,
      needs_owner: rows.filter(p => p.needs_owner || p.status === "needs_owner").length,
      failed: rows.filter(p => p.status === "failed").length,
      completed: rows.filter(p => p.status === "completed").length
    },
    recent_events: events.slice(0, 50)
  };
}

function broadcast(payload) {
  const frame = "data: " + JSON.stringify(payload) + "\n\n";
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

async function serveFile(res, file, contentType) {
  try {
    const body = await readFile(path.join(PUBLIC, file));
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": file === "index.html" ? "no-store" : "public, max-age=60",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    res.end(body);
  } catch {
    json(res, 404, { error: "not_found" });
  }
}

async function readJson(req, limit = 32_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/" && req.method === "GET") return serveFile(res, "index.html", "text/html; charset=utf-8");
  if (url.pathname === "/app.js" && req.method === "GET") return serveFile(res, "app.js", "text/javascript; charset=utf-8");
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true, version: "0.1.0", configured: Boolean(CONTROL_TOKEN), clients: clients.size });
  }
  const viewRequest = req.method === "GET" && (url.pathname === "/api/snapshot" || url.pathname === "/api/stream");
  if (url.pathname.startsWith("/api/") && !(LOCAL_VIEW && viewRequest) && !authorized(req)) {
    res.setHeader("www-authenticate", 'Bearer realm="Project Control Center"');
    return json(res, 401, { error: "unauthorized" });
  }
  if (url.pathname === "/api/snapshot" && req.method === "GET") return json(res, 200, snapshot());
  if (url.pathname === "/api/events" && req.method === "POST") {
    try {
      const evt = normalizeEvent(await readJson(req));
      applyEvent(evt);
      return json(res, 202, { accepted: true, event_id: evt.id });
    } catch (error) {
      return json(res, String(error?.message) === "payload_too_large" ? 413 : 400, { error: cleanString(error?.message, 120) || "invalid_event" });
    }
  }
  if (url.pathname === "/api/stream" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    clients.add(res);
    res.write("data: " + JSON.stringify({ type: "snapshot", snapshot: snapshot() }) + "\n\n");
    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch {}
    }, 15_000);
    res.on("close", () => { clearInterval(keepalive); clients.delete(res); });
    return;
  }
  return json(res, 404, { error: "not_found" });
});

server.requestTimeout = 15_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log("project_control_center_listening", { host: HOST, port: PORT, version: "0.1.0", local_view: LOCAL_VIEW });
});



const stopAdapters = startAdapters({
  ingest: (raw) => {
    try { applyEvent(normalizeEvent(raw)); }
    catch (error) { console.warn("control_center_adapter_event_rejected", String(error?.message || error).slice(0,160)); }
  }
});
for (const signal of ["SIGINT","SIGTERM"]) process.once(signal, () => { stopAdapters(); server.close(() => process.exit(0)); });


