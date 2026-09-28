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

    if (clientRequestId && typeof this.store.findByRequest === "function") {
      const existing = await this.store.findByRequest(ownerSubjectHash, clientRequestId);
      if (existing) return { created: false, job: existing };
    }

    const session = await this.engine.createSession({
      prompt: initialPrompt,
      instructions,
      allowWeb,
      reasoningEffort,
      metadata: {
        keepgoing: "v1.2",
        request_hash: clientRequestId ? sha256(clientRequestId).slice(0, 24) : undefined
      }
    });

    if (!session?.id) throw new Error("Agents API did not return a session id");
    const job = newJobRecord({
      id: session.id,
      goalHash: sha256(initialPrompt),
      definitionHash: sha256(instructions || ""),
      ownerSubjectHash,
      engine: "agents",
      now: this.now(),
      limits
    });
    job.status = JOB_STATES.WORKING;
    job.currentRunId = session.id;

    return this.store.createOrGet({
      job,
      ownerSubjectHash,
      clientRequestId
    });
  }

  async get(jobId) {
    return this.store.get(jobId);
  }

  async reconcile(jobId) {
    const current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return { job: current, action: "terminal" };

    const session = await this.engine.getSession(jobId);
    const items = await this.engine.listItems(jobId, { order: "asc", limit: 100 });
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
      runId: jobId
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
        jobId,
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
    await this.engine.cancelTurn(jobId);
    const next = {
      ...current,
      status: JOB_STATES.CANCELLED,
      continuationNeeded: false,
      updatedAt: this.now()
    };
    const saved = await this.store.compareAndSet(jobId, current.version, next);
    return saved.job || current;
  }
}

export function requestKey(ownerSubjectHash, clientRequestId) {
  return String(ownerSubjectHash || "") + ":" + String(clientRequestId || "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
