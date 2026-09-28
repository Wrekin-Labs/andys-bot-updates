const STATUS_RE = /(?:^|\n)\s*STATUS:\s*(COMPLETED|NEEDS_USER|PARTIAL)\s*(?:\n|$)/i;

export const JOB_STATES = Object.freeze({
  QUEUED: "queued",
  WORKING: "working",
  INPUT_REQUIRED: "input_required",
  CONTINUING: "continuing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  BUDGET_EXHAUSTED: "budget_exhausted"
});

export function parseCompletionMarker(output = "") {
  const match = String(output || "").match(STATUS_RE);
  return match ? match[1].toUpperCase() : null;
}

export function normaliseLimits(input = {}) {
  const maxAttempts = clampInt(input.maxAttempts, 1, 20, 6);
  const maxWallMs = clampInt(input.maxWallMs, 60_000, 24 * 60 * 60 * 1000, 60 * 60 * 1000);
  const maxTotalTokens = clampInt(input.maxTotalTokens, 1_000, 10_000_000, 120_000);
  const maxToolCalls = clampInt(input.maxToolCalls, 0, 100_000, 30);
  return { maxAttempts, maxWallMs, maxTotalTokens, maxToolCalls };
}

export function newJobRecord({
  id,
  goalHash,
  definitionHash,
  ownerSubjectHash,
  engine = "responses",
  now = Date.now(),
  limits = {}
}) {
  if (!id) throw new Error("job id required");
  const normalised = normaliseLimits(limits);
  return {
    id,
    ownerSubjectHash: ownerSubjectHash || null,
    goalHash: goalHash || null,
    definitionHash: definitionHash || null,
    engine,
    status: JOB_STATES.QUEUED,
    attempt: 0,
    maxAttempts: normalised.maxAttempts,
    startedAt: now,
    updatedAt: now,
    lastProgressAt: now,
    wallDeadlineAt: now + normalised.maxWallMs,
    tokenBudgetTotal: normalised.maxTotalTokens,
    tokensUsed: 0,
    toolCallBudgetTotal: normalised.maxToolCalls,
    toolCallsUsed: 0,
    lastOutputHash: null,
    repeatedOutputCount: 0,
    currentRunId: null,
    continuationNeeded: false,
    completionMarker: null,
    safeErrorCode: null,
    safeErrorMessage: null
  };
}

export function assessRun(job, {
  providerStatus,
  output = "",
  tokensUsed = 0,
  toolCallsUsed = 0,
  now = Date.now(),
  runId = null
} = {}) {
  if (!job || !job.id) throw new Error("job record required");
  if (isTerminal(job.status)) return { ...job, continuationNeeded: false };

  const next = { ...job };
  next.updatedAt = now;
  next.lastProgressAt = now;
  next.currentRunId = runId || next.currentRunId;
  next.attempt += 1;
  next.tokensUsed += safeNonNegativeInt(tokensUsed);
  next.toolCallsUsed += safeNonNegativeInt(toolCallsUsed);

  if (providerStatus === "cancelled") {
    next.status = JOB_STATES.CANCELLED;
    next.continuationNeeded = false;
    return next;
  }
  if (providerStatus === "failed") {
    next.status = JOB_STATES.FAILED;
    next.safeErrorCode = "provider_failed";
    next.safeErrorMessage = "The model run failed.";
    next.continuationNeeded = false;
    return next;
  }

  const marker = parseCompletionMarker(output);
  next.completionMarker = marker;

  const outputHash = hashText(output);
  if (outputHash && outputHash === next.lastOutputHash) {
    next.repeatedOutputCount += 1;
  } else {
    next.repeatedOutputCount = 0;
    next.lastOutputHash = outputHash;
  }

  if (marker === "COMPLETED" && providerStatus === "completed") {
    next.status = JOB_STATES.COMPLETED;
    next.continuationNeeded = false;
    return next;
  }
  if (marker === "NEEDS_USER") {
    next.status = JOB_STATES.INPUT_REQUIRED;
    next.continuationNeeded = false;
    return next;
  }

  if (next.repeatedOutputCount >= 2) {
    next.status = JOB_STATES.FAILED;
    next.safeErrorCode = "continuation_loop";
    next.safeErrorMessage = "KeepGoing stopped after repeated identical output.";
    next.continuationNeeded = false;
    return next;
  }

  const wantsContinuation =
    marker === "PARTIAL" ||
    providerStatus === "incomplete" ||
    (providerStatus === "completed" && marker === null);

  if (wantsContinuation) {
    const toolBudgetReached =
      next.toolCallBudgetTotal > 0 &&
      next.toolCallsUsed >= next.toolCallBudgetTotal;

    if (
      now >= next.wallDeadlineAt ||
      next.attempt >= next.maxAttempts ||
      next.tokensUsed >= next.tokenBudgetTotal ||
      toolBudgetReached
    ) {
      next.status = JOB_STATES.BUDGET_EXHAUSTED;
      next.safeErrorCode = "budget_exhausted";
      next.safeErrorMessage = "KeepGoing reached its configured continuation budget.";
      next.continuationNeeded = false;
      return next;
    }

    next.status = JOB_STATES.CONTINUING;
    next.continuationNeeded = true;
    return next;
  }

  next.status = JOB_STATES.FAILED;
  next.safeErrorCode = "invalid_terminal_state";
  next.safeErrorMessage = "KeepGoing could not validate the final job state.";
  next.continuationNeeded = false;
  return next;
}

export function isTerminal(status) {
  return new Set([
    JOB_STATES.INPUT_REQUIRED,
    JOB_STATES.COMPLETED,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED,
    JOB_STATES.BUDGET_EXHAUSTED
  ]).has(status);
}

export function continuationPrompt(previousOutput, attempt, maxAttempts) {
  const prior = String(previousOutput || "").trim();
  return [
    "Continue the same KeepGoing job.",
    "Do not restart the task or repeat work already completed.",
    "Use the previous result as a checkpoint and finish the remaining work.",
    `Continuation attempt ${attempt + 1} of at most ${maxAttempts}.`,
    "",
    "PREVIOUS CHECKPOINT:",
    prior.slice(-24_000),
    "",
    "End with exactly one of:",
    "STATUS: COMPLETED",
    "STATUS: NEEDS_USER",
    "STATUS: PARTIAL"
  ].join("\n");
}

function hashText(text) {
  const value = String(text || "");
  if (!value) return null;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeNonNegativeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
