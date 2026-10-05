import assert from "node:assert/strict";
import { buildStartDevTaskArgs, devTaskToolDescription } from "./dev_task_adapter.js";

const { task, persistentArgs } = buildStartDevTaskArgs({
  goal: "Implement the development-task workflow.",
  repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates",
  repositoryRef: "keepgoing-v1.5-artifact-finalization",
  acceptanceCriteria: ["Existing tests stay green", "A patch artifact is produced"],
  verificationCommands: ["npm run verify"],
  context: "Preserve public KeepGoing compatibility.",
  clientRequestId: "kg-v2-test",
  workspaceFiles: [{ path: "notes.txt", content: "non-secret test context" }]
});

assert.equal(persistentArgs.codingWorkspace, true);
assert.equal(persistentArgs.planOnly, false);
assert.match(persistentArgs.jobEngine, /^agents-dev:c2:v1:a[0-9a-f]{16}:q[0-9a-f]{16}:p1:n0:r1$/);
assert.equal(persistentArgs.repositoryUrl, task.repositoryUrl);
assert.equal(persistentArgs.repositoryRef, task.repositoryRef);
assert.equal(persistentArgs.clientRequestId, "kg-v2-test");
assert.equal(persistentArgs.workspaceFiles.length, 1);
assert.match(persistentArgs.goal, /WORKFLOW/);
assert.match(persistentArgs.definitionOfDone, /All acceptance criteria/);
assert.match(persistentArgs.context, /remotePush=false/);
assert.match(devTaskToolDescription(), /approval-gated/);

const planTaskArgs = buildStartDevTaskArgs({
  goal: "Plan a safe repository migration.",
  repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates",
  repositoryRef: "keepgoing-v1.5-artifact-finalization",
  acceptanceCriteria: ["Plan covers sequencing and verification"],
  planOnly: true,
  clientRequestId: "kg-v2-plan-test"
});
assert.equal(planTaskArgs.task.planOnly, true);
assert.equal(planTaskArgs.persistentArgs.planOnly, true);
assert.match(planTaskArgs.persistentArgs.jobEngine, /^agents-dev:c1:v1:a[0-9a-f]{16}:q[0-9a-f]{16}:p0:n1:r1$/);
assert.match(planTaskArgs.persistentArgs.goal, /MODE: PLAN ONLY/);
assert.match(planTaskArgs.persistentArgs.context, /planOnly=true/);

assert.throws(
  () => buildStartDevTaskArgs({
    goal: "Plan around selected local changes.",
    repositoryUrl: "https://github.com/Wrekin-Labs/andys-bot-updates",
    acceptanceCriteria: ["Produce a plan"],
    planOnly: true,
    workspaceFiles: [{ path: "notes.txt", content: "would dirty the baseline" }]
  }),
  /planOnly does not accept workspaceFiles/
);

console.log("dev_task_adapter tests passed");
