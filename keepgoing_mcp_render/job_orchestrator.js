import crypto from "node:crypto";
import {
  JOB_STATES,
  assessRun,
  continuationPrompt,
  isTerminal,
  newJobRecord
} from "./durable_job.js";
import { latestRootTurn, latestSessionText, classifySession } from "./agents_engine.js";

const CONTINUATION_LEASE_MS = 60_000;
// After the wall deadline, a job whose provider state still cannot be read is
// given this much extra time before it is dead-lettered as recovery_failed.
const RECOVERY_GRACE_MS = 15 * 60_000;
const CAS_RETRIES = 5;

export class KeepGoingOrchestrator {
  constructor({
    engine,
    store,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    if (!engine) throw new Error("engine required");
    if (!store) throw new Error("store required");
    this.engine = engine;
    this.store = store;
    this.now = now;
    this.sleep = sleep;
  }

  async start({
    initialPrompt,
    instructions,
    allowWeb = true,
    reasoningEffort = "medium",
    ownerSubjectHash,
    clientRequestId = null,
    limits = {},
    workspace = null,
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
      const retried = await this._retryDuplicateStart({
        existing: reserved.job,
        templateJob: job,
        initialPrompt,
        instructions,
        allowWeb,
        reasoningEffort,
        clientRequestId,
        workspace
      });
      return { created: false, job: retried };
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
      session = await this._createSessionWithRecovery({
        jobId,
        initialPrompt,
        instructions,
        allowWeb,
        reasoningEffort,
        clientRequestId,
        workspace
      });
    } catch (error) {
      const definitelyRejected = isDefinitiveRejection(error);
      const next = definitelyRejected
        ? {
            ...reserved.job,
            status: JOB_STATES.FAILED,
            startLeaseUntil: null,
            safeErrorCode: "start_rejected",
            safeErrorMessage: "The model provider rejected the session start.",
            updatedAt: this.now()
          }
        : {
            ...reserved.job,
            status: JOB_STATES.QUEUED,
            startLeaseUntil: this.now() + CONTINUATION_LEASE_MS,
            safeErrorCode: "start_outcome_unknown",
            safeErrorMessage: "Session start acknowledgement was lost; KeepGoing will recover by durable job metadata.",
            updatedAt: this.now()
          };
      await this.store.compareAndSet(jobId, reserved.job.version, next);
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

  async _createSessionWithRecovery({
    jobId,
    initialPrompt,
    instructions,
    allowWeb,
    reasoningEffort,
    clientRequestId,
    workspace = null
  }) {
    const metadata = {
      keepgoing: "v1.2",
      keepgoing_job_id: jobId,
      request_hash: clientRequestId ? sha256(clientRequestId).slice(0, 24) : undefined
    };
    const idempotencyKey = startKey(jobId);
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.engine.createSession({
          prompt: initialPrompt,
          instructions,
          allowWeb,
          reasoningEffort,
          metadata,
          idempotencyKey,
          workspace
        });
      } catch (error) {
        lastError = error;
        if (isDefinitiveRejection(error)) throw error;

        if (typeof this.engine.findSessionByMetadata === "function") {
          try {
            const recovered = await this.engine.findSessionByMetadata(
              "keepgoing_job_id",
              jobId,
              { maxPages: 5, pageSize: 100 }
            );
            if (recovered?.id) return recovered;
          } catch {}
        }

        if (attempt < 2) {
          await this.sleep(750 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error("KeepGoing could not create the provider session");
  }

  async _retryDuplicateStart({
    existing,
    templateJob,
    initialPrompt,
    instructions,
    allowWeb,
    reasoningEffort,
    clientRequestId,
    workspace = null
  }) {
    let current = existing;
    if (!current || current.providerSessionId || Number(current.attempt || 0) > 0) {
      return current;
    }

    const retryableFailed = current.status === JOB_STATES.FAILED &&
      new Set(["start_not_recovered", "missing_provider_session"]).has(String(current.safeErrorCode || ""));
    const retryableQueued = current.status === JOB_STATES.QUEUED;
    if (!retryableQueued && !retryableFailed) return current;

    if (typeof this.engine.findSessionByMetadata === "function") {
      try {
        const recovered = await this.engine.findSessionByMetadata(
          "keepgoing_job_id",
          current.id,
          { maxPages: 5, pageSize: 100 }
        );
        if (recovered?.id) {
          return await this._attachRecoveredSession(current, recovered.id);
        }
      } catch {}
    }

    const now = this.now();
    if (
      current.status === JOB_STATES.QUEUED &&
      Number(current.startLeaseUntil || 0) > now
    ) {
      return current;
    }

    const retryClaim = {
      ...current,
      status: JOB_STATES.QUEUED,
      startLeaseUntil: now + CONTINUATION_LEASE_MS,
      safeErrorCode: "start_retrying",
      safeErrorMessage: null,
      wallDeadlineAt: templateJob.wallDeadlineAt,
      updatedAt: now,
      lastProgressAt: now
    };
    const claimed = await this.store.compareAndSet(current.id, current.version, retryClaim);
    if (!claimed.ok) return claimed.job || current;
    current = claimed.job;

    let session;
    try {
      session = await this._createSessionWithRecovery({
        jobId: current.id,
        initialPrompt,
        instructions,
        allowWeb,
        reasoningEffort,
        clientRequestId,
        workspace
      });
    } catch (error) {
      const definitelyRejected = isDefinitiveRejection(error);
      const next = definitelyRejected
        ? {
            ...current,
            status: JOB_STATES.FAILED,
            startLeaseUntil: null,
            safeErrorCode: "start_rejected",
            safeErrorMessage: "The model provider rejected the session start.",
            updatedAt: this.now()
          }
        : {
            ...current,
            status: JOB_STATES.QUEUED,
            startLeaseUntil: this.now() + CONTINUATION_LEASE_MS,
            safeErrorCode: "start_outcome_unknown",
            safeErrorMessage: "Session start acknowledgement was lost; KeepGoing will recover by durable job metadata.",
            updatedAt: this.now()
          };
      await this.store.compareAndSet(current.id, current.version, next);
      throw error;
    }

    if (!session?.id) {
      const failed = {
        ...current,
        status: JOB_STATES.FAILED,
        startLeaseUntil: null,
        safeErrorCode: "missing_provider_session",
        safeErrorMessage: "The model provider did not return a session id.",
        updatedAt: this.now()
      };
      const saved = await this.store.compareAndSet(current.id, current.version, failed);
      return saved.job || failed;
    }

    return this._attachRecoveredSession(current, session.id);
  }

  async _attachRecoveredSession(current, sessionId) {
    const working = {
      ...current,
      status: JOB_STATES.WORKING,
      providerSessionId: sessionId,
      currentRunId: sessionId,
      startLeaseUntil: null,
      safeErrorCode: null,
      safeErrorMessage: null,
      updatedAt: this.now(),
      lastProgressAt: this.now()
    };
    const saved = await this.store.compareAndSet(current.id, current.version, working);
    return saved.job || working;
  }

  async get(jobId) {
    return this.store.get(jobId);
  }

  async recoverStart(jobId) {
    const current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (current.providerSessionId) return { job: current, action: "already_attached" };
    if (current.status !== JOB_STATES.QUEUED) return { job: current, action: "not_queued" };
    if (typeof this.engine.findSessionByMetadata !== "function") {
      return { job: current, action: "recovery_unavailable" };
    }

    const session = await this.engine.findSessionByMetadata(
      "keepgoing_job_id",
      jobId,
      { maxPages: 3, pageSize: 100 }
    );

    if (session?.id) {
      const working = {
        ...current,
        status: JOB_STATES.WORKING,
        providerSessionId: session.id,
        currentRunId: session.id,
        startLeaseUntil: null,
        safeErrorCode: null,
        safeErrorMessage: null,
        updatedAt: this.now(),
        lastProgressAt: this.now()
      };
      const saved = await this.store.compareAndSet(jobId, current.version, working);
      return saved.ok
        ? { job: saved.job, action: "start_recovered" }
        : { job: saved.job || current, action: "already_updated" };
    }

    if (Number(current.startLeaseUntil || 0) > this.now()) {
      return { job: current, action: "start_pending" };
    }

    const failed = {
      ...current,
      status: JOB_STATES.FAILED,
      startLeaseUntil: null,
      safeErrorCode: "start_not_recovered",
      safeErrorMessage: "KeepGoing could not find a provider session for the reserved durable job.",
      updatedAt: this.now()
    };
    const saved = await this.store.compareAndSet(jobId, current.version, failed);
    return saved.ok
      ? { job: saved.job, action: "start_not_recovered" }
      : { job: saved.job || current, action: "already_updated" };
  }

  async reconcile(jobId) {
    let current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    if (isTerminal(current.status)) return { job: current, action: "terminal" };
    if (!current.providerSessionId) return { job: current, action: "queued" };

    const providerId = current.providerSessionId;
    const [session, turns] = await Promise.all([
      this.engine.getSession(providerId),
      this.engine.listTurns(providerId, { order: "desc", limit: 10 })
    ]);
    const latestTurn = latestRootTurn(turns);
    const itemRead =
      latestTurn?.id && typeof this.engine.listTurnItems === "function"
        ? this.engine.listTurnItems(providerId, latestTurn.id, { pageSize: 100, maxPages: 10 })
        : this.engine.listAllItems
          ? this.engine.listAllItems(providerId, { order: "desc", pageSize: 100, maxPages: 5 })
          : this.engine.listItems(providerId, { order: "desc", limit: 100 });
    const items = await itemRead;
    const output = latestSessionText(items);
    const provider = classifySession(session, output, turns, items);
    const now = this.now();

    if (provider.providerStatus === "working") {
      const tokenBudgetReached =
        Number(provider.tokensUsed || 0) > 0 &&
        current.tokensUsed + Number(provider.tokensUsed || 0) >= current.tokenBudgetTotal;
      const toolBudgetReached =
        current.toolCallBudgetTotal > 0 &&
        current.toolCallsUsed + Number(provider.toolCallsUsed || 0) >= current.toolCallBudgetTotal;
      const deadlineReached = now >= current.wallDeadlineAt;

      if (deadlineReached || tokenBudgetReached || toolBudgetReached) {
        try {
          await this.engine.cancelTurn(providerId, "kg-budget-" + jobId);
        } catch {}
        const exhausted = {
          ...current,
          status: JOB_STATES.BUDGET_EXHAUSTED,
          tokensUsed: current.tokensUsed + Number(provider.tokensUsed || 0),
          toolCallsUsed: current.toolCallsUsed + Number(provider.toolCallsUsed || 0),
          continuationNeeded: false,
          continuationLeaseUntil: null,
          safeErrorCode: "budget_exhausted",
          safeErrorMessage: "KeepGoing stopped the active turn at its configured safety/cost budget.",
          updatedAt: now
        };
        const saved = await this.store.compareAndSet(jobId, current.version, exhausted);
        return saved.ok
          ? { job: saved.job, action: JOB_STATES.BUDGET_EXHAUSTED }
          : { job: saved.job || current, action: "already_updated" };
      }

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
      toolCallsUsed: provider.toolCallsUsed || 0,
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
      if (!saved.ok) {
        // The job changed while the continuation was in flight. If it was
        // cancelled meanwhile, the turn we just started is an orphan that
        // would keep spending tokens: stop it.
        await this._stopOrphanTurnIfCancelled(saved.job, providerId, key);
        return { job: saved.job || claimedJob, action: "already_updated" };
      }
      return { job: saved.job, action: "continued" };
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
    // Retry the CAS: the watchdog or a webhook may legitimately bump the
    // version between our read and write. A single attempt used to report
    // success while silently leaving the job running (and resumable).
    let current = await this.store.get(jobId);
    if (!current) throw new Error("job not found");
    let providerCancelled = false;

    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      if (!current) throw new Error("job not found");
      if (current.status === JOB_STATES.CANCELLED) return current;
      // input_required is resting, not finished: a user may cancel it.
      if (isTerminal(current.status) && current.status !== JOB_STATES.INPUT_REQUIRED) return current;

      if (current.providerSessionId && !providerCancelled) {
        try {
          await this.engine.cancelTurn(current.providerSessionId, "kg-cancel-" + jobId);
          providerCancelled = true;
        } catch (error) {
          // A session with no running turn may reject cancel; that is fine.
          // Anything else is surfaced so the caller can retry safely.
          if (!isDefinitiveRejection(error)) throw error;
          providerCancelled = true;
        }
      }

      const next = {
        ...current,
        status: JOB_STATES.CANCELLED,
        continuationNeeded: false,
        startLeaseUntil: null,
        continuationLeaseUntil: null,
        continuationIdempotencyKey: null,
        safeErrorCode: "cancelled_by_user",
        safeErrorMessage: null,
        updatedAt: this.now()
      };
      const saved = await this.store.compareAndSet(jobId, current.version, next);
      if (saved.ok) return saved.job;
      current = saved.job;
    }
    const error = new Error("KeepGoing could not confirm cancellation because the job kept changing. Retry cancel.");
    error.code = "cancel_conflict";
    error.userFacing = true;
    throw error;
  }

  /**
   * Called by the watchdog when reconcile/recoverStart throws. Pushes the job
   * to the back of the recovery queue (so a few permanently failing jobs cannot
   * starve everyone else) and dead-letters it once it is well past its wall
   * deadline, instead of retrying forever.
   */
  async recordRecoveryFailure(jobId, error) {
    const current = await this.store.get(jobId);
    if (!current || isTerminal(current.status)) return { job: current, action: "terminal" };
    const now = this.now();
    const code = String(error?.code || "recovery_error").slice(0, 64);
    const deadLetter = now >= Number(current.wallDeadlineAt || 0) + RECOVERY_GRACE_MS;
    const next = deadLetter
      ? {
          ...current,
          status: JOB_STATES.FAILED,
          continuationNeeded: false,
          startLeaseUntil: null,
          continuationLeaseUntil: null,
          safeErrorCode: "recovery_failed",
          safeErrorMessage: "KeepGoing could not recover this job from its provider before the deadline (" + code + ").",
          updatedAt: now
        }
      : {
          ...current,
          safeErrorCode: "recovery_retrying",
          safeErrorMessage: "KeepGoing is retrying recovery after a transient error (" + code + ").",
          updatedAt: now
        };
    const saved = await this.store.compareAndSet(jobId, current.version, next);
    if (saved.ok && deadLetter && current.providerSessionId) {
      try { await this.engine.cancelTurn(current.providerSessionId, "kg-deadletter-" + jobId); } catch {}
    }
    return {
      job: saved.job || current,
      action: saved.ok ? (deadLetter ? "dead_lettered" : "recovery_deferred") : "already_updated"
    };
  }

  async _stopOrphanTurnIfCancelled(job, providerId, key) {
    let latest = job;
    if (!latest) {
      try { latest = await this.store.get(job?.id); } catch { latest = null; }
    }
    if (latest?.status === JOB_STATES.CANCELLED && providerId) {
      try { await this.engine.cancelTurn(providerId, ("kg-cancel-orphan-" + key).slice(0, 256)); } catch {}
    }
  }
}

// 4xx responses are definitive EXCEPT the transient ones: request timeout,
// idempotency-key conflict (same request still in flight), too early, and rate
// limiting. Treating 429 as definitive used to fail a job permanently at start
// and, on cancel, to mark a job cancelled while its provider turn kept running.
const TRANSIENT_4XX = new Set([408, 409, 425, 429]);

export function isDefinitiveRejection(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 && !TRANSIENT_4XX.has(status);
}

function startKey(jobId) {
  return ("kg-start-" + String(jobId || "unknown")).slice(0, 256);
}

function continuationKey(jobId, turnId) {
  return ("kg-cont-" + jobId + "-" + String(turnId || "unknown")).slice(0, 256);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
