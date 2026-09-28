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
