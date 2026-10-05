import crypto from "node:crypto";

const GITHUB_REPOSITORY_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;
const SAFE_CRITERION_RE = /\S/;

export const DEV_STAGES = Object.freeze([
  "queued",
  "inspecting",
  "planning",
  "implementing",
  "verifying",
  "reviewing",
  "completed",
  "input_required",
  "blocked",
  "failed",
  "budget_exhausted",
  "cancelled"
]);

export const CRITERION_STATES = Object.freeze([
  "pending",
  "pass",
  "fail",
  "blocked"
]);

export const DEV_ACTIONS = Object.freeze({
  INSPECT_REPOSITORY: "inspect_repository",
  SEARCH_CODE: "search_code",
  EDIT_LOCAL_FILES: "edit_local_files",
  INSTALL_DEPENDENCY: "install_dependency",
  RUN_BUILD: "run_build",
  RUN_TESTS: "run_tests",
  RUN_LINT: "run_lint",
  LOCAL_GIT: "local_git",
  WRITE_ARTIFACT: "write_artifact",
  CREATE_REMOTE_BRANCH: "create_remote_branch",
  PUSH_REMOTE: "push_remote",
  CREATE_PULL_REQUEST: "create_pull_request",
  MERGE_PULL_REQUEST: "merge_pull_request",
  DEPLOY: "deploy",
  PRODUCTION_DB_WRITE: "production_db_write",
  DNS_CHANGE: "dns_change",
  EXTERNAL_MESSAGE: "external_message",
  PAYMENT_CHANGE: "payment_change",
  SECRET_READ: "secret_read",
  SECRET_WRITE: "secret_write",
  DESTRUCTIVE_OPERATION: "destructive_operation"
});

const LOCAL_ALLOWED_ACTIONS = new Set([
  DEV_ACTIONS.INSPECT_REPOSITORY,
  DEV_ACTIONS.SEARCH_CODE,
  DEV_ACTIONS.EDIT_LOCAL_FILES,
  DEV_ACTIONS.INSTALL_DEPENDENCY,
  DEV_ACTIONS.RUN_BUILD,
  DEV_ACTIONS.RUN_TESTS,
  DEV_ACTIONS.RUN_LINT,
  DEV_ACTIONS.LOCAL_GIT,
  DEV_ACTIONS.WRITE_ARTIFACT
]);

const REMOTE_OR_SENSITIVE_ACTIONS = new Set([
  DEV_ACTIONS.CREATE_REMOTE_BRANCH,
  DEV_ACTIONS.PUSH_REMOTE,
  DEV_ACTIONS.CREATE_PULL_REQUEST,
  DEV_ACTIONS.MERGE_PULL_REQUEST,
  DEV_ACTIONS.DEPLOY,
  DEV_ACTIONS.PRODUCTION_DB_WRITE,
  DEV_ACTIONS.DNS_CHANGE,
  DEV_ACTIONS.EXTERNAL_MESSAGE,
  DEV_ACTIONS.PAYMENT_CHANGE,
  DEV_ACTIONS.SECRET_READ,
  DEV_ACTIONS.SECRET_WRITE,
  DEV_ACTIONS.DESTRUCTIVE_OPERATION
]);

export function normaliseDevTask(input = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("development task must be an object");
  }

  const goal = cleanRequiredText(input.goal, "goal", 12_000);
  const repositoryUrl = normaliseRepositoryUrl(input.repositoryUrl);
  const repositoryRef = normaliseRepositoryRef(input.repositoryRef || "main");
  const mode = normaliseMode(input.mode || "max");
  const allowWeb = input.allowWeb !== false;
  const context = cleanOptionalText(input.context, 4_000);
  const acceptanceCriteria = normaliseCriteria(input.acceptanceCriteria);
  const verificationCommands = normaliseVerificationCommands(input.verificationCommands);
  const approvalPolicy = normaliseApprovalPolicy(input.approvalPolicy);

  return Object.freeze({
    goal,
    repositoryUrl,
    repositoryRef,
    mode,
    allowWeb,
    context,
    acceptanceCriteria,
    verificationCommands,
    approvalPolicy,
    requireFinalReview: input.requireFinalReview !== false,
    requirePatchArtifact: input.requirePatchArtifact !== false,
    progressPath: "/workspace/outputs/dev-progress.json",
    patchPath: "/workspace/outputs/changes.patch",
    handoffPath: "/workspace/outputs/handoff.md"
  });
}

