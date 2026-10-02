const sigs = new Map();

export function startAdapters({ ingest, log = console } = {}) {
  if (typeof ingest !== "function") throw new Error("ingest callback required");
  const stops = [];

  const emit = (event) => {
    const key = String(event.project_id || "");
    const comparable = { ...event };
    delete comparable.message;
    const sig = JSON.stringify(comparable);
    if (sigs.get(key) === sig) return;
    sigs.set(key, sig);
    ingest(event);
  };

  const keepGoing = createKeepGoingPoller(emit, log);
  if (keepGoing) stops.push(keepGoing);
  const relay = createRelayPoller(emit, log);
  if (relay) stops.push(relay);
  const github = createGithubPoller(emit, log);
  if (github) stops.push(github);

  return () => stops.forEach((stop) => { try { stop(); } catch {} });
}

function createKeepGoingPoller(emit, log) {
  const url = String(process.env.KEEPGOING_DURABLE_STORE_URL || "");
  const token = String(process.env.KEEPGOING_DURABLE_STORE_TOKEN || "");
  if (!url || !token) return null;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const path = "/rest/v1/keepgoing_jobs?select=job_id,status,attempt,max_attempts,tool_profile,safe_error_message,updated_at,last_progress_at&order=updated_at.desc&limit=50";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-keepgoing-ingest-token": token
        },
        body: JSON.stringify({ path, method: "GET", headers: {}, body: null }),
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error("KeepGoing state source returned " + res.status);
      const rows = await res.json();
      const active = rows.filter(r => ["queued","working","continuing","input_required"].includes(r.status));
      const failed = rows.filter(r => ["failed","budget_exhausted"].includes(r.status));
      emit({
        project_id: "keepgoing",
        project_name: "KeepGoing",
        status: failed.length ? "blocked" : active.length ? "working" : "healthy",
        stage: active.length ? active.length + " durable job" + (active.length === 1 ? "" : "s") + " active" : "Durable runner healthy",
        message: rows.length ? "Tracking " + rows.length + " recent durable jobs" : "No recent jobs",
        blocker: failed.length ? failed.length + " recent job" + (failed.length === 1 ? "" : "s") + " need review" : null,
        needs_owner: false,
        source: "keepgoing-adapter"
      });
      for (const row of rows.slice(0, 20)) {
        const mapped = mapKeepGoingStatus(row.status);
        emit({
          project_id: "kg-" + String(row.job_id || "").slice(-20),
          project_name: "KeepGoing job " + String(row.job_id || "").slice(-8),
          status: mapped,
          stage: "Durable job · " + String(row.status || "unknown"),
          message: row.safe_error_message || ("Tool profile: " + String(row.tool_profile || "web")),
          blocker: mapped === "blocked" || mapped === "failed" ? row.safe_error_message || "Job needs review" : null,
          needs_owner: mapped === "needs_owner",
          source: "keepgoing-adapter",
          job_id: row.job_id,
          attempt: row.attempt,
          max_attempts: row.max_attempts
        });
      }
    } catch (error) {
      log.warn?.("control_center_keepgoing_poll_error", String(error?.message || error).slice(0,180));
      emit({
        project_id: "keepgoing",
        project_name: "KeepGoing",
        status: "blocked",
        stage: "Status adapter unavailable",
        blocker: "Could not read durable-job status",
        message: "The dashboard will retry automatically.",
        source: "keepgoing-adapter"
      });
    } finally {
      running = false;
    }
  };
  poll();
  const timer = setInterval(poll, Math.max(2500, Number(process.env.KEEPGOING_CONTROL_POLL_MS || 4000)));
  return () => clearInterval(timer);
}

function createRelayPoller(emit, log) {
  const url = String(process.env.PROJECT_RELAY_HEALTH_URL || "");
  if (!url) return null;
  const auth = String(process.env.PROJECT_RELAY_AUTHORIZATION || "");
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const res = await fetch(url, {
        headers: auth ? { authorization: auth } : {},
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error("Relay health returned " + res.status);
      const body = await res.json().catch(() => ({}));
      emit({
        project_id: "project-relay",
        project_name: "Project Relay",
        status: body.ok === false ? "blocked" : "healthy",
        stage: "Gateway health",
        message: body.version ? "Relay " + body.version + " responding" : "Relay gateway responding",
        source: "relay-adapter"
      });
    } catch (error) {
      log.warn?.("control_center_relay_poll_error", String(error?.message || error).slice(0,180));
      emit({
        project_id: "project-relay",
        project_name: "Project Relay",
        status: "blocked",
        stage: "Relay health unavailable",
        blocker: "No healthy response from configured Relay endpoint",
        message: "Automatic retry is active.",
        source: "relay-adapter"
      });
    } finally { running = false; }
  };
  poll();
  const timer = setInterval(poll, Math.max(5000, Number(process.env.PROJECT_RELAY_CONTROL_POLL_MS || 15000)));
  return () => clearInterval(timer);
}

function createGithubPoller(emit, log) {
  const repo = String(process.env.PROJECT_CONTROL_GITHUB_REPOSITORY || "Wrekin-Labs/andys-bot-updates");
  const branch = String(process.env.PROJECT_CONTROL_GITHUB_BRANCH || "keepgoing-v1.2-durable-agent");
  const auth = String(process.env.PROJECT_CONTROL_GITHUB_TOKEN || "");
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const headers = { accept: "application/vnd.github+json", "user-agent": "wrekin-project-control-center" };
      if (auth) headers.authorization = "Bearer " + auth;
      const res = await fetch("https://api.github.com/repos/" + repo + "/commits/" + encodeURIComponent(branch), {
        headers, signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error("GitHub returned " + res.status);
      const body = await res.json();
      emit({
        project_id: "github",
        project_name: "GitHub / CI",
        status: "healthy",
        stage: branch,
        message: "Head " + String(body.sha || "").slice(0,7) + (body.commit?.message ? " · " + String(body.commit.message).split("\n")[0].slice(0,120) : ""),
        source: "github-adapter"
      });
    } catch (error) {
      log.warn?.("control_center_github_poll_error", String(error?.message || error).slice(0,180));
      emit({
        project_id: "github",
        project_name: "GitHub / CI",
        status: "blocked",
        stage: "Repository status unavailable",
        blocker: "GitHub adapter could not read the configured branch",
        message: "Automatic retry is active.",
        source: "github-adapter"
      });
    } finally { running = false; }
  };
  poll();
  const timer = setInterval(poll, Math.max(30000, Number(process.env.PROJECT_CONTROL_GITHUB_POLL_MS || 60000)));
  return () => clearInterval(timer);
}

function mapKeepGoingStatus(status) {
  if (["queued","working","continuing"].includes(status)) return "working";
  if (status === "input_required") return "needs_owner";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "budget_exhausted") return "blocked";
  if (status === "cancelled") return "paused";
  return "unknown";
}

