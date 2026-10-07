import {
  buildWorkContext,
  buildWorkDefinitionOfDone,
  buildWorkGoal,
  normaliseWorkTask,
  workToolDescription
} from "./work_agent.js";

export function buildStartWorkTaskArgs(input = {}) {
  const task = normaliseWorkTask(input);
  const workspaceFiles = Array.isArray(input.workspaceFiles) ? input.workspaceFiles : [];
  if (workspaceFiles.length && !task.repositoryUrl) throw new Error("workspaceFiles requires repositoryUrl");
  return {
    task,
    persistentArgs: {
      goal: buildWorkGoal(task),
      definitionOfDone: buildWorkDefinitionOfDone(task),
      jobEngine: "agents-work:v1",
      mode: task.mode,
      allowWeb: task.allowWeb,
      clientRequestId: cleanOptional(input.clientRequestId, 200) || null,
      context: buildWorkContext(task),
      planOnly: false,
      codingWorkspace: Boolean(task.repositoryUrl),
      repositoryUrl: task.repositoryUrl,
      repositoryRef: task.repositoryRef,
      workspaceFiles
    }
  };
}
export function workTaskToolDescription() { return workToolDescription(); }
function cleanOptional(value, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`text exceeds ${maxLength} characters`);
  return text;
}
