import crypto from "node:crypto";
import { isTerminal } from "./durable_job.js";
import { latestRootTurn, latestSessionText, normaliseCodingWorkspace } from "./agents_engine.js";

export const JOB_INSTRUCTIONS = [
  "Finish the KeepGoing job.",
  "Preserve completed work across turns and use any supplied brief task checkpoint only as supporting context.",
  "The checkpoint is intentionally limited and is not full chat history; never infer missing credentials, private data, or unrelated facts from it.",
  "Do not stop for non-essential clarification: make safe, reversible assumptions where reasonable.",
  "Use NEEDS_USER only when an essential approval, credential, private-account action, irreversible/destructive choice, or genuinely missing fact blocks completion.",
  "You do not need a KeepGoing control tool, runner control, or job-state tool to finish the work.",
  "The KeepGoing server converts your final STATUS marker into the durable job state.",
  "If the requested work is complete, return STATUS: COMPLETED even when this session exposes no KeepGoing control tool.",
  "Obey the required STATUS marker."
].join(" ");


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
    context = "",
    jobEngine = "agents",
    codingWorkspace = false,
    repositoryUrl = null,
    repositoryRef = null,
    workspaceFiles = [],
    beforeCreateSession = null
  }) {
    if ((repositoryUrl || repositoryRef || (workspaceFiles?.length || 0) > 0) && !codingWorkspace) {
      throw new Error("repositoryUrl/repositoryRef/workspaceFiles require codingWorkspace=true");
    }

    // Validate workspace configuration before durable reservation/quota use.
    const workspace = codingWorkspace
      ? normaliseCodingWorkspace({
          enabled: true,
          repositoryUrl,
          repositoryRef,
          files: workspaceFiles
        })
      : null;

    const limits = planLimits(tier, allowWeb, codingWorkspace);
    const result = await orchestrator.start({
      initialPrompt: buildJobPrompt(goal, definitionOfDone, mode, context),
      instructions: codingWorkspace
        ? JOB_INSTRUCTIONS + " A coding workspace is available at /workspace/project. Read and modify files there, run appropriate tests, and save any useful patch/report artifacts under /workspace/outputs. Do not attempt to push to GitHub or request repository credentials; this first workspace mode is read/clone plus local edit/test only."
        : JOB_INSTRUCTIONS,
      allowWeb,
      reasoningEffort: reasoningEffort(mode),
      ownerSubjectHash,
      clientRequestId,
      jobEngine,
      workspace,
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
      message: result.created
        ? "KeepGoing durable job started. Server-side recovery can continue it without repeated continue prompts."
        : "This start request already exists. Reusing the existing KeepGoing job."
    };
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

  async function artifacts(jobId, ownerSubjectHash, admin = false, limit = 50) {
    const job = await ownedJob(jobId, ownerSubjectHash, admin);
    if (!job.providerSessionId || typeof engine.listArtifacts !== "function") {
      return { job_id: job.id, artifacts: [] };
    }

    const response = await engine.listArtifacts(job.providerSessionId, {
      order: "desc",
      limit: Math.max(1, Math.min(100, Number(limit) || 50))
    });

    const rows = Array.isArray(response)
      ? response
      : Array.isArray(response?.data) ? response.data
      : Array.isArray(response?.items) ? response.items
      : [];

    return {
      job_id: job.id,
      artifacts: rows
        .filter((item) => isPublishedOutputPath(item?.path))
        .map((item) => ({
          artifact_id: String(item.id || ""),
          path: String(item.path || ""),
          size_bytes: Number(item.size_bytes || 0),
          turn_id: String(item.turn_id || "")
        }))
        .filter((item) => item.artifact_id && item.path)
    };
  }

  async function readArtifact(jobId, artifactId, ownerSubjectHash, admin = false) {
    const job = await ownedJob(jobId, ownerSubjectHash, admin);
    if (!job.providerSessionId || typeof engine.readArtifactText !== "function") {
      throw new Error("KeepGoing artifact reading is unavailable");
    }

    const result = await engine.readArtifactText(
      job.providerSessionId,
      artifactId,
      { maxBytes: 512_000 }
    );
    if (!isPublishedOutputPath(result?.artifact?.path)) {
      throw new Error("Artifact is outside the published output directory");
    }

    return {
      job_id: job.id,
      artifact_id: String(result.artifact.id || artifactId),
      path: String(result.artifact.path || ""),
      size_bytes: Number(result.artifact.size_bytes || 0),
      text: String(result.text || "")
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

  return { start, list, artifacts, readArtifact, get, wait, cancel, resume, ownedJob };
}

export function planLimits(tier, allowWeb = true, codingWorkspace = false) {
  const business = tier === "business" || tier === "owner";
  return {
    // Continuations remain multi-turn, but aggregate budgets are deliberately
    // bounded to keep subscription economics predictable at maximum usage.
    max_attempts: business ? 8 : 6,
    max_total_tokens: business ? 30_000 : 20_000,
    // This budget covers external web/MCP/function calls. Local sandbox shell
    // and patch operations are controlled by the shorter coding wall clock.
    max_total_tool_calls: allowWeb ? (business ? 5 : 3) : 0,
    max_wall_seconds: codingWorkspace
      ? (business ? 60 * 60 : 30 * 60)
      : (business ? 4 * 60 * 60 : 2 * 60 * 60)
  };
}

export function buildJobPrompt(goal, done, mode, context = "") {
  const autonomy = {
    safe: "Be cautious. Do not make assumptions where missing information changes the result.",
    balanced: "Work autonomously where reasonable, verify important points, and minimise unnecessary questions.",
    max: "Work as autonomously and comprehensively as possible within the available tools and information."
  }[mode] || "Work autonomously where reasonable.";

  const contextText = String(context || "").trim().slice(0, 4_000);

  return [
    "You are the execution engine for KeepGoing, a durable AI job runner.",
    "",
    "GOAL:", String(goal || ""),
    "",
    "DEFINITION OF DONE:", String(done || ""),
    ...(contextText ? [
      "",
      "BRIEF TASK-SPECIFIC CHECKPOINT:",
      contextText,
      "",
      "Use this checkpoint only as supporting evidence. It is intentionally limited and is not full chat history. The GOAL and latest user instruction remain authoritative."
    ] : []),
    "",
    "AUTONOMY:", autonomy,
    "",
    "Complete the job as fully as possible.",
    "Treat prior turns in this session as checkpoints. Do not repeat completed work.",
    "Do not stop merely because a normal chat response would have ended.",
    "Never claim actions outside the tools actually available to this session.",
    "If an essential credential, approval, payment, destructive action, private account action, or missing fact prevents completion, state exactly what is required.",
    "You do not need a KeepGoing control tool, runner control, or job-state tool to finish the work.",
    "The KeepGoing server converts your final STATUS marker into the durable job state.",
    "If the requested work is complete, return STATUS: COMPLETED even when this session exposes no KeepGoing control tool.",
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

function isPublishedOutputPath(path) {
  const value = String(path || "").replace(/\\/g, "/");
  return value === "/workspace/outputs" || value.startsWith("/workspace/outputs/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
