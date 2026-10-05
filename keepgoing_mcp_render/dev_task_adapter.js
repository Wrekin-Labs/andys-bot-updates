import {
  buildDevDefinitionOfDone,
  buildDevJobContext,
  buildDevJobGoal,
  normaliseDevTask
} from "./dev_agent.js";

export function buildStartDevTaskArgs(input = {}) {
  const task = normaliseDevTask(input);
  const workspaceFiles = Array.isArray(input.workspaceFiles) ? input.workspaceFiles : [];
  const clientRequestId = cleanOptional(input.clientRequestId, 200) || null;
  const extraContext = cleanOptional(input.context, 4_000);

  return {
    task,
    persistentArgs: {
      goal: buildDevJobGoal(task),
      definitionOfDone: buildDevDefinitionOfDone(task),
      mode: task.mode,
      allowWeb: task.allowWeb,
      clientRequestId,
      context: buildDevJobContext(task, extraContext),
      codingWorkspace: true,
      repositoryUrl: task.repositoryUrl,
      repositoryRef: task.repositoryRef,
      workspaceFiles
    }
  };
}

export function devTaskToolDescription() {
  return "Start one durable autonomous software-engineering task in an isolated coding workspace. The agent inspects the repository, plans, edits, builds, tests, repairs failures, reviews the final diff, and publishes progress/patch/handoff artifacts. Remote push, merge, deploy, production writes, payments, external messages, and secret operations remain approval-gated by default.";
}

function cleanOptional(value, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`text exceeds ${maxLength} characters`);
  return text;
}
