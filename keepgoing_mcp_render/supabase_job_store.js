import crypto from "node:crypto";

const ACTIVE_STATUSES = ["queued", "working", "continuing", "input_required"];
const STATUS_RE = /^[a-z_]{1,32}$/;
const DEFAULT_STORE_TIMEOUT_MS = 10_000;

export class SupabaseJobStore {
  constructor({
    supabaseUrl,
    serviceKey,
    proxyUrl = "",
    proxyToken = "",
    fetchImpl = globalThis.fetch,
    timeoutMs = Number(process.env.KEEPGOING_STORE_TIMEOUT_MS || DEFAULT_STORE_TIMEOUT_MS)
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");
    const directReady = Boolean(supabaseUrl && serviceKey);
    const proxyReady = Boolean(proxyUrl && proxyToken);
    if (!directReady && !proxyReady) {
      throw new Error("Supabase direct credentials or durable-store proxy required");
    }
    this.base = String(supabaseUrl || "").replace(/\/$/, "");
    this.serviceKey = String(serviceKey || "");
    this.proxyUrl = String(proxyUrl || "");
    this.proxyToken = String(proxyToken || "");
    this.fetchImpl = fetchImpl;
    // A hung store call must never stall the watchdog loop or an MCP request.
    this.timeoutMs = Math.max(1_000, Math.min(60_000, Number(timeoutMs) || DEFAULT_STORE_TIMEOUT_MS));
  }

  async healthCheck() {
    await Promise.all([
      this.request("/rest/v1/keepgoing_jobs?select=job_id&limit=1", { method: "GET" }),
      this.request("/rest/v1/keepgoing_job_events?select=id&limit=1", { method: "GET" })
    ]);
    return { ok: true };
  }

  async createOrGet({ job, ownerSubjectHash, clientRequestId = null }) {
    const rows = await this.request("/rest/v1/rpc/reserve_keepgoing_job", {
      method: "POST",
      body: JSON.stringify({
        p_job_id: job.id,
        p_owner_subject_hash: ownerSubjectHash,
        p_client_request_hash: clientRequestId ? sha256(clientRequestId) : null,
        p_engine: job.engine || "agents",
        p_goal_hash: job.goalHash || null,
        p_definition_hash: job.definitionHash || null,
        p_max_attempts: job.maxAttempts,
        p_token_budget_total: job.tokenBudgetTotal,
        p_tool_call_budget_total: job.toolCallBudgetTotal,
        p_wall_deadline_at: toIso(job.wallDeadlineAt),
        p_start_lease_until: toIso(job.startLeaseUntil),
        p_tool_profile: job.toolProfileName || "web",
        p_tool_policy_hash: job.toolPolicyHash || null,
        p_tool_write_capable: Boolean(job.toolWriteCapable)
      })
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("Durable job reservation returned no row");
    return { created: row.job_id === job.id, job: fromRow(row) };
  }

  async findByRequest(ownerSubjectHash, clientRequestId) {
    if (!clientRequestId) return null;
    const q = new URLSearchParams({
      owner_subject_hash: "eq." + ownerSubjectHash,
      client_request_hash: "eq." + sha256(clientRequestId),
      limit: "1"
    });
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), { method: "GET" });
    return Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null;
  }

  async findByProviderSessionId(providerSessionId) {
    const value = String(providerSessionId || "").trim();
    if (!value) return null;
    const q = new URLSearchParams({
      provider_session_id: "eq." + value,
      limit: "1"
    });
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), { method: "GET" });
    return Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null;
  }

  async get(jobId) {
    const q = new URLSearchParams({ job_id: "eq." + jobId, limit: "1" });
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), { method: "GET" });
    return Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null;
  }

  async listOwnerJobs(ownerSubjectHash, { limit = 20, activeOnly = false, statuses = null } = {}) {
    const owner = String(ownerSubjectHash || "").trim();
    if (!owner) throw new Error("owner subject hash required");
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const q = new URLSearchParams({
      owner_subject_hash: "eq." + owner,
      order: "updated_at.desc",
      limit: String(safeLimit)
    });
    const wanted = Array.isArray(statuses) && statuses.length
      ? statuses.map(String).filter((value) => STATUS_RE.test(value))
      : activeOnly ? ACTIVE_STATUSES : [];
    if (wanted.length) {
      q.set("status", "in.(" + wanted.join(",") + ")");
    }
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), { method: "GET" });
    return Array.isArray(rows) ? rows.map(fromRow) : [];
  }

  async listRecoverableJobs({ before, limit = 50 } = {}) {
    const cutoff = Number(before);
    if (!Number.isFinite(cutoff)) throw new Error("recovery cutoff required");
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const q = new URLSearchParams({
      status: "in.(queued,working,continuing)",
      updated_at: "lte." + new Date(cutoff).toISOString(),
      order: "updated_at.asc",
      limit: String(safeLimit)
    });
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), { method: "GET" });
    return Array.isArray(rows) ? rows.map(fromRow) : [];
  }

  async cleanupRetention({
    jobRetentionDays = 30,
    eventRetentionDays = 14
  } = {}) {
    const rows = await this.request("/rest/v1/rpc/cleanup_keepgoing_durable_state", {
      method: "POST",
      body: JSON.stringify({
        p_job_retention_days: Math.max(1, Math.trunc(Number(jobRetentionDays) || 30)),
        p_event_retention_days: Math.max(1, Math.trunc(Number(eventRetentionDays) || 14))
      })
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      deleted_jobs: Number(row?.deleted_jobs || 0),
      deleted_events: Number(row?.deleted_events || 0)
    };
  }

  async compareAndSet(jobId, expectedVersion, next) {
    const q = new URLSearchParams({
      job_id: "eq." + jobId,
      version: "eq." + String(expectedVersion)
    });
    // Defence in depth against resurrecting a finished job: unless the write
    // keeps the job in an absorbing state, the row must not currently be
    // completed/cancelled/budget_exhausted, and may only leave FAILED when no
    // provider session was ever attached (a retryable start failure).
    if (!["completed", "cancelled", "budget_exhausted"].includes(String(next?.status || ""))) {
      q.set("status", "not.in.(completed,cancelled,budget_exhausted)");
      if (String(next?.status || "") !== "failed") {
        q.set("or", "(status.neq.failed,provider_session_id.is.null)");
      }
    }
    const rows = await this.request("/rest/v1/keepgoing_jobs?" + q.toString(), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toPatchRow(next, expectedVersion + 1))
    });
    if (Array.isArray(rows) && rows[0]) {
      return { ok: true, job: fromRow(rows[0]) };
    }
    const current = await this.get(jobId);
    return {
      ok: false,
      reason: !current
        ? "not_found"
        : Number(current.version) === Number(expectedVersion) ? "illegal_transition" : "version_conflict",
      job: current
    };
  }

  async recordEvent({ jobId = null, providerEventId = null, eventType, safeDetail = {} }) {
    if (!eventType) throw new Error("event type required");
    try {
      const rows = await this.request("/rest/v1/keepgoing_job_events", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify({
          job_id: jobId,
          provider_event_id: providerEventId,
          event_type: eventType,
          safe_detail: safeDetail
        })
      });
      return { inserted: Array.isArray(rows) && rows.length > 0 };
    } catch (error) {
      if (error.status === 409 && providerEventId) return { inserted: false };
      throw error;
    }
  }

  async request(path, init = {}) {
    let response;
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      response = await this._send(path, init, signal);
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        const timeout = new Error("KeepGoing durable store request timed out");
        timeout.code = "store_timeout";
        timeout.status = 504;
        throw timeout;
      }
      const network = new Error("KeepGoing durable store is unreachable");
      network.code = "store_unreachable";
      throw network;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || ("Supabase request failed (" + response.status + ")"));
      error.status = response.status;
      error.code = "store_error";
      throw error;
    }
    return data;
  }

  async _send(path, init, signal) {
    let response;
    if (this.proxyUrl && this.proxyToken) {
      const prefer = init.headers?.Prefer || init.headers?.prefer || null;
      response = await this.fetchImpl(this.proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-keepgoing-ingest-token": this.proxyToken
        },
        body: JSON.stringify({
          path,
          method: String(init.method || "GET").toUpperCase(),
          headers: prefer ? { Prefer: String(prefer) } : {},
          body: init.body == null ? null : String(init.body)
        }),
        signal
      });
    } else {
      response = await this.fetchImpl(this.base + path, {
        ...init,
        headers: {
          apikey: this.serviceKey,
          Authorization: "Bearer " + this.serviceKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers || {})
        },
        signal
      });
    }
    return response;
  }
}

