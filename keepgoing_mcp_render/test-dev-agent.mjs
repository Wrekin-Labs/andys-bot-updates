import assert from "node:assert/strict";
import {
  DEV_ACTIONS,
  buildDevDefinitionOfDone,
  buildDevJobContext,
  buildDevJobGoal,
  devCompletionGate,
  normaliseDevTask,
  parseDevProgress,
  policyDecision,
  verificationGate
} from "./dev_agent.js";

const task = normaliseDevTask({
  goal: "Add a retry-safe CI failure repair loop without breaking existing durable jobs.",
  repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates",
  repositoryRef: "keepgoing-v1.5-artifact-finalization",
  acceptanceCriteria: [
    "Existing durable-job tests remain green",
    "Development tasks publish structured progress",
    "Remote push remains approval-gated"
  ],
  verificationCommands: ["npm test", "npm run check"]
});

assert.equal(task.repositoryUrl, "https://github.com/Wrekin-Labs/andys-bot-updates.git");
assert.equal(task.acceptanceCriteria[0].id, "AC1");
assert.equal(task.mode, "max");
assert.equal(task.allowWeb, true);

assert.throws(() => normaliseDevTask({
  ...task,
  repositoryUrl: "https://user:pass@github.com/owner/repo"
}), /must not contain credentials/);

assert.throws(() => normaliseDevTask({
  ...task,
  repositoryUrl: "https://gitlab.com/owner/repo"
}), /github\.com/);

assert.throws(() => normaliseDevTask({
  ...task,
  repositoryRef: "../main"
}), /unsafe/);

assert.deepEqual(
  policyDecision(DEV_ACTIONS.EDIT_LOCAL_FILES, task),
  { allowed: true, requiresApproval: false, reason: "isolated_local_action" }
);
assert.deepEqual(
  policyDecision(DEV_ACTIONS.PUSH_REMOTE, task),
  { allowed: false, requiresApproval: true, reason: "human_approval_required" }
);
assert.deepEqual(
  policyDecision(DEV_ACTIONS.MERGE_PULL_REQUEST, task),
  { allowed: false, requiresApproval: true, reason: "human_approval_required" }
);

const permissive = normaliseDevTask({
  ...task,
  approvalPolicy: { allowRemotePush: true, allowCreatePullRequest: true }
});
assert.equal(policyDecision(DEV_ACTIONS.PUSH_REMOTE, permissive).allowed, true);
assert.equal(policyDecision(DEV_ACTIONS.CREATE_PULL_REQUEST, permissive).allowed, true);
assert.equal(policyDecision(DEV_ACTIONS.MERGE_PULL_REQUEST, permissive).allowed, false);

const progress = {
  stage: "completed",
  summary: "Done",
  criteria: task.acceptanceCriteria.map((item) => ({
    id: item.id,
    status: "pass",
    evidence: "verified by tests"
  })),
  checks: task.verificationCommands.map((command) => ({ command, exitCode: 0, required: true })),
  risks: [],
  artifacts: [task.patchPath, task.handoffPath],
  next: "handoff"
};

assert.deepEqual(verificationGate(task, progress), { ok: true, reasons: [] });

const pending = structuredClone(progress);
pending.criteria[1].status = "pending";
assert.equal(verificationGate(task, pending).ok, false);

const failing = structuredClone(progress);
failing.checks[0].exitCode = 1;
assert.equal(verificationGate(task, failing).ok, false);

const missingPatch = structuredClone(progress);
missingPatch.artifacts = [task.handoffPath];
assert.equal(verificationGate(task, missingPatch).ok, false);

const serialized = JSON.stringify(progress);
const output = `checkpoint\nDEV_PROGRESS_JSON: ${serialized}\nSTATUS: COMPLETED`;
assert.equal(parseDevProgress(output).stage, "completed");
assert.equal(devCompletionGate(task, output).ok, true);
assert.equal(devCompletionGate(task, "STATUS: COMPLETED").ok, false);

const goal = buildDevJobGoal(task);
assert.match(goal, /AC1:/);
assert.match(goal, /Do not push, merge, deploy/);
assert.match(goal, /DEV_PROGRESS_JSON:/);

const done = buildDevDefinitionOfDone(task);
assert.match(done, /AC1, AC2, AC3/);
assert.match(done, /exit/);

const context = buildDevJobContext(task, "Use current project conventions.");
assert.match(context, /remotePush=false/);
assert.match(context, /Use current project conventions/);

console.log("dev_agent tests passed");
