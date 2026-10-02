import { randomUUID } from "node:crypto";

export const ENGINEERING_PHASES = [
  "planning",
  "coding",
  "testing",
  "reviewing",
  "ci",
  "pr_ready",
  "blocked",
  "paused",
  "failed",
  "completed"
];

const ALLOWED_TRANSITIONS = new Map([
  ["planning", new Set(["coding","blocked","paused","failed"])],
  ["coding", new Set(["testing","blocked","paused","failed"])],
  ["testing", new Set(["coding","reviewing","blocked","paused","failed"])],
  ["reviewing", new Set(["coding","ci","blocked","paused","failed"])],
  ["ci", new Set(["coding","pr_ready","blocked","paused","failed"])],
  ["pr_ready", new Set(["coding","completed","blocked","paused","failed"])],
  ["blocked", new Set(["planning","coding","testing","reviewing","ci","pr_ready","paused","failed"])],
  ["paused", new Set(["planning","coding","testing","reviewing","ci","pr_ready","blocked","failed"])],
  ["failed", new Set(["coding","paused"])],
  ["completed", new Set()]
]);

const DEFAULT_PROGRESS = {
  planning: 10,
  coding: 35,
  testing: 60,
  reviewing: 75,
  ci: 88,
  pr_ready: 95,
  blocked: null,
  paused: null,
  failed: null,
  completed: 100
};