function toPatchRow(job, version) {
  return compact({
    engine: job.engine,
    tool_profile: job.toolProfileName,
    tool_policy_hash: job.toolPolicyHash,
    tool_write_capable: job.toolWriteCapable,
    provider_session_id: job.providerSessionId,
    status: job.status,
    version,
    attempt: job.attempt,
    max_attempts: job.maxAttempts,
    tokens_used: job.tokensUsed,
    token_budget_total: job.tokenBudgetTotal,
    tool_calls_used: job.toolCallsUsed,
    tool_call_budget_total: job.toolCallBudgetTotal,
    goal_hash: job.goalHash,
    definition_hash: job.definitionHash,
    completion_marker: job.completionMarker,
    continuation_needed: job.continuationNeeded,
    continuation_claim_id: job.continuationClaimId,
    continuation_idempotency_key: job.continuationIdempotencyKey,
    last_assessed_turn_id: job.lastAssessedTurnId,
    start_lease_until: nullableIso(job.startLeaseUntil),
    continuation_lease_until: nullableIso(job.continuationLeaseUntil),
    repeated_output_count: job.repeatedOutputCount,
    last_output_hash: job.lastOutputHash,
    safe_error_code: job.safeErrorCode,
    safe_error_message: job.safeErrorMessage,
    updated_at: toIso(job.updatedAt),
    last_progress_at: toIso(job.lastProgressAt),
    wall_deadline_at: toIso(job.wallDeadlineAt)
  });
}

