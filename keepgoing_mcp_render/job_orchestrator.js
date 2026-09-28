import crypto from "node:crypto";
import {
  JOB_STATES,
  assessRun,
  continuationPrompt,
  isTerminal,
  newJobRecord
} from "./durable_job.js";
import { latestSessionText, classifySession } from "./agents_engine.js";

export class KeepGoingOrchestrator {
  constructor({ engine, store, now = () => Date.now() } = {}) {
    if (!engine) throw new Error("engine required");
    if (!store) throw new Error("store required");
    this.engine = engine;
    this.store = store;
    this.now = now;
  }

  async start({
    initialPrompt,
    instructions,
    allowWeb = true,
    reasoningEffort = "medium",
    ownerSubjectHash,
    clientRequestId = null,
    limits = {}
  }) {
    if (!String(initialPrompt || "").trim()) throw new Error("initial prompt required");

    const now = this.now();
    const jobId = "kgj_" + crypto.randomUUID().replace(/-/g, "");
    const job = newJobRecord({
      id: jobId,
      goalHash: sha256(initialPrompt),
      definitionHash: sha256(instructions || ""),
      ownerSubjectHash,
      engine: "agents",
      now,
      limits
    });
    job.status = JOB_STATES.QUEUED;
    job.providerSessionId = null;
    job.startLeaseUntil = now + 60_000;

    // Reserve the idempotency key before the external model call. This is what
    // prevents simultaneous retries from creating duplicate paid sessions.
    const reserved = await this.store.createOrGet({
      job,
      ownerSubjectHash,
      clientRequestId
    });
    if (!reserved.created) {
      return { created: false, job: reserved.job };
    }

    let session;
    try {
      session = await this.engine.createSession({
        prompt: initialPrompt,
        instructions,
        allowWeb,
        reasoningEffort,
        metadata: {
          keepgoing: "v1.2",
          keepgoing_job_id: jobId,
          request_hash: clientRequestId ? sha256(clientRequestId).slice(0, 24) : undefined
        }
      });
    } catch (error) {
      const failed = {
        ...reserved.job,
        status: JOB_STATES.FAILED,
        startLeaseUntil: null,
        safeErrorCode: "start_failed",
        safeErrorMessage: "KeepGoing could not start the model session.",
        updatedAt: this.now()
      };
      await this.store.compareAndSet(jobId, reserved.job.version, failed);
      throw error;
    }

    if (!session?.id) {
      const failed = {
        ...reserved.job,
        status: JOB_STATES.FAILED,
        startLeaseUntil: null,
        safeErrorCode: "missing_provider_session",
        safeErrorMessage: "The model provider did not return a session id.",
        updatedAt: this.now()
      };
      await this.store.compareAndSet(jobId, reserved.job.version, failed);
      throw new Error("Agents API did not return a session id");
    }

    const working = {
      ...reserved.job,
      status: JOB_STATES.WORKING,
      providerSessionId: session.id,
      currentRunId: session.id,
      startLeaseUntil: null,
      updatedAt: this.now(),
      lastProgressAt: this.now()
    };
    const saved = await this.store.compareAndSet(jobId, reserved.job.version, working);
    if (!saved.ok) {
      try { await this.engine.cancelTurn(session.id); } catch {}
      return { created: false, job: saved.job || reserved.job };
    }
    return { created: true, job: saved.job };
  }

  async get(jobId) {
    return this.store.get(jobId);
  }

  async reconcile(jobId) {
    const current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return { job: current, action: "terminal" };
    if (!current.providerSessionId) return { job: current, action: "queued" };

    const providerId = current.providerSessionId;
    const session = await this.engine.getSession(providerId);
    const items = await this.engine.listItems(providerId, { order: "asc", limit: 100 });
    const output = latestSessionText(items);
    const provider = classifySession(session, output);

    if (provider.providerStatus === "working") {
      const refreshed = { ...current, updatedAt: this.now(), lastProgressAt: this.now() };
      const saved = await this.store.compareAndSet(jobId, current.version, refreshed);
      return saved.ok
        ? { job: saved.job, action: "working" }
        : { job: saved.job || current, action: "already_updated" };
    }

    if (provider.providerStatus === "action_required") {
      const blocked = {
        ...current,
        status: JOB_STATES.INPUT_REQUIRED,
        continuationNeeded: false,
        safeErrorCode: "provider_action_required",
        safeErrorMessage: "The agent requires external input or a tool result before it can continue.",
        updatedAt: this.now()
      };
      const saved = await this.store.compareAndSet(jobId, current.version, blocked);
      return saved.ok
        ? { job: saved.job, action: "needs_user" }
        : { job: saved.job || current, action: "already_updated" };
    }

    const assessed = assessRun(current, {
      providerStatus: provider.providerStatus,
      output: provider.output,
      now: this.now(),
      runId: providerId
    });

    if (!assessed.continuationNeeded) {
      const saved = await this.store.compareAndSet(jobId, current.version, assessed);
      return saved.ok
        ? { job: saved.job, action: assessed.status }
        : { job: saved.job || current, action: "already_updated" };
    }

    const claim = {
      ...assessed,
      status: JOB_STATES.CONTINUING,
      continuationNeeded: false,
      continuationLeaseUntil: this.now() + 60_000,
      continuationClaimId: crypto.randomUUID()
    };
    const claimed = await this.store.compareAndSet(jobId, current.version, claim);
    if (!claimed.ok) {
      return { job: claimed.job, action: "already_claimed" };
    }

    try {
      await this.engine.sendMessage(
        providerId,
        continuationPrompt(provider.output, claimed.job.attempt, claimed.job.maxAttempts)
      );
      const working = {
        ...claimed.job,
        status: JOB_STATES.WORKING,
        continuationNeeded: false,
        continuationLeaseUntil: null,
        updatedAt: this.now()
      };
      const saved = await this.store.compareAndSet(jobId, claimed.job.version, working);
      return saved.ok
        ? { job: saved.job, action: "continued" }
        : { job: saved.job || claimed.job, action: "already_updated" };
    } catch (error) {
      const failed = {
        ...claimed.job,
        status: JOB_STATES.FAILED,
        continuationLeaseUntil: null,
        safeErrorCode: "continuation_send_failed",
        safeErrorMessage: "KeepGoing could not start the next continuation turn.",
        updatedAt: this.now()
      };
      await this.store.compareAndSet(jobId, claimed.job.version, failed);
      throw error;
    }
  }

  async cancel(jobId) {
    const current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return current;
    if (current.providerSessionId) {
      await this.engine.cancelTurn(current.providerSessionId);
    }
    const next = {
      ...current,
      status: JOB_STATES.CANCELLED,
      continuationNeeded: false,
      startLeaseUntil: null,
      continuationLeaseUntil: null,
      updatedAt: this.now()
    };
    const saved = await this.store.compareAndSet(jobId, current.version, next);
    return saved.job || current;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
