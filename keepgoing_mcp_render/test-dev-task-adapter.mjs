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
assert.equal(persistentArgs.repositoryUrl, task.repositoryUrl);
assert.equal(persistentArgs.repositoryRef, task.repositoryRef);
assert.equal(persistentArgs.clientRequestId, "kg-v2-test");
assert.equal(persistentArgs.workspaceFiles.length, 1);
assert.match(persistentArgs.goal, /WORKFLOW/);
assert.match(persistentArgs.definitionOfDone, /All acceptance criteria/);
assert.match(persistentArgs.context, /remotePush=false/);
assert.match(devTaskToolDescription(), /approval-gated/);

console.log("dev_task_adapter tests passed");
