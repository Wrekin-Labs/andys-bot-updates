import crypto from "node:crypto";
import {
  JOB_STATES,
  assessRun,
  continuationPrompt,
  isTerminal,
  newJobRecord
} from "./durable_job.js";
import { latestSessionText, classifySession } from "./agents_engine.js";

const CONTINUATION_LEASE_MS = 60_000;

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
    limits = {},
    beforeCreateSession = null
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
    job.startLeaseUntil = now + CONTINUATION_LEASE_MS;

    const reserved = await this.store.createOrGet({
      job,
      ownerSubjectHash,
      clientRequestId
    });
    if (!reserved.created) {
      return { created: false, job: reserved.job };
    }

    if (beforeCreateSession) {
      try {
        await beforeCreateSession({ job: reserved.job });
      } catch (error) {
        const failed = {
          ...reserved.job,
          status: JOB_STATES.FAILED,
          startLeaseUntil: null,
          safeErrorCode: "pre_session_gate_failed",
          safeErrorMessage: "KeepGoing could not reserve the required job allowance.",
          updatedAt: this.now()
        };
        await this.store.compareAndSet(jobId, reserved.job.version, failed);
        throw error;
      }
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
      try { await this.engine.cancelTurn(session.id, "kg-cancel-start-" + jobId); } catch {}
      return { created: false, job: saved.job || reserved.job };
    }
    return { created: true, job: saved.job };
  }

  async get(jobId) {
    return this.store.get(jobId);
  }

  async reconcile(jobId) {
    let current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return { job: current, action: "terminal" };
    if (!current.providerSessionId) return { job: current, action: "queued" };

    const providerId = current.providerSessionId;
    const session = await this.engine.getSession(providerId);
    const [items, turns] = await Promise.all([
      this.engine.listItems(providerId, { order: "asc", limit: 100 }),
      this.engine.listTurns(providerId, { order: "desc", limit: 10 })
    ]);
    const output = latestSessionText(items);
    const provider = classifySession(session, output, turns, items);
    const now = this.now();

    if (provider.providerStatus === "working") {
      const refreshed = {
        ...current,
        status: JOB_STATES.WORKING,
        currentRunId: provider.turnId || current.currentRunId,
        continuationLeaseUntil: null,
        updatedAt: now,
        lastProgressAt: now
      };
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
        updatedAt: now
      };
      const saved = await this.store.compareAndSet(jobId, current.version, blocked);
      return saved.ok
        ? { job: saved.job, action: "needs_user" }
        : { job: saved.job || current, action: "already_updated" };
    }

    const terminalTurnId = provider.turnId || null;

    // The same completed turn may be observed repeatedly through polling or
    // duplicate webhooks. Never assess/count it twice.
    if (terminalTurnId && current.lastAssessedTurnId === terminalTurnId) {
      if (current.status === JOB_STATES.CONTINUING) {
        if (now >= current.wallDeadlineAt) {
          const exhausted = {
            ...current,
            status: JOB_STATES.BUDGET_EXHAUSTED,
            continuationNeeded: false,
            continuationLeaseUntil: null,
            safeErrorCode: "budget_exhausted",
            safeErrorMessage: "KeepGoing reached its configured continuation deadline.",
            updatedAt: now
          };
          const saved = await this.store.compareAndSet(jobId, current.version, exhausted);
          return saved.ok
            ? { job: saved.job, action: JOB_STATES.BUDGET_EXHAUSTED }
            : { job: saved.job || current, action: "already_updated" };
        }

        if (Number(current.continuationLeaseUntil || 0) > now) {
          return { job: current, action: "continuation_pending" };
        }

        const key = current.continuationIdempotencyKey || continuationKey(jobId, terminalTurnId);
        const retryClaim = {
          ...current,
          continuationLeaseUntil: now + CONTINUATION_LEASE_MS,
          continuationIdempotencyKey: key,
          updatedAt: now
        };
        const claimed = await this.store.compareAndSet(jobId, current.version, retryClaim);
        if (!claimed.ok) {
          return { job: claimed.job || current, action: "already_claimed" };
        }
        return this._sendClaimedContinuation(claimed.job, provider.output);
      }

      return { job: current, action: "already_assessed" };
    }

    const assessed = assessRun(current, {
      providerStatus: provider.providerStatus,
      output: provider.output,
      tokensUsed: provider.tokensUsed || 0,
      now,
      runId: terminalTurnId || providerId
    });
    assessed.lastAssessedTurnId = terminalTurnId || assessed.lastAssessedTurnId;

    if (!assessed.continuationNeeded) {
      const saved = await this.store.compareAndSet(jobId, current.version, assessed);
      return saved.ok
        ? { job: saved.job, action: assessed.status }
        : { job: saved.job || current, action: "already_updated" };
    }

    const idempotencyKey = continuationKey(
      jobId,
      terminalTurnId || ("attempt-" + assessed.attempt)
    );
    const claim = {
      ...assessed,
      status: JOB_STATES.CONTINUING,
      continuationNeeded: false,
      continuationLeaseUntil: now + CONTINUATION_LEASE_MS,
      continuationClaimId: crypto.randomUUID(),
      continuationIdempotencyKey: idempotencyKey
    };
    const claimed = await this.store.compareAndSet(jobId, current.version, claim);
    if (!claimed.ok) {
      return { job: claimed.job || current, action: "already_claimed" };
    }

    return this._sendClaimedContinuation(claimed.job, provider.output);
  }

  async _sendClaimedContinuation(claimedJob, previousOutput) {
    const providerId = claimedJob.providerSessionId;
    const key = claimedJob.continuationIdempotencyKey;
    try {
      await this.engine.sendMessage(
        providerId,
        continuationPrompt(previousOutput, claimedJob.attempt, claimedJob.maxAttempts),
        key
      );

      const working = {
        ...claimedJob,
        status: JOB_STATES.WORKING,
        continuationNeeded: false,
        continuationLeaseUntil: null,
        safeErrorCode: null,
        safeErrorMessage: null,
        updatedAt: this.now()
      };
      const saved = await this.store.compareAndSet(
        claimedJob.id,
        claimedJob.version,
        working
      );
      return saved.ok
        ? { job: saved.job, action: "continued" }
        : { job: saved.job || claimedJob, action: "already_updated" };
    } catch (error) {
      // The request outcome may be unknown. Keep the claim durable and retry
      // the same idempotency key later instead of risking a duplicate turn.
      const retryable = {
        ...claimedJob,
        status: JOB_STATES.CONTINUING,
        continuationNeeded: false,
        continuationLeaseUntil: null,
        safeErrorCode: "continuation_send_unknown",
        safeErrorMessage: "Continuation delivery was not confirmed; KeepGoing can safely retry it.",
        updatedAt: this.now()
      };
      await this.store.compareAndSet(claimedJob.id, claimedJob.version, retryable);
      throw error;
    }
  }

  async cancel(jobId) {
    const current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return current;
    if (current.providerSessionId) {
      await this.engine.cancelTurn(
        current.providerSessionId,
        "kg-cancel-" + jobId
      );
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

function continuationKey(jobId, turnId) {
  return ("kg-cont-" + jobId + "-" + String(turnId || "unknown")).slice(0, 256);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
