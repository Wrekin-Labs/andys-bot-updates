export const WORK_TOOL_CLASSES = Object.freeze({
  WEB: "web",
  WORKSPACE: "workspace",
  RELAY_READ: "project_relay_read",
  RELAY_WRITE: "project_relay_write",
  CONNECTED_READ: "connected_app_read",
  CONNECTED_WRITE: "connected_app_write",
  USER_APPROVAL: "user_approval"
});

export const WORK_CAPABILITIES = Object.freeze({
  public_research: { toolClass: WORK_TOOL_CLASSES.WEB, approval: "none" },
  inspect_repository: { toolClass: WORK_TOOL_CLASSES.WORKSPACE, approval: "none" },
  edit_workspace: { toolClass: WORK_TOOL_CLASSES.WORKSPACE, approval: "none" },
  run_local_checks: { toolClass: WORK_TOOL_CLASSES.WORKSPACE, approval: "none" },
  read_local_computer: { toolClass: WORK_TOOL_CLASSES.RELAY_READ, approval: "none" },
  operate_local_computer: { toolClass: WORK_TOOL_CLASSES.RELAY_WRITE, approval: "specific" },
  read_connected_app: { toolClass: WORK_TOOL_CLASSES.CONNECTED_READ, approval: "none" },
  change_connected_app: { toolClass: WORK_TOOL_CLASSES.CONNECTED_WRITE, approval: "specific" },
  deploy: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  send_external_message: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  production_write: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  payment: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  legal_acceptance: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  secret_write: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" },
  destructive_action: { toolClass: WORK_TOOL_CLASSES.USER_APPROVAL, approval: "specific" }
});

export function routeWorkStep(step = {}, runtime = {}) {
  const capability = String(step.capability || "").trim();
  const spec = WORK_CAPABILITIES[capability];
  if (!spec) {
    return {
      route: WORK_TOOL_CLASSES.USER_APPROVAL,
      executableHere: false,
      approvalRequired: true,
      reason: "unknown_capability"
    };
  }

  const availability = {
    [WORK_TOOL_CLASSES.WEB]: runtime.allowWeb === true,
    [WORK_TOOL_CLASSES.WORKSPACE]: runtime.workspace === true,
    [WORK_TOOL_CLASSES.RELAY_READ]: runtime.projectRelay === true,
    [WORK_TOOL_CLASSES.RELAY_WRITE]: runtime.projectRelay === true,
    [WORK_TOOL_CLASSES.CONNECTED_READ]: runtime.connectedApps === true,
    [WORK_TOOL_CLASSES.CONNECTED_WRITE]: runtime.connectedApps === true,
    [WORK_TOOL_CLASSES.USER_APPROVAL]: false
  };

  const executableHere = availability[spec.toolClass] === true && spec.approval === "none";
  return {
    route: spec.toolClass,
    executableHere,
    approvalRequired: spec.approval === "specific",
    reason: executableHere
      ? "available_in_current_runtime"
      : spec.approval === "specific"
        ? "specific_approval_required"
        : "host_tool_handoff_required"
  };
}

export function buildWorkRoutingInstructions(runtime = {}) {
  const available = [
    runtime.allowWeb ? "web_search" : null,
    runtime.workspace ? "isolated_workspace" : null,
    runtime.projectRelay ? "project_relay" : null,
    runtime.connectedApps ? "connected_apps" : null
  ].filter(Boolean);

  return [
    "TOOL ROUTING",
    `current_runtime_tools=${available.length ? available.join(",") : "none"}`,
    "Use web_search for fresh public information.",
    "Use the isolated workspace for repository inspection, local edits, builds, tests and artifacts.",
    "Project Relay/computer actions are host-executed capabilities unless the current runtime explicitly exposes them.",
    "Connected account/app actions are host-executed capabilities unless the current runtime explicitly exposes them.",
    "Never claim a host tool action happened unless its result was actually returned.",
    "When a required host tool is unavailable in the background runtime, finish all independent work and return NEEDS_USER/host_handoff with the exact capability, target and intended safe action.",
    "Consequential mutations require a specific approval at the action boundary; never convert a broad goal into blanket permission."
  ].join("\n");
}

export function normaliseWorkPlan(value = []) {
  if (!Array.isArray(value)) throw new Error("work plan must be an array");
  return value.slice(0, 50).map((step, index) => {
    if (!step || typeof step !== "object") throw new Error("work plan step must be an object");
    const capability = String(step.capability || "").trim();
    if (!WORK_CAPABILITIES[capability]) throw new Error("unknown work capability: " + capability);
    return {
      id: String(step.id || `S${index + 1}`).slice(0, 80),
      text: String(step.text || "Work step").trim().slice(0, 1000),
      capability
    };
  });
}
