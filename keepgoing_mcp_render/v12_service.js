import crypto from "node:crypto";
import { isTerminal } from "./durable_job.js";
import { latestRootTurn, latestSessionText } from "./agents_engine.js";

export function createV12Service({
  engine,
  store,
  orchestrator,
  toolProfiles = null,
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
    admin = false,
    ownerSubjectHash,
    clientRequestId = null,
    context = "",
    toolProfile = "web",
    beforeCreateSession = null
  }) {
    const resolvedTools = resolveToolProfile(toolProfiles, toolProfile, { admin, allowWeb });
    const limits = planLimits(tier, resolvedTools.allowWeb, resolvedTools.mcpTools.length > 0);
    if (resolvedTools.maxToolCalls != null) {
      limits.max_total_tool_calls = Math.min(limits.max_total_tool_calls, resolvedTools.maxToolCalls);
    }
    const result = await orchestrator.start({
      initialPrompt: buildJobPrompt(goal, definitionOfDone, mode, context),
      instructions: "Finish the KeepGoing job. Preserve completed work across turns and use supplied context as a checkpoint. Use only the tools actually attached to this session and obey their allowlists. Do not stop for non-essential clarification: make safe, reversible assumptions where reasonable. Use NEEDS_USER only when an essential approval, credential, private-account action, irreversible/destructive choice, or genuinely missing fact blocks completion. Obey the required STATUS marker.",
      allowWeb: resolvedTools.allowWeb,
      mcpTools: resolvedTools.mcpTools,
      toolProfileName: resolvedTools.name,
      toolPolicyHash: resolvedTools.policyHash,
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
      duplicate: !result.created,
      tool_profile: resolvedTools.name,
      message: result.created
        ? "KeepGoing durable job started. Server-side recovery can continue it without repeated continue prompts."
        : "This start request already exists. Reusing the existing KeepGoing job."
    };
  }

  function listToolProfiles(admin = false) {
    if (!toolProfiles?.list) {
      return { profiles: [{
        name: "web",
        description: "Public web research only.",
        owner_only: false,
        write_capable: false,
        web: true,
        mcp_servers: [],
        max_tool_calls: null,
        policy_hash: null
      }] };
    }
    return { profiles: toolProfiles.list({ admin }) };
  }

  async function list(ownerSubjectHash, { limit = 20, activeOnly = true } = {}) {
    if (!store.listOwnerJobs) throw new Error("Durable job listing is unavailable");
    const jobs = await store.listOwnerJobs(ownerSubjectHash, { limit, activeOnly });
    return {
      jobs: jobs.map((job) => ({
        job_id: job.id,
        status: job.status,
        attempt: Number(job.attempt || 0),
        max_attempts: Number(job.maxAttempts || 0),
        error: job.safeErrorMessage || null
      }))
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
        let turnId =
          /^turn_[A-Za-z0-9_-]+$/.test(String(job.currentRunId || ""))
            ? String(job.currentRunId)
            : /^turn_[A-Za-z0-9_-]+$/.test(String(job.lastAssessedTurnId || ""))
              ? String(job.lastAssessedTurnId)
              : null;

        if (!turnId && typeof engine.listTurns === "function") {
          const turns = await engine.listTurns(job.providerSessionId, { order: "desc", limit: 10 });
          turnId = latestRootTurn(turns)?.id || null;
        }

        const items =
          turnId && typeof engine.listTurnItems === "function"
            ? await engine.listTurnItems(job.providerSessionId, turnId, { pageSize: 100, maxPages: 10 })
            : engine.listAllItems
              ? await engine.listAllItems(job.providerSessionId, { order: "asc", pageSize: 100, maxPages: 5 })
              : await engine.listItems(job.providerSessionId, { order: "asc", limit: 100 });
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
      progress: {
        attempt: job.attempt,
        max_attempts: job.maxAttempts
      }
    };
  }

  return { start, listToolProfiles, list, get, wait, cancel, resume, ownedJob };
}

export function planLimits(tier, allowWeb = true, hasExternalTools = false) {
  const owner = tier === "owner";
  const business = tier === "business";
  const toolsEnabled = Boolean(allowWeb || hasExternalTools);

  if (owner) {
    return {
      max_attempts: 12,
      max_total_tokens: 60_000,
      max_total_tool_calls: toolsEnabled ? 40 : 0,
      max_wall_seconds: 8 * 60 * 60
    };
  }

  return {
    // Paying plans deliberately keep low aggregate tool-call ceilings so
    // subscription economics remain predictable even at maximum usage.
    max_attempts: business ? 8 : 6,
    max_total_tokens: business ? 30_000 : 20_000,
    max_total_tool_calls: toolsEnabled ? (business ? 5 : 3) : 0,
    max_wall_seconds: business ? 4 * 60 * 60 : 2 * 60 * 60
  };
}

function resolveToolProfile(registry, name, { admin, allowWeb }) {
  const profileName = String(name || "web").trim() || "web";
  if (registry?.resolve) {
    return registry.resolve(profileName, { admin, allowWeb });
  }
  if (profileName !== "web") throw new Error("KeepGoing MCP tool profiles are not configured");
  return {
    name: "web",
    description: "Public web research only.",
    ownerOnly: false,
    writeCapable: false,
    allowWeb: Boolean(allowWeb),
    maxToolCalls: null,
    mcpTools: [],
    policyHash: ""
  };
}

export function buildJobPrompt(goal, done, mode, context = "") {
  const autonomy = {
    safe: "Be cautious. Do not make assumptions where missing information changes the result.",
    balanced: "Work autonomously where reasonable, verify important points, and minimise unnecessary questions.",
    max: "Work as autonomously and comprehensively as possible within the available tools and information."
  }[mode] || "Work autonomously where reasonable.";

  const contextText = String(context || "").trim().slice(0, 20_000);

  return [
    "You are the execution engine for KeepGoing, a durable AI job runner.",
    "",
    "GOAL:", String(goal || ""),
    "",
    "DEFINITION OF DONE:", String(done || ""),
    ...(contextText ? [
      "",
      "RELEVANT CONTEXT FROM THE HOST CHAT / CONNECTED TOOLS:",
      contextText,
      "",
      "Use this context as supporting evidence. The GOAL and latest user instruction remain authoritative."
    ] : []),
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