export function buildDevJobGoal(taskInput) {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const criteria = task.acceptanceCriteria
    .map((item) => `- ${item.id}: ${item.text}`)
    .join("\n");
  const verification = task.verificationCommands.length
    ? task.verificationCommands.map((cmd, i) => `- V${i + 1}: ${cmd}`).join("\n")
    : "- Auto-detect the project's normal build/test/lint commands from repository files and documentation.";

  return [
    "Complete this software-engineering task autonomously inside the isolated coding workspace.",
    `Repository: ${task.repositoryUrl}`,
    `Base ref: ${task.repositoryRef}`,
    "",
    "GOAL",
    task.goal,
    "",
    "ACCEPTANCE CRITERIA",
    criteria,
    "",
    "VERIFICATION",
    verification,
    "",
    "WORKFLOW",
    "1. Inspect the repository and project instructions before editing.",
    "2. Produce a short implementation plan mapped to the acceptance criteria.",
    "3. Implement the smallest coherent change set.",
    "4. Run relevant syntax, lint, unit, build and integration checks after changes.",
    "5. On failure, inspect the actual error, repair it and re-run the failed verification.",
    "6. Review the final diff for correctness, security, regressions and scope creep.",
    "7. Keep structured progress current and publish the required output artifacts.",
    "8. Return STATUS: COMPLETED only after every required criterion and verification gate passes.",
    "",
    "OUTPUT ARTIFACTS",
    `- Structured progress: ${task.progressPath}`,
    `- Patch: ${task.patchPath}`,
    `- Final handoff: ${task.handoffPath}`,
    "",
    "REMOTE SIDE EFFECTS",
    "Do not push, merge, deploy, change production data, modify DNS, send external messages, alter payments, or access/rotate secrets unless the approval policy explicitly permits it. If such an action is essential and not permitted, prepare the local work and return STATUS: NEEDS_USER with the exact approval needed.",
    "",
    progressProtocol(task)
  ].join("\n");
}

export function buildDevDefinitionOfDone(taskInput) {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const criteria = task.acceptanceCriteria.map((item) => item.id).join(", ");
  return [
    `All acceptance criteria are verified as pass: ${criteria}.`,
    task.verificationCommands.length
      ? "Every required verification command exits with code 0."
      : "The project's normal verification commands were discovered and executed successfully.",
    task.requireFinalReview ? "Final diff review is complete with no unresolved blocking findings." : "No unresolved blocking findings remain.",
    task.requirePatchArtifact ? `A patch artifact exists at ${task.patchPath}.` : "The final changes are fully summarized.",
    `A handoff exists at ${task.handoffPath}.`,
    `The latest structured progress at ${task.progressPath} reports stage completed.`,
    "No remote or sensitive side effect was performed without policy permission/approval."
  ].join(" ");
}

export function buildDevJobContext(taskInput, extraContext = "") {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const policy = task.approvalPolicy;
  const text = [
    "Development-agent policy checkpoint:",
    `mode=${task.mode}`,
    `remotePush=${policy.allowRemotePush}`,
    `createPullRequest=${policy.allowCreatePullRequest}`,
    `mergePullRequest=${policy.allowMergePullRequest}`,
    `deploy=${policy.allowDeploy}`,
    `productionWrites=${policy.allowProductionWrites}`,
    `externalMessages=${policy.allowExternalMessages}`,
    `payments=${policy.allowPayments}`,
    `secretAccess=${policy.allowSecretAccess}`,
    "Local repository inspection/edit/build/test/lint/git-diff/artifact work is allowed in the isolated workspace.",
    cleanOptionalText(extraContext || task.context, 2_500)
  ].filter(Boolean).join("\n");
  return text.slice(0, 4_000);
}

