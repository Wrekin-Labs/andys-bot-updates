import crypto from "node:crypto";
import { isTerminal } from "./durable_job.js";
import { latestSessionText } from "./agents_engine.js";

export function createV12Service({
  engine,
  store,
  orchestrator,
  model = "gpt-6-astra",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  if (!engine || !store || !orchestrator) throw new Error("v1.2 runtime dependencies required");

  async function start({
    goal,
    definitionOfDone = "All requested work completed and verified",
    mode = "balanced",
    allowWeb = true,
    tier = "pro",
    ownerSubjectHash,
    clientRequestId = null,
    beforeCreateSession = null
  }) {
    const limits = planLimits(tier, allowWeb);
    const result = await orchestrator.start({
      initialPrompt: buildJobPrompt(goal, definitionOfDone, mode),
      instructions: "Finish the KeepGoing job. Preserve completed work across turns and obey the required STATUS marker.",
      allowWeb,
      reasoningEffort: reasoningEffort(mode),
      ownerSubjectHash,
      clientRequestId,
      limits: {
        maxAttempts: limits.max_attempts,
        maxWallMs: limits.max_wall_seconds * 1000,
        maxTotalTokens: limits.max_total_tokens,
        maxToolCalls: limits.max_total_tool_calls
      },
      beforeCreateSession
    });

    return {
      job_id: result.job.id,
      status: result.job.status,
      model,
      tier,
      limits: {
        max_output_tokens: limits.max_total_tokens,
        max_tool_calls: limits.max_total_tool_calls,
        ...limits
      },
      duplicate: !result.created,
      message: result.created
        ? "KeepGoing durable job started. Server-side recovery can continue it without repeated continue prompts."
        : "This start request already exists. Reusing the existing KeepGoing job."
    };
  }

  async function get(jobId, ownerSubjectHash, admin = false) {
    const job = await ownedJob(jobId, ownerSubjectHash, admin);
    return view(job);
  }

  async function wait(jobId, ownerSubjectHash, admin = false, waitSeconds = 20) {
    const deadline = now() + Math.max(1, Math.min(Number(waitSeconds) || 20, 25)) * 1000;
    let job = await ownedJob(jobId, ownerSubjectHash, admin);

    while (!isTerminal(job.status) && now() < deadline) {
      await sleep(2000);
      job = await ownedJob(jobId, ownerSubjectHash, admin);
    }

    const result = await view(job);
    const shouldContinue = !isTerminal(job.status);
    return {
      ...result,
      should_continue_polling: shouldContinue,
      message: shouldContinue
        ? "KeepGoing is still active on the server. Reuse this job_id; do not start a duplicate."
        : terminalMessage(job.status)
    };
  }

  async function cancel(jobId, ownerSubjectHash, admin = false) {
    await ownedJob(jobId, ownerSubjectHash, admin);
    const job = await orchestrator.cancel(jobId);
    return { job_id: job.id, status: job.status };
  }

  async function resume(jobId, input, ownerSubjectHash, admin = false) {
    const job = await ownedJob(jobId, ownerSubjectHash, admin);
    if (job.status !== "input_required") {
      throw new Error("KeepGoing job is not waiting for user input");
    }
    if (!job.providerSessionId) throw new Error("KeepGoing provider session is unavailable");

    const text = String(input || "").trim();
    if (!text) throw new Error("input is required");
    const key = [
      "kg-user",
      job.id,
      String(job.lastAssessedTurnId || "no-turn"),
      sha256(text).slice(0, 24)
    ].join("-").slice(0, 256);

    const claimNow = now();
    const existingKey = String(job.continuationIdempotencyKey || "");
    const existingLease = Number(job.continuationLeaseUntil || 0);

    if (existingKey && existingKey.startsWith("kg-user-")) {
      if (existingKey !== key) {
        throw new Error(
          "Previous user input delivery is unresolved. Retry the same input or check job status before changing it."
        );
      }
      if (existingLease > claimNow) {
        return {
          job_id: job.id,
          status: job.status,
          message: "This user input is already being delivered. Check the same job before retrying."
        };
      }
    }

    const claim = {
      ...job,
      continuationClaimId: crypto.randomUUID(),
      continuationIdempotencyKey: key,
      continuationLeaseUntil: claimNow + 60_000,
      safeErrorCode: "user_input_pending",
      safeErrorMessage: null,
      updatedAt: claimNow
    };
    const claimed = await store.compareAndSet(job.id, job.version, claim);
    if (!claimed.ok) {
      return {
        job_id: claimed.job?.id || job.id,
        status: claimed.job?.status || job.status,
        message: "The job changed while input was being claimed. Check its current status before retrying."
      };
    }

    try {
      await engine.sendMessage(claimed.job.providerSessionId, text, key);
    } catch (error) {
      const retryable = {
        ...claimed.job,
        status: "input_required",
        continuationLeaseUntil: null,
        safeErrorCode: "user_input_send_unknown",
        safeErrorMessage: "User input delivery was not confirmed. Retry the exact same input safely.",
        updatedAt: now()
      };
      await store.compareAndSet(claimed.job.id, claimed.job.version, retryable);
      throw error;
    }

    const next = {
      ...claimed.job,
      status: "working",
      continuationNeeded: false,
      continuationClaimId: null,
      continuationIdempotencyKey: null,
      continuationLeaseUntil: null,
      safeErrorCode: null,
      safeErrorMessage: null,
      updatedAt: now(),
      lastProgressAt: now()
    };
    const saved = await store.compareAndSet(claimed.job.id, claimed.job.version, next);
    const finalJob = saved.job || claimed.job;
    return {
      job_id: finalJob.id,
      status: saved.ok ? finalJob.status : (saved.job?.status || finalJob.status),
      message: saved.ok
        ? "User input accepted. KeepGoing resumed the same durable job."
        : "The job changed after input delivery. Check its current status before retrying."
    };
  }

  async function ownedJob(jobId, ownerSubjectHash, admin) {
    const job = await store.get(jobId);
    if (!job) throw new Error("KeepGoing job not found");
    if (!admin && job.ownerSubjectHash !== ownerSubjectHash) {
      throw new Error("KeepGoing job not found");
    }
    return job;
  }

  async function view(job) {
    let output = "";
    if (job.providerSessionId) {
      try {
        const items = await engine.listItems(job.providerSessionId, { order: "asc", limit: 100 });
        output = latestSessionText(items);
      } catch {
        output = "";
      }
    }
    return {
      job_id: job.id,
      status: job.status,
      output,
      error: job.safeErrorMessage || null,
      incomplete_details: {
        attempt: job.attempt,
        max_attempts: job.maxAttempts,
        tokens_used: job.tokensUsed,
        token_budget_total: job.tokenBudgetTotal,
        tool_calls_used: job.toolCallsUsed,
        tool_call_budget_total: job.toolCallBudgetTotal,
        last_progress_at: job.lastProgressAt ? new Date(job.lastProgressAt).toISOString() : null,
        completion_marker: job.completionMarker || null
      }
    };
  }

  return { start, get, wait, cancel, resume, ownedJob };
}

export function planLimits(tier, allowWeb = true) {
  const business = tier === "business" || tier === "owner";
  return {
    max_attempts: business ? 10 : 6,
    max_total_tokens: business ? 160_000 : 60_000,
    max_total_tool_calls: allowWeb ? (business ? 50 : 18) : 0,
    max_wall_seconds: business ? 6 * 60 * 60 : 2 * 60 * 60
  };
}

export function buildJobPrompt(goal, done, mode) {
  const autonomy = {
    safe: "Be cautious. Do not make assumptions where missing information changes the result.",
    balanced: "Work autonomously where reasonable, verify important points, and minimise unnecessary questions.",
    max: "Work as autonomously and comprehensively as possible within the available tools and information."
  }[mode] || "Work autonomously where reasonable.";

  return [
    "You are the execution engine for KeepGoing, a durable AI job runner.",
    "",
    "GOAL:", String(goal || ""),
    "",
    "DEFINITION OF DONE:", String(done || ""),
    "",
    "AUTONOMY:", autonomy,
    "",
    "Complete the job as fully as possible.",
    "Treat prior turns in this session as checkpoints. Do not repeat completed work.",
    "Do not stop merely because a normal chat response would have ended.",
    "Never claim actions outside the tools actually available to this session.",
    "If an essential credential, approval, payment, destructive action, private account action, or missing fact prevents completion, state exactly what is required.",
    "",
    "End every root turn with exactly one of:",
    "STATUS: COMPLETED",
    "STATUS: NEEDS_USER",
    "STATUS: PARTIAL",
    "",
    "Then include a concise WORK_COMPLETED section and RESULT."
  ].join("\n");
}

function reasoningEffort(mode) {
  return mode === "max" ? "high" : mode === "safe" ? "low" : "medium";
}

function terminalMessage(status) {
  if (status === "completed") return "KeepGoing completed the durable job.";
  if (status === "input_required") return "KeepGoing needs user input before the same job can continue.";
  if (status === "budget_exhausted") return "KeepGoing stopped at its configured safety/cost budget.";
  if (status === "cancelled") return "KeepGoing job was cancelled.";
  return "KeepGoing reached a terminal state.";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