function cleanString(value, max = 500) {
  if (value == null) return null;
  return String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function cleanProgress(value, phase) {
  if (value == null || value === "") return DEFAULT_PROGRESS[phase] ?? null;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PROGRESS[phase] ?? null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanUrl(value) {
  const text = cleanString(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:","https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class EngineeringTaskStore {
  constructor({ onChange } = {}) {
    this.tasks = new Map();
    this.onChange = typeof onChange === "function" ? onChange : () => {};
  }

  _emit(kind, task, detail = {}) {
    this.onChange({ kind, task: clone(task), detail: clone(detail) });
  }

  _task(id) {
    const task = this.tasks.get(String(id || ""));
    if (!task) throw new Error("task_not_found");
    return task;
  }

  create(raw = {}) {
    const now = new Date().toISOString();
    const title = cleanString(raw.title, 180);
    if (!title) throw new Error("title_required");
    const projectId = cleanString(raw.project_id, 80);
    const id = cleanString(raw.id, 100) || `eng_${randomUUID()}`;
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id)) throw new Error("invalid_task_id");
    if (this.tasks.has(id)) throw new Error("task_exists");

    const task = {
      id,
      title,
      project_id: projectId,
      project_name: cleanString(raw.project_name, 120),
      repository: cleanString(raw.repository, 240),
      branch: cleanString(raw.branch, 200),
      phase: "planning",
      progress: cleanProgress(raw.progress, "planning"),
      summary: cleanString(raw.summary, 1200),
      blocker: null,
      needs_owner: false,
      pending_approval: null,
      resume_phase: null,
      evidence: [],
      created_at: now,
      updated_at: now,
      completed_at: null
    };
    this.tasks.set(id, task);
    this._emit("created", task);
    return clone(task);
  }

  get(id) {
    return clone(this._task(id));
  }

  list() {
    return [...this.tasks.values()]
      .sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .map(clone);
  }

  summary() {
    const rows = [...this.tasks.values()];
    return {
      all: rows.length,
      active: rows.filter(t => ["planning","coding","testing","reviewing","ci"].includes(t.phase)).length,
      needs_owner: rows.filter(t => t.needs_owner).length,
      pr_ready: rows.filter(t => t.phase === "pr_ready").length,
      completed: rows.filter(t => t.phase === "completed").length,
      failed: rows.filter(t => t.phase === "failed").length
    };
  }

  transition(id, nextPhase, raw = {}) {
    const task = this._task(id);
    const phase = String(nextPhase || "");
    if (!ENGINEERING_PHASES.includes(phase)) throw new Error("invalid_phase");
    if (task.pending_approval) throw new Error("approval_pending");
    if (task.phase === "completed") throw new Error("task_completed");
    if (phase !== task.phase && !ALLOWED_TRANSITIONS.get(task.phase)?.has(phase)) {
      throw new Error(`invalid_transition:${task.phase}->${phase}`);
    }

    const now = new Date().toISOString();
    task.phase = phase;
    task.progress = cleanProgress(raw.progress, phase);
    if (raw.summary !== undefined) task.summary = cleanString(raw.summary, 1200);
    task.blocker = phase === "blocked" ? cleanString(raw.blocker, 500) || task.blocker || "Blocked" : cleanString(raw.blocker, 500);
    task.needs_owner = Boolean(raw.needs_owner || phase === "blocked");
    task.updated_at = now;
    if (phase === "completed") {
      task.progress = 100;
      task.completed_at = now;
      task.needs_owner = false;
      task.blocker = null;
    } else {
      task.completed_at = null;
    }
    this._emit("transitioned", task, { phase });
    return clone(task);
  }

  addEvidence(id, raw = {}) {
    const task = this._task(id);
    const kind = cleanString(raw.kind, 60) || "note";
    const label = cleanString(raw.label, 180);
    if (!label) throw new Error("evidence_label_required");
    const item = {
      id: `ev_${randomUUID()}`,
      kind,
      label,
      detail: cleanString(raw.detail, 1000),
      url: cleanUrl(raw.url),
      created_at: new Date().toISOString()
    };
    task.evidence.unshift(item);
    if (task.evidence.length > 100) task.evidence.length = 100;
    task.updated_at = item.created_at;
    this._emit("evidence_added", task, { evidence: item });
    return clone(item);
  }

  requestApproval(id, raw = {}) {
    const task = this._task(id);
    if (task.phase === "completed") throw new Error("task_completed");
    if (task.pending_approval) throw new Error("approval_pending");
    const title = cleanString(raw.title, 180);
    if (!title) throw new Error("approval_title_required");
    const now = new Date().toISOString();
    const resume = ["blocked","paused","failed"].includes(task.phase)
      ? cleanString(raw.resume_phase, 40) || "coding"
      : task.phase;

    task.resume_phase = ENGINEERING_PHASES.includes(resume) && !["blocked","paused","failed","completed"].includes(resume)
      ? resume
      : "coding";
    task.pending_approval = {
      id: `approval_${randomUUID()}`,
      title,
      detail: cleanString(raw.detail, 1200),
      risk: cleanString(raw.risk, 40) || "medium",
      requested_at: now
    };
    task.phase = "blocked";
    task.progress = DEFAULT_PROGRESS.blocked;
    task.blocker = title;
    task.needs_owner = true;
    task.updated_at = now;
    this._emit("approval_requested", task, { approval: task.pending_approval });
    return clone(task);
  }

  resolveApproval(id, raw = {}) {
    const task = this._task(id);
    if (!task.pending_approval) throw new Error("no_pending_approval");
    const approved = raw.approved === true;
    const resolved = {
      ...task.pending_approval,
      approved,
      note: cleanString(raw.note, 800),
      resolved_at: new Date().toISOString()
    };
    task.pending_approval = null;
    task.needs_owner = false;
    task.blocker = null;
    task.updated_at = resolved.resolved_at;

    if (approved) {
      task.phase = task.resume_phase || "coding";
      task.progress = DEFAULT_PROGRESS[task.phase] ?? null;
    } else {
      task.phase = "paused";
      task.progress = DEFAULT_PROGRESS.paused;
      task.blocker = resolved.note || "Approval declined";
    }
    task.resume_phase = null;
    this._emit("approval_resolved", task, { approval: resolved });
    return clone(task);
  }

  restore(rows = []) {
    this.tasks.clear();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.id || !row?.title || !ENGINEERING_PHASES.includes(row.phase)) continue;
      const task = {
        id: cleanString(row.id, 100),
        title: cleanString(row.title, 180),
        project_id: cleanString(row.project_id, 80),
        project_name: cleanString(row.project_name, 120),
        repository: cleanString(row.repository, 240),
        branch: cleanString(row.branch, 200),
        phase: row.phase,
        progress: cleanProgress(row.progress, row.phase),
        summary: cleanString(row.summary, 1200),
        blocker: cleanString(row.blocker, 500),
        needs_owner: Boolean(row.needs_owner),
        pending_approval: row.pending_approval && row.pending_approval.id ? {
          id: cleanString(row.pending_approval.id, 120),
          title: cleanString(row.pending_approval.title, 180),
          detail: cleanString(row.pending_approval.detail, 1200),
          risk: cleanString(row.pending_approval.risk, 40) || "medium",
          requested_at: cleanString(row.pending_approval.requested_at, 80)
        } : null,
        resume_phase: cleanString(row.resume_phase, 40),
        evidence: Array.isArray(row.evidence) ? row.evidence.slice(0,100).map(e => ({
          id: cleanString(e.id, 120) || `ev_${randomUUID()}`,
          kind: cleanString(e.kind, 60) || "note",
          label: cleanString(e.label, 180) || "Evidence",
          detail: cleanString(e.detail, 1000),
          url: cleanUrl(e.url),
          created_at: cleanString(e.created_at, 80) || new Date().toISOString()
        })) : [],
        created_at: cleanString(row.created_at, 80) || new Date().toISOString(),
        updated_at: cleanString(row.updated_at, 80) || new Date().toISOString(),
        completed_at: cleanString(row.completed_at, 80)
      };
      this.tasks.set(task.id, task);
    }
  }
}
