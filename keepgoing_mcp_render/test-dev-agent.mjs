import assert from "node:assert/strict";
import {
  DEV_ACTIONS,
  buildDevDefinitionOfDone,
  buildDevEngineTag,
  buildDevJobContext,
  buildDevJobGoal,
  devCompletionGate,
  downgradeDevCompletionOutput,
  normaliseDevTask,
  parseDevProgress,
  parseDevEngineTag,
  policyDecision,
  verificationGate,
  verifyDevTerminalOutput
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
  artifacts: [task.patchPath, task.reviewPath, task.handoffPath],
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

const missingReview = structuredClone(progress);
missingReview.artifacts = [task.patchPath, task.handoffPath];
assert.equal(verificationGate(task, missingReview).ok, false);

const serialized = JSON.stringify(progress);
const output = `checkpoint\nDEV_PROGRESS_JSON: ${serialized}\nSTATUS: COMPLETED`;
assert.equal(parseDevProgress(output).stage, "completed");
assert.equal(devCompletionGate(task, output).ok, true);
assert.equal(devCompletionGate(task, "STATUS: COMPLETED").ok, false);

const engineTag = buildDevEngineTag(task);
assert.match(engineTag, /^agents-dev:c3:v2:a[0-9a-f]{16}:q[0-9a-f]{16}:p1:n0:r1$/);
assert.equal(parseDevEngineTag(engineTag).criteriaCount, 3);
assert.equal(verifyDevTerminalOutput(output, engineTag).ok, true);

const incompleteProgress = structuredClone(progress);
incompleteProgress.criteria.pop();
const incompleteOutput = `DEV_PROGRESS_JSON: ${JSON.stringify(incompleteProgress)}\nSTATUS: COMPLETED`;
assert.equal(verifyDevTerminalOutput(incompleteOutput, engineTag).ok, false);

const wrongCriteria = structuredClone(progress);
wrongCriteria.criteria[0].id = "NOT_AC1";
const wrongCriteriaOutput = `DEV_PROGRESS_JSON: ${JSON.stringify(wrongCriteria)}\nSTATUS: COMPLETED`;
assert.equal(verifyDevTerminalOutput(wrongCriteriaOutput, engineTag).ok, false);

const wrongCheck = structuredClone(progress);
wrongCheck.checks[0].command = "npm run something-else";
const wrongCheckOutput = `DEV_PROGRESS_JSON: ${JSON.stringify(wrongCheck)}\nSTATUS: COMPLETED`;
assert.equal(verifyDevTerminalOutput(wrongCheckOutput, engineTag).ok, false);

const downgraded = downgradeDevCompletionOutput(incompleteOutput, ["missing criterion"]);
assert.match(downgraded, /STATUS: PARTIAL/);
assert.match(downgraded, /SERVER_DEV_VERIFICATION_FAILED/);

assert.throws(
  () => normaliseDevTask({
    goal: "duplicate criteria",
    repositoryUrl: "https://github.com/example/repo",
    acceptanceCriteria: [
      { id: "ACX", text: "first" },
      { id: "ACX", text: "second" }
    ]
  }),
  /duplicate acceptance criterion id/
);

const noPatchTask = normaliseDevTask({
  goal: "no patch artifact required",
  repositoryUrl: "https://github.com/example/repo",
  acceptanceCriteria: [{ id: "ONLY", text: "works" }],
  verificationCommands: ["npm test"],
  requirePatchArtifact: false
});
const noPatchProgress = {
  stage: "completed",
  summary: "done",
  criteria: [{ id: "ONLY", status: "pass", evidence: "npm test" }],
  checks: [{ command: "npm test", exitCode: 0, required: true }],
  risks: [],
  artifacts: ["/workspace/outputs/review.md", "/workspace/outputs/handoff.md"],
  next: "done"
};
assert.equal(
  verifyDevTerminalOutput(
    `DEV_PROGRESS_JSON: ${JSON.stringify(noPatchProgress)}\nSTATUS: COMPLETED`,
    buildDevEngineTag(noPatchTask)
  ).ok,
  true
);

const playbookTask = normaliseDevTask({
  goal: "repair failing CI",
  repositoryUrl: "https://github.com/example/repo",
  acceptanceCriteria: [{ id: "BASE", text: "Original requirement remains satisfied" }],
  verificationCommands: ["npm test"],
  playbook: "ci_repair"
});
assert.equal(playbookTask.playbook, "ci_repair");
assert.equal(playbookTask.acceptanceCriteria.length, 4);
assert.ok(playbookTask.acceptanceCriteria.some((item) => item.id === "KG_CI_REPAIR_1"));
assert.match(buildDevJobContext(playbookTask), /playbook=ci_repair/);
assert.match(buildDevJobContext(playbookTask), /Reproduce the failing check/);
assert.match(buildDevEngineTag(playbookTask), /^agents-dev:c4:v1:/);
assert.throws(
  () => normaliseDevTask({
    goal: "bad playbook",
    repositoryUrl: "https://github.com/example/repo",
    acceptanceCriteria: ["works"],
    playbook: "not-a-playbook"
  }),
  /playbook must be one of/
);

const planTask = normaliseDevTask({
  goal: "plan a safe migration",
  repositoryUrl: "https://github.com/example/repo",
  acceptanceCriteria: [{ id: "PLAN_AC", text: "Plan covers the migration safely" }],
  planOnly: true
});
assert.equal(planTask.planOnly, true);
assert.equal(planTask.requirePatchArtifact, false);
assert.ok(planTask.verificationCommands.includes('test -z "$(git status --porcelain=v1 --untracked-files=all)"'));
assert.match(buildDevJobGoal(planTask), /MODE: PLAN ONLY/);
assert.match(buildDevDefinitionOfDone(planTask), /plan\.md/);
assert.match(buildDevEngineTag(planTask), /^agents-dev:c1:v1:a[0-9a-f]{16}:q[0-9a-f]{16}:p0:n1:r1$/);
const planProgress = {
  stage: "completed",
  summary: "plan ready",
  criteria: [{ id: "PLAN_AC", status: "pass", evidence: "Repository analysis and plan" }],
  checks: [{ command: 'test -z "$(git status --porcelain=v1 --untracked-files=all)"', exitCode: 0, required: true }],
  risks: [],
  artifacts: ["/workspace/outputs/plan.md", "/workspace/outputs/review.md", "/workspace/outputs/handoff.md"],
  next: "handoff"
};
const planOutput = `DEV_PROGRESS_JSON: ${JSON.stringify(planProgress)}\nSTATUS: COMPLETED`;
assert.equal(verificationGate(planTask, planProgress).ok, true);
assert.equal(verifyDevTerminalOutput(planOutput, buildDevEngineTag(planTask)).ok, true);
const planMissingArtifact = structuredClone(planProgress);
planMissingArtifact.artifacts = ["/workspace/outputs/review.md", "/workspace/outputs/handoff.md"];
assert.equal(verificationGate(planTask, planMissingArtifact).ok, false);
assert.equal(verifyDevTerminalOutput(`DEV_PROGRESS_JSON: ${JSON.stringify(planMissingArtifact)}\nSTATUS: COMPLETED`, buildDevEngineTag(planTask)).ok, false);

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
