import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORK_ACTIONS,
  buildWorkGoal,
  normaliseWorkTask,
  workCompletionGate,
  workPolicyDecision
} from "./work_agent.js";
import { buildStartWorkTaskArgs } from "./work_task_adapter.js";

const generic = normaliseWorkTask({
  goal: "Finish a multi-step commercial launch",
  acceptanceCriteria: ["Plan the work", "Verify the result"]
});
assert.equal(generic.repositoryUrl, null);
assert.equal(generic.acceptanceCriteria.length, 2);
assert.equal(workPolicyDecision(WORK_ACTIONS.LOCAL_TEST, generic).allowed, true);
assert.equal(workPolicyDecision(WORK_ACTIONS.DEPLOY, generic).allowed, false);
assert.equal(workPolicyDecision(WORK_ACTIONS.PAYMENT, generic).requiresApproval, true);

const permitted = normaliseWorkTask({
  goal: "Prepare and deploy the web release",
  acceptanceCriteria: ["Release verified"],
  approvalPolicy: { allowDeploy: true }
});
assert.equal(workPolicyDecision(WORK_ACTIONS.DEPLOY, permitted).allowed, true);
assert.equal(workPolicyDecision(WORK_ACTIONS.DESTRUCTIVE_ACTION, permitted).allowed, false);

const repo = normaliseWorkTask({
  goal: "Implement and test a feature",
  repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates.git",
  repositoryRef: "keepgoing-v2-dev-agent",
  acceptanceCriteria: ["Feature works"]
});
assert.equal(repo.repositoryUrl, "https://github.com/Wrekin-Labs/andys-bot-updates");
assert.match(buildWorkGoal(repo), /WORK_PROGRESS_JSON:/);
assert.match(buildWorkGoal(repo), /STATUS: COMPLETED/);

const adapterGeneric = buildStartWorkTaskArgs({
  goal: "Research and produce a finished result",
  acceptanceCriteria: ["Result verified"]
});
assert.equal(adapterGeneric.persistentArgs.codingWorkspace, false);
assert.equal(adapterGeneric.persistentArgs.jobEngine, "agents-work:v1");

const adapterRepo = buildStartWorkTaskArgs({
  goal: "Change code safely",
  repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates",
  acceptanceCriteria: ["Change verified"]
});
assert.equal(adapterRepo.persistentArgs.codingWorkspace, true);

assert.throws(() => buildStartWorkTaskArgs({
  goal: "Use selected files",
  acceptanceCriteria: ["Done"],
  workspaceFiles: [{ path: "a.txt", content: "x" }]
}), /workspaceFiles requires repositoryUrl/);

const gateTask = normaliseWorkTask({
  goal: "Complete one checked outcome",
  acceptanceCriteria: ["Outcome complete"]
});
const goodOutput = [
  'WORK_PROGRESS_JSON: {"stage":"completed","summary":"done","plan":[{"id":"C1","text":"Outcome complete","status":"pass"}],"checks":[{"label":"verified","ok":true,"evidence":"direct check"}],"blockers":[],"requested_approval":null,"next":""}',
  "STATUS: COMPLETED"
].join("\n");
assert.equal(workCompletionGate(gateTask, goodOutput).ok, true);

const blockedOutput = 'WORK_PROGRESS_JSON: {"stage":"blocked","summary":"waiting","plan":[{"id":"C1","text":"Outcome complete","status":"blocked"}],"checks":[],"blockers":["approval required"],"requested_approval":{"action":"deploy","reason":"production"},"next":"wait"}';
assert.equal(workCompletionGate(gateTask, blockedOutput).ok, false);

const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
assert.match(serverSource, /registerTool\("start_work_task"/);
assert.match(serverSource, /startWorkTaskCompat/);
assert.match(serverSource, /workTaskToolDescription/);

console.log("work agent tests passed");
