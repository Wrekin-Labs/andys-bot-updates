import {
  buildDevDefinitionOfDone,
  buildDevEngineTag,
  buildDevJobContext,
  buildDevJobGoal,
  normaliseDevTask
} from "./dev_agent.js";

export function buildStartDevTaskArgs(input = {}) {
  const task = normaliseDevTask(input);
  const workspaceFiles = Array.isArray(input.workspaceFiles) ? input.workspaceFiles : [];
  if (task.planOnly && workspaceFiles.length) {
    throw new Error("planOnly does not accept workspaceFiles because the clean-worktree proof must start from the cloned repository baseline");
  }
  const clientRequestId = cleanOptional(input.clientRequestId, 200) || null;
  const extraContext = cleanOptional(input.context, 4_000);

  return {
    task,
    persistentArgs: {
      goal: buildDevJobGoal(task),
      definitionOfDone: buildDevDefinitionOfDone(task),
      jobEngine: buildDevEngineTag(task),
      mode: task.mode,
      allowWeb: task.allowWeb,
      clientRequestId,
      context: buildDevJobContext(task, extraContext),
      planOnly: task.planOnly,
      codingWorkspace: true,
      repositoryUrl: task.repositoryUrl,
      repositoryRef: task.repositoryRef,
      workspaceFiles
    }
  };
}

export function devTaskToolDescription() {
  return "Start one durable autonomous software-engineering task in an isolated coding workspace. The agent can either implement and verify changes or run a plan-only read-only workflow. It inspects the repository, plans, edits/builds/tests when implementation is enabled, reviews evidence, and publishes progress artifacts. Remote push, merge, deploy, production writes, payments, external messages, and secret operations remain approval-gated by default.";
}

function cleanOptional(value, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`text exceeds ${maxLength} characters`);
  return text;
}