export function policyDecision(action, taskInput) {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const kind = typeof action === "string" ? action : String(action?.kind || "");

  if (LOCAL_ALLOWED_ACTIONS.has(kind)) {
    return { allowed: true, requiresApproval: false, reason: "isolated_local_action" };
  }

  const policy = task.approvalPolicy;
  const permissionMap = {
    [DEV_ACTIONS.CREATE_REMOTE_BRANCH]: policy.allowRemotePush,
    [DEV_ACTIONS.PUSH_REMOTE]: policy.allowRemotePush,
    [DEV_ACTIONS.CREATE_PULL_REQUEST]: policy.allowCreatePullRequest,
    [DEV_ACTIONS.MERGE_PULL_REQUEST]: policy.allowMergePullRequest,
    [DEV_ACTIONS.DEPLOY]: policy.allowDeploy,
    [DEV_ACTIONS.PRODUCTION_DB_WRITE]: policy.allowProductionWrites,
    [DEV_ACTIONS.DNS_CHANGE]: policy.allowProductionWrites,
    [DEV_ACTIONS.EXTERNAL_MESSAGE]: policy.allowExternalMessages,
    [DEV_ACTIONS.PAYMENT_CHANGE]: policy.allowPayments,
    [DEV_ACTIONS.SECRET_READ]: policy.allowSecretAccess,
    [DEV_ACTIONS.SECRET_WRITE]: false,
    [DEV_ACTIONS.DESTRUCTIVE_OPERATION]: false
  };

  if (REMOTE_OR_SENSITIVE_ACTIONS.has(kind)) {
    const allowed = permissionMap[kind] === true;
    return {
      allowed,
      requiresApproval: !allowed,
      reason: allowed ? "policy_permission_granted" : "human_approval_required"
    };
  }

  return { allowed: false, requiresApproval: true, reason: "unknown_action_kind" };
}

export function parseDevProgress(output = "") {
  const text = String(output || "");
  const marker = "DEV_PROGRESS_JSON:";
  const idx = text.lastIndexOf(marker);
  if (idx < 0) return null;
  const tail = text.slice(idx + marker.length).trimStart();
  const firstLine = tail.split(/\r?\n/, 1)[0].trim();
  if (!firstLine) return null;
  try {
    return normaliseProgress(JSON.parse(firstLine));
  } catch {
    return null;
  }
}

export function normaliseProgress(progress = {}) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    throw new Error("progress must be an object");
  }
  const stage = DEV_STAGES.includes(String(progress.stage || ""))
    ? String(progress.stage)
    : "queued";
  const summary = cleanOptionalText(progress.summary, 2_000);
  const next = cleanOptionalText(progress.next, 2_000);
  const criteria = Array.isArray(progress.criteria)
    ? progress.criteria.slice(0, 50).map((item) => ({
        id: cleanRequiredText(item?.id, "criterion id", 80),
        status: CRITERION_STATES.includes(String(item?.status || ""))
          ? String(item.status)
          : "pending",
        evidence: cleanOptionalText(item?.evidence, 2_000) || null
      }))
    : [];
  const checks = Array.isArray(progress.checks)
    ? progress.checks.slice(0, 50).map((item) => ({
        command: cleanRequiredText(item?.command, "check command", 1_000),
        exitCode: Number.isInteger(item?.exitCode) ? item.exitCode : null,
        required: item?.required !== false
      }))
    : [];
  const risks = Array.isArray(progress.risks)
    ? progress.risks.slice(0, 50).map((v) => cleanOptionalText(v, 1_000)).filter(Boolean)
    : [];
  const artifacts = Array.isArray(progress.artifacts)
    ? progress.artifacts.slice(0, 50).map((v) => cleanOptionalText(v, 500)).filter(Boolean)
    : [];

  return { stage, summary, next, criteria, checks, risks, artifacts };
}

