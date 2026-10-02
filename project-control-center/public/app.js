const root = document.querySelector("#control-center");
const connection = root.querySelector("#connection");
const summary = root.querySelector("#summary");
const projectsEl = root.querySelector("#projects");
const eventsEl = root.querySelector("#events");
const sessionsEl = document.querySelector("#sessions");
const taskPanel = root.querySelector("#task-panel");
const newTaskForm = document.querySelector("#new-task");
const tokenInput = document.querySelector("#control-token");
const filterButtons = [...root.querySelectorAll("[data-filter]")];

let snapshot = null;
let filter = "all";
let selectedTaskId = null;

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const age = iso => {
  if (!iso) return "No signal yet";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s/60)}m ago` : `${Math.floor(s/3600)}h ago`;
};
const label = s => ({unknown:"Waiting",queued:"Queued",working:"Working",healthy:"Healthy",blocked:"Blocked",needs_owner:"Needs Andrew",failed:"Failed",completed:"Done",paused:"Paused"}[s] || s);
const cls = s => s === "needs_owner" ? "needs" : s === "failed" ? "failed" : s === "blocked" ? "blocked" : ["working","queued"].includes(s) ? "working" : ["completed","healthy"].includes(s) ? "good" : "idle";
const phaseLabel = p => ({planning:"Planning",coding:"Coding",testing:"Testing",reviewing:"Review",ci:"CI",pr_ready:"PR ready",blocked:"Blocked",paused:"Paused",failed:"Failed",completed:"Completed"}[p] || p);
const LINEAR = ["planning","coding","testing","reviewing","ci","pr_ready","completed"];

function authHeaders(extra = {}) {
  const token = tokenInput.value.trim();
  return token ? { ...extra, "x-project-control-token": token } : extra;
}

async function api(path, options = {}) {
  const headers = authHeaders(options.body ? {"content-type":"application/json"} : {});
  const res = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function renderSummary() {
  const p = snapshot?.totals || {};
  const e = snapshot?.engineering_totals || {};
  summary.innerHTML = [
    ["Active projects", p.active || 0, "info"],
    ["Engineering", e.active || 0, "info"],
    ["Needs you", (p.needs_owner || 0) + (e.needs_owner || 0), "warn"],
    ["PR ready", e.pr_ready || 0, "good"],
    ["Completed", (p.completed || 0) + (e.completed || 0), "good"]
  ].map(([l,v,c]) => `<div class="metric ${c}"><strong>${v}</strong><span>${l}</span></div>`).join("");
}

function renderSessions() {
  const tasks = snapshot?.engineering_tasks || [];
  if (!selectedTaskId && tasks.length) selectedTaskId = tasks[0].id;
  sessionsEl.innerHTML = tasks.length ? tasks.map(t => `
    <button class="session ${t.id === selectedTaskId ? "active" : ""}" type="button" data-task-id="${esc(t.id)}">
      <strong>${esc(t.title)}</strong>
      <small><span>${esc(phaseLabel(t.phase))}</span><span>${age(t.updated_at)}</span></small>
    </button>`).join("") : '<div class="empty">No sessions yet.</div>';
  sessionsEl.querySelectorAll("[data-task-id]").forEach(btn => btn.addEventListener("click", () => {
    selectedTaskId = btn.dataset.taskId;
    render();
  }));
}

function pipeline(task) {
  const normalPhase = task.phase === "blocked" || task.phase === "paused" || task.phase === "failed" ? task.resume_phase || "coding" : task.phase;
  const idx = LINEAR.indexOf(normalPhase);
  return LINEAR.slice(0,6).map((p,i) => `<span class="step ${i < idx ? "done" : i === idx ? "current" : ""}" title="${esc(phaseLabel(p))}"></span>`).join("");
}

function renderTask() {
  const task = (snapshot?.engineering_tasks || []).find(t => t.id === selectedTaskId);
  if (!task) {
    taskPanel.classList.add("hidden");
    taskPanel.innerHTML = "";
    return;
  }
  taskPanel.classList.remove("hidden");

  const current = LINEAR.indexOf(task.phase);
  const canAdvance = current >= 0 && current < LINEAR.length - 1 && !task.pending_approval;
  const next = canAdvance ? LINEAR[current + 1] : null;
  const approval = task.pending_approval ? `
    <div class="approval"><strong>Approval required · ${esc(task.pending_approval.title)}</strong>
      <div>${esc(task.pending_approval.detail || "This step is waiting for owner approval.")}</div>
      <div class="approval-actions"><button class="btn good" data-approve="true">Approve & continue</button><button class="btn bad" data-approve="false">Reject & pause</button></div>
    </div>` : "";

  const evidence = (task.evidence || []).slice(0,8).map(e => `
    <div class="evidence-item"><span>•</span><div><strong>${esc(e.label)}</strong><small>${esc(e.kind)} · ${age(e.created_at)}${e.detail ? " · " + esc(e.detail) : ""}</small></div></div>`).join("");

  taskPanel.innerHTML = `
    <div class="task-head"><div><div class="eyebrow">Engineering session</div><h2>${esc(task.title)}</h2><div class="task-meta">
      ${task.project_name ? `<span>${esc(task.project_name)}</span>` : ""}
      ${task.repository ? `<span>${esc(task.repository)}</span>` : ""}
      ${task.branch ? `<span>${esc(task.branch)}</span>` : ""}
      <span>Updated ${age(task.updated_at)}</span>
    </div></div><span class="phase">${esc(phaseLabel(task.phase))}</span></div>
    <div class="pipeline">${pipeline(task)}</div>
    <div class="task-summary">${esc(task.summary || "Session created. Planning is ready to begin.")}</div>
    ${task.blocker ? `<div class="blocker">${esc(task.blocker)}</div>` : ""}
    ${approval}
    <div class="task-actions">
      ${next ? `<button class="btn primary" data-advance="${esc(next)}">Advance to ${esc(phaseLabel(next))}</button>` : ""}
      ${!["completed","paused"].includes(task.phase) && !task.pending_approval ? `<button class="btn" data-pause>Pause</button>` : ""}
    </div>
    <div class="evidence"><h3>Evidence</h3><div class="evidence-list">${evidence || '<div class="empty">Build, test, review and CI evidence will appear here.</div>'}</div></div>`;

  taskPanel.querySelector("[data-advance]")?.addEventListener("click", async e => {
    try {
      await api(`/api/engineering/tasks/${encodeURIComponent(task.id)}/transition`, {
        method:"POST",
        body:JSON.stringify({ phase:e.currentTarget.dataset.advance, summary:`Moved to ${phaseLabel(e.currentTarget.dataset.advance)}.` })
      });
      await refresh();
    } catch (err) { alert(err.message); }
  });
  taskPanel.querySelector("[data-pause]")?.addEventListener("click", async () => {
    try {
      await api(`/api/engineering/tasks/${encodeURIComponent(task.id)}/transition`, { method:"POST", body:JSON.stringify({ phase:"paused", summary:"Paused by owner." }) });
      await refresh();
    } catch (err) { alert(err.message); }
  });
  taskPanel.querySelectorAll("[data-approve]").forEach(btn => btn.addEventListener("click", async () => {
    try {
      await api(`/api/engineering/tasks/${encodeURIComponent(task.id)}/approval-resolve`, {
        method:"POST",
        body:JSON.stringify({ approved:btn.dataset.approve === "true" })
      });
      await refresh();
    } catch (err) { alert(err.message); }
  }));
}

function renderProjects() {
  const now = Date.now();
  const enriched = (snapshot?.projects || []).map(p => {
    const staleMs = (p.id === "relay-home" || p.id === "relay-studio") ? 210000 : 900000;
    if (p.updated_at && ["healthy","working"].includes(p.status) && now - Date.parse(p.updated_at) > staleMs) {
      return { ...p, status:"blocked", blocker:"Status heartbeat is stale", needs_owner:true, stage:"No recent heartbeat" };
    }
    return p;
  });
  const visible = enriched.filter(p => filter === "active" ? ["queued","working"].includes(p.status) : filter === "needs" ? (p.needs_owner || ["needs_owner","blocked","failed"].includes(p.status)) : filter === "done" ? p.status === "completed" : true);
  projectsEl.innerHTML = visible.length ? visible.map(p => `
    <article class="project">
      <div class="project-top"><div><div class="eyebrow">${esc(p.type || p.source || "project")}</div><h3>${esc(p.name)}</h3></div><div class="pill ${cls(p.status)}"><span class="dot"></span>${esc(label(p.status))}</div></div>
      <div class="stage">${esc(p.stage || "Waiting for next update")}</div>
      ${p.progress == null ? "" : `<div class="progress"><span style="width:${Math.max(0,Math.min(100,p.progress))}%"></span></div>`}
      ${p.blocker ? `<div class="blocker">${esc(p.blocker)}</div>` : ""}
      <div class="message">${esc(p.last_message || "No recent message")}</div>
      <div class="meta"><span>${age(p.updated_at)}</span>${p.attempt == null ? "" : `<span>Attempt ${p.attempt}${p.max_attempts ? " / " + p.max_attempts : ""}</span>`}<span>${esc(p.source || "")}</span></div>
    </article>`).join("") : '<div class="empty">Nothing in this view.</div>';
}

function renderEvents() {
  eventsEl.innerHTML = (snapshot?.recent_events || []).slice(0,20).map(e => `
    <li><span class="event-dot ${cls(e.status)}"></span><div><strong>${esc(e.project_name || e.project_id)}</strong> — ${esc(e.message || e.stage || label(e.status))}<small>${age(e.timestamp)} · ${esc(e.source)}</small></div></li>`).join("") || '<li class="empty">Events will appear here live.</li>';
}

function render() {
  if (!snapshot) return;
  renderSummary();
  renderSessions();
  renderTask();
  renderProjects();
  renderEvents();
}

async function refresh() {
  snapshot = await (await fetch("/api/snapshot", { cache:"no-store" })).json();
  render();
}

async function start() {
  try {
    await refresh();
    connection.textContent = "Live";
    connection.className = "connection live";
    const res = await fetch("/api/stream", { cache:"no-store" });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buf += dec.decode(value, { stream:true });
      const frames = buf.split("\n\n");
      buf = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split("\n").find(x => x.startsWith("data: "));
        if (line) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.snapshot) {
              snapshot = payload.snapshot;
              render();
            }
          } catch {}
        }
      }
    }
  } catch {
    connection.textContent = "Reconnecting…";
    connection.className = "connection pending";
    setTimeout(start, 2500);
  }
}

newTaskForm.addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(newTaskForm));
  delete data[""];
  const token = tokenInput.value;
  try {
    const body = await api("/api/engineering/tasks", {
      method:"POST",
      body:JSON.stringify({
        title:data.title,
        project_name:data.project_name,
        repository:data.repository,
        branch:data.branch,
        summary:"Session created. Planning is ready to begin."
      })
    });
    selectedTaskId = body.task.id;
    newTaskForm.reset();
    tokenInput.value = token;
    sessionStorage.setItem("project-control-token", token);
    await refresh();
  } catch (err) { alert(err.message); }
});

tokenInput.value = sessionStorage.getItem("project-control-token") || "";
tokenInput.addEventListener("input", () => sessionStorage.setItem("project-control-token", tokenInput.value));

filterButtons.forEach(button => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  filterButtons.forEach(x => x.setAttribute("aria-pressed", String(x === button)));
  renderProjects();
}));

setInterval(() => snapshot && render(), 5000);
start();
