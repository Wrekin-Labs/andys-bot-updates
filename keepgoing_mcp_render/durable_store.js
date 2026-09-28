export class MemoryJobStore {
  constructor() {
    this.jobs = new Map();
    this.requests = new Map();
  }

  async findByRequest(ownerSubjectHash, clientRequestId) {
    if (!clientRequestId) return null;
    const id = this.requests.get(requestKey(ownerSubjectHash, clientRequestId));
    return id ? this.get(id) : null;
  }

  async findByProviderSessionId(providerSessionId) {
    const wanted = String(providerSessionId || "");
    if (!wanted) return null;
    for (const row of this.jobs.values()) {
      if (row.providerSessionId === wanted) return structuredClone(row);
    }
    return null;
  }

  async createOrGet({ job, ownerSubjectHash, clientRequestId = null }) {
    const key = clientRequestId ? requestKey(ownerSubjectHash, clientRequestId) : null;

    if (key && this.requests.has(key)) {
      const existingId = this.requests.get(key);
      return { created: false, job: structuredClone(this.jobs.get(existingId)) };
    }
    if (this.jobs.has(job.id)) {
      return { created: false, job: structuredClone(this.jobs.get(job.id)) };
    }

    const record = { ...structuredClone(job), version: 1 };
    this.jobs.set(record.id, record);
    if (key) this.requests.set(key, record.id);
    return { created: true, job: structuredClone(record) };
  }

  async get(jobId) {
    const row = this.jobs.get(String(jobId));
    return row ? structuredClone(row) : null;
  }

  async listOwnerJobs(ownerSubjectHash, { limit = 20, activeOnly = false } = {}) {
    const owner = String(ownerSubjectHash || "");
    if (!owner) throw new Error("owner subject hash required");
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const active = new Set(["queued", "working", "continuing", "input_required"]);
    const rows = [...this.jobs.values()]
      .filter((row) =>
        row.ownerSubjectHash === owner &&
        (!activeOnly || active.has(row.status))
      )
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, safeLimit);
    return structuredClone(rows);
  }

  async listRecoverableJobs({ before, limit = 50 } = {}) {
    const cutoff = Number(before);
    const rows = [...this.jobs.values()]
      .filter((row) =>
        ["queued", "working", "continuing"].includes(row.status) &&
        Number(row.updatedAt || 0) <= cutoff
      )
      .sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0))
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
    return structuredClone(rows);
  }

  async cleanupRetention({
    now = Date.now(),
    jobRetentionDays = 30
  } = {}) {
    const cutoff = Number(now) - Math.max(1, Number(jobRetentionDays) || 30) * 86_400_000;
    const terminal = new Set([
      "completed","failed","cancelled","budget_exhausted"
    ]);
    const deleted = new Set();
    for (const [id, row] of this.jobs) {
      if (terminal.has(row.status) && Number(row.updatedAt || 0) <= cutoff) {
        this.jobs.delete(id);
        deleted.add(id);
      }
    }
    if (deleted.size) {
      for (const [key, id] of this.requests) {
        if (deleted.has(id)) this.requests.delete(key);
      }
    }
    return { deleted_jobs: deleted.size, deleted_events: 0 };
  }

  async compareAndSet(jobId, expectedVersion, next) {
    const current = this.jobs.get(String(jobId));
    if (!current) return { ok: false, reason: "not_found", job: null };
    if (current.version !== expectedVersion) {
      return { ok: false, reason: "version_conflict", job: structuredClone(current) };
    }
    const record = { ...structuredClone(next), id: current.id, version: current.version + 1 };
    this.jobs.set(current.id, record);
    return { ok: true, job: structuredClone(record) };
  }
}

function requestKey(ownerSubjectHash, clientRequestId) {
  return String(ownerSubjectHash || "") + ":" + String(clientRequestId || "");
}