export function verificationGate(taskInput, progressInput) {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const progress = normaliseProgress(progressInput || {});
  const reasons = [];

  const byId = new Map(progress.criteria.map((item) => [item.id, item]));
  for (const criterion of task.acceptanceCriteria) {
    const result = byId.get(criterion.id);
    if (!result) {
      reasons.push(`${criterion.id} has no reported result`);
      continue;
    }
    if (result.status !== "pass") {
      reasons.push(`${criterion.id} is ${result.status}`);
    }
    if (!result.evidence) {
      reasons.push(`${criterion.id} has no evidence`);
    }
  }

  if (task.verificationCommands.length) {
    for (const requiredCommand of task.verificationCommands) {
      const check = progress.checks.find((item) => item.command === requiredCommand);
      if (!check) {
        reasons.push(`verification not reported: ${requiredCommand}`);
      } else if (check.exitCode !== 0) {
        reasons.push(`verification failed: ${requiredCommand}`);
      }
    }
  } else {
    const requiredChecks = progress.checks.filter((item) => item.required !== false);
    if (!requiredChecks.length) reasons.push("no verification check was reported");
    for (const check of requiredChecks) {
      if (check.exitCode !== 0) reasons.push(`verification failed: ${check.command}`);
    }
  }

  if (task.requireFinalReview && progress.stage !== "completed") {
    reasons.push("final review/completed stage not reported");
  }
  if (progress.criteria.some((item) => item.status === "blocked" || item.status === "fail")) {
    reasons.push("one or more criteria are blocked or failed");
  }
  if (task.requirePatchArtifact && !progress.artifacts.includes(task.patchPath)) {
    reasons.push(`required patch artifact not reported: ${task.patchPath}`);
  }
  if (!progress.artifacts.includes(task.handoffPath)) {
    reasons.push(`handoff artifact not reported: ${task.handoffPath}`);
  }

  return { ok: reasons.length === 0, reasons };
}

export function devCompletionGate(taskInput, output = "") {
  const progress = parseDevProgress(output);
  if (!progress) {
    return { ok: false, reasons: ["missing or invalid DEV_PROGRESS_JSON"], progress: null };
  }
  const gate = verificationGate(taskInput, progress);
  return { ...gate, progress };
}

export function buildDevEngineTag(taskInput) {
  const task = isNormalisedTask(taskInput) ? taskInput : normaliseDevTask(taskInput);
  const criteriaSignature = devSpecHash(task.acceptanceCriteria.map((item) => item.id));
  const verificationSignature = task.verificationCommands.length
    ? devSpecHash(task.verificationCommands)
    : "auto";
  return [
    "agents-dev",
    `c${task.acceptanceCriteria.length}`,
    `v${task.verificationCommands.length}`,
    `a${criteriaSignature}`,
    `q${verificationSignature}`,
    `p${task.requirePatchArtifact ? 1 : 0}`
  ].join(":");
}

export function parseDevEngineTag(value) {
  const match = String(value || "").match(
    /^agents-dev:c(\d+):v(\d+):a([0-9a-f]{16}):q(auto|[0-9a-f]{16}):p([01])$/
  );
  if (!match) return null;
  const criteriaCount = Number(match[1]);
  const verificationCount = Number(match[2]);
  if (!Number.isSafeInteger(criteriaCount) || criteriaCount < 1 || criteriaCount > 20) return null;
  if (!Number.isSafeInteger(verificationCount) || verificationCount < 0 || verificationCount > 12) return null;
  if ((verificationCount === 0) !== (match[4] === "auto")) return null;
  return {
    criteriaCount,
    verificationCount,
    criteriaSignature: match[3],
    verificationSignature: match[4],
    requirePatchArtifact: match[5] === "1"
  };
}

