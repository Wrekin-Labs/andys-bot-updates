export class MemoryJobStore {
  constructor() {
    this.jobs = new Map();
    this.requests = new Map();
  }

  async createOrGet({ job, ownerSubjectHash, clientRequestId = null }) {
    const requestKey = clientRequestId
      ? String(ownerSubjectHash || "") + ":" + String(clientRequestId)
      : null;

    if (requestKey && this.requests.has(requestKey)) {
      const existingId = this.requests.get(requestKey);
      return { created: false, job: structuredClone(this.jobs.get(existingId)) };
    }
    if (this.jobs.has(job.id)) {
      return { created: false, job: structuredClone(this.jobs.get(job.id)) };
    }

    const record = { ...structuredClone(job), version: 1 };
    this.jobs.set(record.id, record);
    if (requestKey) this.requests.set(requestKey, record.id);
    return { created: true, job: structuredClone(record) };
  }

  async get(jobId) {
    const row = this.jobs.get(String(jobId));
    return row ? structuredClone(row) : null;
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