function fromRow(row) {
  return {
    id: row.job_id,
    ownerSubjectHash: row.owner_subject_hash,
    engine: row.engine,
    toolProfileName: row.tool_profile || "web",
    toolPolicyHash: row.tool_policy_hash || null,
    toolWriteCapable: Boolean(row.tool_write_capable),
    providerSessionId: row.provider_session_id,
    status: row.status,
    version: Number(row.version),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    tokensUsed: Number(row.tokens_used),
    tokenBudgetTotal: Number(row.token_budget_total),
    toolCallsUsed: Number(row.tool_calls_used),
    toolCallBudgetTotal: Number(row.tool_call_budget_total),
    goalHash: row.goal_hash,
    definitionHash: row.definition_hash,
    completionMarker: row.completion_marker,
    continuationNeeded: Boolean(row.continuation_needed),
    continuationClaimId: row.continuation_claim_id,
    continuationIdempotencyKey: row.continuation_idempotency_key,
    lastAssessedTurnId: row.last_assessed_turn_id,
    startLeaseUntil: fromIso(row.start_lease_until),
    continuationLeaseUntil: fromIso(row.continuation_lease_until),
    repeatedOutputCount: Number(row.repeated_output_count),
    lastOutputHash: row.last_output_hash,
    safeErrorCode: row.safe_error_code,
    safeErrorMessage: row.safe_error_message,
    startedAt: fromIso(row.started_at),
    updatedAt: fromIso(row.updated_at),
    lastProgressAt: fromIso(row.last_progress_at),
    wallDeadlineAt: fromIso(row.wall_deadline_at),
    currentRunId: row.provider_session_id
  };
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function toIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("timestamp required");
  return new Date(n).toISOString();
}

function nullableIso(value) {
  if (value == null) return null;
  return toIso(value);
}

function fromIso(value) {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