export function verifyDevTerminalOutput(output = "", engineTag = "") {
  const spec = typeof engineTag === "string" ? parseDevEngineTag(engineTag) : engineTag;
  if (!spec) {
    return { ok: false, reasons: ["invalid development engine tag"], progress: null };
  }

  const progress = parseDevProgress(output);
  if (!progress) {
    return { ok: false, reasons: ["missing or invalid DEV_PROGRESS_JSON"], progress: null };
  }

  const reasons = [];
  if (progress.stage !== "completed") reasons.push("development stage is not completed");

  const ids = new Set();
  for (const criterion of progress.criteria) {
    if (ids.has(criterion.id)) reasons.push(`duplicate criterion id: ${criterion.id}`);
    ids.add(criterion.id);
    if (criterion.status !== "pass") reasons.push(`${criterion.id} is ${criterion.status}`);
    if (!criterion.evidence) reasons.push(`${criterion.id} has no evidence`);
  }
  if (progress.criteria.length !== spec.criteriaCount) {
    reasons.push(`expected exactly ${spec.criteriaCount} criteria, received ${progress.criteria.length}`);
  }
  if (progress.criteria.length === spec.criteriaCount) {
    const criteriaSignature = devSpecHash(progress.criteria.map((item) => item.id));
    if (criteriaSignature !== spec.criteriaSignature) {
      reasons.push("reported criterion identifiers do not match the development task");
    }
  }

  const requiredChecks = progress.checks.filter((item) => item.required !== false);
  if (spec.verificationCount > 0) {
    if (requiredChecks.length !== spec.verificationCount) {
      reasons.push(
        `expected exactly ${spec.verificationCount} required verification checks, received ${requiredChecks.length}`
      );
    } else {
      const verificationSignature = devSpecHash(requiredChecks.map((item) => item.command));
      if (verificationSignature !== spec.verificationSignature) {
        reasons.push("reported verification commands do not match the development task");
      }
    }
  } else if (!requiredChecks.length) {
    reasons.push("no required verification check was reported");
  }

  for (const check of requiredChecks) {
    if (check.exitCode !== 0) reasons.push(`verification failed: ${check.command}`);
  }

  if (
    spec.requirePatchArtifact &&
    !progress.artifacts.includes("/workspace/outputs/changes.patch")
  ) {
    reasons.push("required patch artifact not reported");
  }
  if (!progress.artifacts.includes("/workspace/outputs/handoff.md")) {
    reasons.push("required handoff artifact not reported");
  }

  return { ok: reasons.length === 0, reasons, progress };
}

export function downgradeDevCompletionOutput(output = "", reasons = []) {
  const replaced = String(output || "").replace(
    /(^|\n)\s*STATUS:\s*COMPLETED\s*(?=\n|$)/i,
    "$1STATUS: PARTIAL"
  );
  const detail = Array.isArray(reasons) && reasons.length
    ? reasons.slice(0, 20).join("; ")
    : "development verification gate did not pass";
  return `${replaced.trim()}\n\nSERVER_DEV_VERIFICATION_FAILED: ${detail}`;
}

