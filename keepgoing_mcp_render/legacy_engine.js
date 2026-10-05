// Legacy (v1.1) background-Responses engine, used when the durable v1.2+
// engine is disabled or limited to the owner canary.
//
// Security invariant: every legacy job is bound to its owner through Responses
// API metadata at creation, and get/wait/cancel verify that binding. Before
// 1.5.0 any authenticated customer could read or cancel ANY response id held
// by KeepGoing's OpenAI project (including other customers' jobs).
import crypto from "node:crypto";

export const LEGACY_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "expired", "incomplete"]);
const LEGACY_JOB_ID_RE = /^resp_[A-Za-z0-9_-]{8,190}$/;
const OWNER_METADATA_KEY = "keepgoing_owner";

export function isLegacyJobId(value) {
  return LEGACY_JOB_ID_RE.test(String(value || ""));
}

export function createLegacyEngine({
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  limitsForTier,
  allowUnboundReads = false,
  timeoutMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");
  if (typeof limitsForTier !== "function") throw new Error("limitsForTier required");

  async function openai(path, init = {}) {
    if (!apiKey) throw new Error("KeepGoing OpenAI key is not configured");
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1" + path, {
        ...init,
        signal: init.signal || AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          ...(init.headers || {})
        }
      });
    } catch (error) {
      const wrapped = new Error(error?.name === "TimeoutError" ? "OpenAI request timed out" : "OpenAI is unreachable");
      wrapped.code = error?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable";
      throw wrapped;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(data?.error?.message || ("OpenAI request failed (" + response.status + ")")).slice(0, 300));
      error.status = response.status;
      error.code = response.status === 429 ? "provider_rate_limited" : response.status === 404 ? "not_found" : "provider_error";
      throw error;
    }
    return data;
  }

  async function start({ goal, definitionOfDone, mode, allowWeb, tier = "pro", ownerSubjectHash, safetyIdentifier = "" }) {
    if (!String(ownerSubjectHash || "").trim()) throw new Error("KeepGoing account identity is unavailable; reconnect KeepGoing.");
    const limits = limitsForTier(tier);
    const reasoningEffort = mode === "max" ? "high" : mode === "safe" ? "low" : "medium";
    const body = {
      model,
      input: legacyJobPrompt(goal, definitionOfDone, mode),
      background: true,
      store: true,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: limits.maxOutputTokens,
      metadata: { keepgoing: "legacy", [OWNER_METADATA_KEY]: String(ownerSubjectHash).slice(0, 128) }
    };
    if (safetyIdentifier) body.safety_identifier = safetyIdentifier;
    if (allowWeb) {
      body.tools = [{ type: "web_search", return_token_budget: "default" }];
      body.max_tool_calls = limits.maxToolCalls;
    }
    const data = await openai("/responses", { method: "POST", body: JSON.stringify(body) });
    return {
      job_id: data.id,
      status: data.status,
      message: "KeepGoing job started. Reuse this job_id with get_persistent_job instead of starting a duplicate."
    };
  }

  async function ownedResponse(jobId, ownerSubjectHash, admin) {
    if (!isLegacyJobId(jobId)) throw notFound();
    let data;
    try {
      data = await openai("/responses/" + encodeURIComponent(jobId), { method: "GET" });
    } catch (error) {
      if (error?.code === "not_found") throw notFound();
      throw error;
    }
    if (admin) return data;
    const bound = String(data?.metadata?.[OWNER_METADATA_KEY] || "");
    if (bound) {
      if (!timingSafeStringEqual(bound, String(ownerSubjectHash || ""))) throw notFound();
      return data;
    }
    // Responses created before owner binding carry no owner metadata. They are
    // refused unless the operator explicitly opts in during migration.
    if (allowUnboundReads && data?.metadata?.keepgoing !== "v1.2") return data;
    throw notFound();
  }

  async function get(jobId, ownerSubjectHash, admin = false) {
    const data = await ownedResponse(jobId, ownerSubjectHash, admin);
    return {
      job_id: data.id,
      status: data.status,
      output: outputText(data),
      error: data.error?.message ? String(data.error.message).slice(0, 500) : null
    };
  }

  async function wait(jobId, ownerSubjectHash, admin = false, waitSeconds = 20) {
    const deadline = now() + Math.max(1, Math.min(Number(waitSeconds) || 20, 25)) * 1000;
    let latest = await get(jobId, ownerSubjectHash, admin);
    while (!LEGACY_TERMINAL_STATUSES.has(latest.status) && now() < deadline) {
      await sleep(2000);
      latest = await get(jobId, ownerSubjectHash, admin);
    }
    const terminal = LEGACY_TERMINAL_STATUSES.has(latest.status);
    return {
      ...latest,
      should_continue_polling: !terminal,
      message: terminal
        ? "KeepGoing reached a terminal state."
        : "KeepGoing is still running. Call wait_for_persistent_job again with the same job_id. Do not ask the user to type continue."
    };
  }

  async function cancel(jobId, ownerSubjectHash, admin = false) {
    const current = await ownedResponse(jobId, ownerSubjectHash, admin);
    if (LEGACY_TERMINAL_STATUSES.has(current.status)) {
      return { job_id: current.id, status: current.status };
    }
    const data = await openai("/responses/" + encodeURIComponent(jobId) + "/cancel", {
      method: "POST",
      body: "{}"
    });
    return { job_id: data.id || jobId, status: data.status || "cancelled" };
  }

  return { start, get, wait, cancel };
}

export function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

export function legacyJobPrompt(goal, done, mode) {
  const autonomy = {
    safe: "Be cautious. Do not make assumptions where missing information changes the result.",
    balanced: "Work autonomously where reasonable, verify important points, and minimise unnecessary questions.",
    max: "Work as autonomously and comprehensively as possible within the available tools and information."
  }[mode] || "Work autonomously where reasonable.";

  return [
    "You are the execution engine for KeepGoing, a persistent background AI job runner.",
    "",
    "GOAL:", goal,
    "",
    "DEFINITION OF DONE:", done,
    "",
    "AUTONOMY:", autonomy,
    "",
    "Complete the job as fully as possible in this background run.",
    "Do not stop merely because a normal chat response would have ended or because you would usually ask whether to continue.",
    "Never claim to have performed actions outside the tools actually available to this response.",
    "If an essential credential, approval, payment, destructive action, private account action, or missing fact prevents completion, return NEEDS_USER and state exactly what is required.",
    "",
    "End with one of:",
    "STATUS: COMPLETED",
    "STATUS: NEEDS_USER",
    "STATUS: PARTIAL",
    "",
    "Then include a concise WORK_COMPLETED section and RESULT."
  ].join("\n");
}

function notFound() {
  return new Error("KeepGoing job not found");
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
