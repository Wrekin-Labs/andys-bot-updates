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
    mcpTools = [],
    toolProfileName = "web",
    toolPolicyHash = "",
    toolWriteCapable = false,
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
      toolProfileName,
      toolPolicyHash,
      toolWriteCapable,
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
        mcpTools,
        toolProfileName,
        toolPolicyHash,
        toolWriteCapable,
        reasoningEffort,
        clientRequestId
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
        mcpTools,
        toolProfileName,
        toolPolicyHash,
        toolWriteCapable,
        reasoningEffort,
        clientRequestId
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const definitelyRejected = status >= 400 && status < 500;
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
    mcpTools = [],
    toolProfileName = "web",
    toolPolicyHash = "",
    toolWriteCapable = false,
    reasoningEffort,
    clientRequestId
  }) {
    const metadata = {
      keepgoing: "v1.2",
      keepgoing_job_id: jobId,
      request_hash: clientRequestId ? sha256(clientRequestId).slice(0, 24) : undefined,
      tool_profile: String(toolProfileName || "web").slice(0, 64),
      tool_policy_hash: String(toolPolicyHash || "").slice(0, 64) || undefined,
      write_tools: Boolean(toolWriteCapable) ? "true" : "false"
    };
    const idempotencyKey = startKey(jobId);
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.engine.createSession({
          prompt: initialPrompt,
          instructions,
          allowWeb,
          mcpTools,
          reasoningEffort,
          metadata,
          idempotencyKey
        });
      } catch (error) {
        lastError = error;
        const status = Number(error?.status || 0);
        if (status >= 400 && status < 500) throw error;

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
    mcpTools = [],
    toolProfileName = "web",
    toolPolicyHash = "",
    toolWriteCapable = false,
    reasoningEffort,
    clientRequestId
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
        mcpTools,
        toolProfileName,
        toolPolicyHash,
        toolWriteCapable,
        reasoningEffort,
        clientRequestId
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const definitelyRejected = status >= 400 && status < 500;
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
    await this._recordToolAudit(jobId, items);
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

  async _recordToolAudit(jobId, itemsResponse) {
    if (typeof this.store.recordEvent !== "function") return;

    const items = Array.isArray(itemsResponse)
      ? itemsResponse
      : Array.isArray(itemsResponse?.data)
        ? itemsResponse.data
        : Array.isArray(itemsResponse?.items)
          ? itemsResponse.items
          : [];

    for (const item of items) {
      const type = String(item?.type || "").toLowerCase();
      if (!(type.includes("call") || type.includes("tool") || type.includes("execution") || type.includes("search"))) {
        continue;
      }

      const itemId = String(item?.id || "").trim();
      if (!itemId) continue;

      const safeDetail = {
        type: type.slice(0, 80),
        status: String(item?.status || "").slice(0, 40) || null,
        tool_name: typeof item?.name === "string" ? item.name.slice(0, 160) : null,
        server_label: typeof item?.server_label === "string" ? item.server_label.slice(0, 80) : null,
        turn_id: typeof item?.turn_id === "string" ? item.turn_id.slice(0, 160) : null
      };

      try {
        await this.store.recordEvent({
          jobId,
          providerEventId: ("tool:" + jobId + ":" + itemId).slice(0, 500),
          eventType: "agent.tool." + type,
          safeDetail
        });
      } catch {
        // Tool audit is best-effort and deliberately excludes arguments/results.
      }
    }
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

function startKey(jobId) {
  return ("kg-start-" + String(jobId || "unknown")).slice(0, 256);
}

function continuationKey(jobId, turnId) {
  return ("kg-cont-" + jobId + "-" + String(turnId || "unknown")).slice(0, 256);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