function normaliseRepositoryUrl(value) {
  const raw = cleanRequiredText(value, "repositoryUrl", 500);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("repositoryUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("repositoryUrl must be an https://github.com/owner/repo URL");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("repositoryUrl must not contain credentials, query parameters or fragments");
  }
  const normalized = raw.replace(/\/$/, "");
  const match = normalized.match(GITHUB_REPOSITORY_RE);
  if (!match) throw new Error("repositoryUrl must identify one GitHub repository");
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/, "")}.git`;
}

function normaliseRepositoryRef(value) {
  const ref = cleanRequiredText(value, "repositoryRef", 200);
  if (!SAFE_REF_RE.test(ref) || ref.includes("..") || ref.includes("@{") || ref.endsWith("/") || ref.includes("//")) {
    throw new Error("repositoryRef contains unsafe characters or traversal syntax");
  }
  return ref;
}

function normaliseCriteria(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("acceptanceCriteria must contain at least one criterion");
  }
  if (value.length > 20) throw new Error("acceptanceCriteria supports at most 20 items");
  const criteria = value.map((item, index) => {
    const text = typeof item === "string" ? item : item?.text;
    const id = typeof item === "object" && item?.id
      ? cleanRequiredText(item.id, "criterion id", 80)
      : `AC${index + 1}`;
    const cleaned = cleanRequiredText(text, "acceptance criterion", 1_000);
    if (!SAFE_CRITERION_RE.test(cleaned)) throw new Error("acceptance criterion cannot be blank");
    return Object.freeze({ id, text: cleaned });
  });
  const ids = new Set();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) {
      throw new Error(`duplicate acceptance criterion id: ${criterion.id}`);
    }
    ids.add(criterion.id);
  }
  return criteria;
}

function normaliseVerificationCommands(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("verificationCommands must be an array");
  if (value.length > 12) throw new Error("verificationCommands supports at most 12 commands");
  return value.map((cmd) => {
    const cleaned = cleanRequiredText(cmd, "verification command", 1_000);
    if (cleaned.includes("\0")) throw new Error("verification command contains a NUL byte");
    return cleaned;
  });
}

function normaliseApprovalPolicy(value = {}) {
  if (value == null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("approvalPolicy must be an object");
  return Object.freeze({
    allowRemotePush: value.allowRemotePush === true,
    allowCreatePullRequest: value.allowCreatePullRequest === true,
    allowMergePullRequest: value.allowMergePullRequest === true,
    allowDeploy: value.allowDeploy === true,
    allowProductionWrites: value.allowProductionWrites === true,
    allowExternalMessages: value.allowExternalMessages === true,
    allowPayments: value.allowPayments === true,
    allowSecretAccess: value.allowSecretAccess === true
  });
}

function normaliseMode(value) {
  const mode = String(value || "").toLowerCase();
  if (!new Set(["safe", "balanced", "max"]).has(mode)) {
    throw new Error("mode must be safe, balanced or max");
  }
  return mode;
}

function progressProtocol(task) {
  return [
    "STRUCTURED PROGRESS PROTOCOL",
    "Whenever the stage materially changes, update /workspace/outputs/dev-progress.json and include one compact single-line JSON snapshot in your checkpoint output prefixed exactly with DEV_PROGRESS_JSON:.",
    "The JSON shape is:",
    '{"stage":"implementing","summary":"...","criteria":[{"id":"AC1","status":"pending|pass|fail|blocked","evidence":"..."}],"checks":[{"command":"...","exitCode":0,"required":true}],"risks":[],"artifacts":["/workspace/outputs/changes.patch","/workspace/outputs/handoff.md"],"next":"..."}',
    `All criterion IDs must come from: ${task.acceptanceCriteria.map((c) => c.id).join(", ")}.`,
    "The final checkpoint must use stage completed, include evidence for every criterion, include verification results, list required artifacts, and then end with STATUS: COMPLETED."
  ].join("\n");
}

function devSpecHash(values) {
  const canonical = (Array.isArray(values) ? values : [])
    .map((value) => String(value))
    .sort((a, b) => a.localeCompare(b));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function cleanRequiredText(value, name, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return text;
}

function cleanOptionalText(value, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`text exceeds ${maxLength} characters`);
  return text;
}

function isNormalisedTask(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.goal === "string" &&
    typeof value.repositoryUrl === "string" &&
    Array.isArray(value.acceptanceCriteria) &&
    value.progressPath === "/workspace/outputs/dev-progress.json"
  );
}
