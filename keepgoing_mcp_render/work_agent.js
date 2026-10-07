
import { buildWorkRoutingInstructions } from "./work_router.js";

const SAFE_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

export const WORK_STAGES = Object.freeze(["queued","planning","executing","verifying","reviewing","input_required","blocked","completed","failed","budget_exhausted","cancelled"]);
export const WORK_ACTIONS = Object.freeze({
  PUBLIC_RESEARCH:"public_research", READ_CONTEXT:"read_context", LOCAL_WORKSPACE:"local_workspace",
  LOCAL_CODE_CHANGE:"local_code_change", LOCAL_TEST:"local_test", CREATE_ARTIFACT:"create_artifact",
  REMOTE_CODE_WRITE:"remote_code_write", CREATE_PULL_REQUEST:"create_pull_request", DEPLOY:"deploy",
  PRODUCTION_WRITE:"production_write", EXTERNAL_MESSAGE:"external_message", ACCOUNT_CHANGE:"account_change",
  PAYMENT:"payment", LEGAL_ACCEPTANCE:"legal_acceptance", SECRET_ACCESS:"secret_access", DESTRUCTIVE_ACTION:"destructive_action"
});
const DEFAULT_APPROVAL_POLICY = Object.freeze({
  allowRemoteCodeWrites:false, allowPullRequests:false, allowDeploy:false, allowProductionWrites:false,
  allowExternalMessages:false, allowAccountChanges:false, allowPayments:false, allowSecretAccess:false
});
const LOCAL_ACTIONS = new Set([WORK_ACTIONS.PUBLIC_RESEARCH,WORK_ACTIONS.READ_CONTEXT,WORK_ACTIONS.LOCAL_WORKSPACE,WORK_ACTIONS.LOCAL_CODE_CHANGE,WORK_ACTIONS.LOCAL_TEST,WORK_ACTIONS.CREATE_ARTIFACT]);

export function normaliseWorkTask(input={}) {
  if(!input || typeof input!=="object" || Array.isArray(input)) throw new Error("work task must be an object");
  const goal=requiredText(input.goal,"goal",12000);
  const definitionOfDone=optionalText(input.definitionOfDone,4000)||"All requested work is completed, verified, and clearly handed off.";
  const mode=["safe","balanced","max"].includes(String(input.mode||""))?String(input.mode):"max";
  const repositoryUrl=normaliseRepositoryUrl(input.repositoryUrl);
  return Object.freeze({
    goal,definitionOfDone,mode,allowWeb:input.allowWeb!==false,context:optionalText(input.context,6000),
    repositoryUrl,repositoryRef:repositoryUrl?normaliseRepositoryRef(input.repositoryRef||"main"):null,
    acceptanceCriteria:normaliseCriteria(input.acceptanceCriteria,definitionOfDone),
    verificationCommands:normaliseCommands(input.verificationCommands),
    approvalPolicy:normaliseApprovalPolicy(input.approvalPolicy),
    progressPath:"/workspace/outputs/work-progress.json",planPath:"/workspace/outputs/work-plan.md",
    reviewPath:"/workspace/outputs/work-review.md",handoffPath:"/workspace/outputs/work-handoff.md"
  });
}

export function buildWorkGoal(input={}) {
  const task=isNormalised(input)?input:normaliseWorkTask(input);
  const criteria=task.acceptanceCriteria.map(x=>`- ${x.id}: ${x.text}`).join("\n");
  const verification=task.verificationCommands.length?task.verificationCommands.map((x,i)=>`- V${i+1}: ${x}`).join("\n"):"- Choose evidence-based verification appropriate to the work performed.";
  return [
    "Operate as a durable Work-mode agent. Own the outcome, not merely the next reply.","","GOAL",task.goal,"","DEFINITION OF DONE",task.definitionOfDone,
    "","ACCEPTANCE CRITERIA",criteria,"","VERIFICATION",verification,"","WORK LOOP",
    "1. Inspect available context and capabilities before acting.",
    "2. Produce a concise plan with ordered, testable steps.",
    "3. Execute the next safe step using only tools actually available.",
    "4. Verify every material change or factual conclusion with direct evidence.",
    "5. If verification fails, diagnose the failure, repair it, and re-run the check.",
    "6. Review the final result for completeness, regressions, security, and scope drift.",
    "7. Stop only when completed, genuinely blocked by missing input/approval, cancelled, or limited by configured budgets.",
    "","APPROVAL BOUNDARY",
    "Safe reversible inspection, research, local workspace edits, local code changes, local tests, and artifact creation may proceed.",
    "Remote code writes, pull requests, deployments, production data changes, external messages, account changes, payments, legal acceptance, secret access, and destructive actions require explicit policy permission.",
    "Payments, legal acceptance, secret writes and destructive actions must never be inferred from a broad goal.",
    "If a required action is not permitted, complete all safe preparatory work first, then return STATUS: NEEDS_USER with the exact approval required.",
    "","PROGRESS PROTOCOL","At the end of every root turn include exactly one single-line marker:",
    'WORK_PROGRESS_JSON: {"stage":"planning|executing|verifying|reviewing|input_required|blocked|completed|failed","summary":"...","plan":[{"id":"C1","text":"...","status":"pending|working|pass|fail|blocked"}],"checks":[{"label":"...","ok":true,"evidence":"..."}],"blockers":[],"requested_approval":null,"next":"..."}',
    "Use acceptance-criterion IDs in plan entries so completion can be verified.",
    "Do not mark completed while a required criterion or check is missing or failed.",
    "","FINAL STATUS","End with exactly one of:","STATUS: COMPLETED","STATUS: NEEDS_USER","STATUS: PARTIAL"
  ].join("\n");
}

export function buildWorkContext(input={}) {
  const task=isNormalised(input)?input:normaliseWorkTask(input),p=task.approvalPolicy;
  return [buildWorkRoutingInstructions({allowWeb:task.allowWeb,workspace:Boolean(task.repositoryUrl),projectRelay:false,connectedApps:false}),"KeepGoing Work policy:",`mode=${task.mode}`,`repository=${task.repositoryUrl||"none"}`,
    `remoteCodeWrites=${p.allowRemoteCodeWrites}`,`pullRequests=${p.allowPullRequests}`,`deploy=${p.allowDeploy}`,
    `productionWrites=${p.allowProductionWrites}`,`externalMessages=${p.allowExternalMessages}`,`accountChanges=${p.allowAccountChanges}`,
    `payments=${p.allowPayments}`,`secretAccess=${p.allowSecretAccess}`,task.context].filter(Boolean).join("\n").slice(0,8000);
}

export function buildWorkDefinitionOfDone(input={}) {
  const task=isNormalised(input)?input:normaliseWorkTask(input);
  return [task.definitionOfDone,"Every acceptance criterion has direct evidence and reports pass.","Every required verification command succeeds when commands are supplied.","The latest WORK_PROGRESS_JSON reports stage completed.","No approval-gated action occurs without matching policy permission."].join(" ");
}

export function workPolicyDecision(action,input={}) {
  const task=isNormalised(input)?input:normaliseWorkTask(input),kind=typeof action==="string"?action:String(action?.kind||"");
  if(LOCAL_ACTIONS.has(kind)) return {allowed:true,requiresApproval:false,reason:"safe_reversible_action"};
  const p=task.approvalPolicy;
  const allowed={
    [WORK_ACTIONS.REMOTE_CODE_WRITE]:p.allowRemoteCodeWrites,[WORK_ACTIONS.CREATE_PULL_REQUEST]:p.allowPullRequests,
    [WORK_ACTIONS.DEPLOY]:p.allowDeploy,[WORK_ACTIONS.PRODUCTION_WRITE]:p.allowProductionWrites,
    [WORK_ACTIONS.EXTERNAL_MESSAGE]:p.allowExternalMessages,[WORK_ACTIONS.ACCOUNT_CHANGE]:p.allowAccountChanges,
    [WORK_ACTIONS.PAYMENT]:p.allowPayments,[WORK_ACTIONS.SECRET_ACCESS]:p.allowSecretAccess,
    [WORK_ACTIONS.LEGAL_ACCEPTANCE]:false,[WORK_ACTIONS.DESTRUCTIVE_ACTION]:false
  }[kind];
  if(typeof allowed==="boolean") return {allowed,requiresApproval:!allowed,reason:allowed?"policy_permission_granted":"explicit_approval_required"};
  return {allowed:false,requiresApproval:true,reason:"unknown_action"};
}

export function parseWorkProgress(output="") {
  const text=String(output||""),marker="WORK_PROGRESS_JSON:",i=text.lastIndexOf(marker);
  if(i<0) return null;
  const line=text.slice(i+marker.length).trimStart().split(/\r?\n/,1)[0].trim();
  if(!line) return null;
  try{return normaliseProgress(JSON.parse(line));}catch{return null;}
}

export function workCompletionGate(input={},output="") {
  const task=isNormalised(input)?input:normaliseWorkTask(input),progress=parseWorkProgress(output),reasons=[];
  if(!progress) return {ok:false,reasons:["missing or invalid WORK_PROGRESS_JSON"],progress:null};
  if(progress.stage!=="completed") reasons.push(`stage is ${progress.stage}`);
  for(const criterion of task.acceptanceCriteria){const hit=progress.plan.find(step=>step.id===criterion.id);if(!hit||hit.status!=="pass")reasons.push(`${criterion.id} is not verified pass`);}
  if(progress.checks.some(check=>check.ok!==true)) reasons.push("one or more checks failed");
  if(progress.blockers.length) reasons.push("unresolved blockers remain");
  return {ok:reasons.length===0,reasons,progress};
}

export function workToolDescription(){
  return "Start one durable Work-mode objective. The agent plans, executes available safe steps, verifies results, retries failed checks, reviews the outcome, and stops only on completion, a genuine approval/input requirement, cancellation, or configured limits. Optional public GitHub context enables an isolated coding workspace. Consequential remote actions stay approval-gated by default.";
}

function normaliseProgress(value={}) {
  const stage=WORK_STAGES.includes(String(value.stage||""))?String(value.stage):"queued";
  const plan=Array.isArray(value.plan)?value.plan.slice(0,40).map((x,i)=>({id:optionalText(x?.id,80)||`S${i+1}`,text:optionalText(x?.text,1000)||"Work step",status:["pending","working","pass","fail","blocked"].includes(String(x?.status||""))?String(x.status):"pending"})):[];
  const checks=Array.isArray(value.checks)?value.checks.slice(0,40).map(x=>({label:optionalText(x?.label,500)||"Verification",ok:x?.ok===true,evidence:optionalText(x?.evidence,1500)})):[];
  const blockers=Array.isArray(value.blockers)?value.blockers.slice(0,20).map(x=>optionalText(x,1000)).filter(Boolean):[];
  return {stage,summary:optionalText(value.summary,2000),plan,checks,blockers,requested_approval:value.requested_approval&&typeof value.requested_approval==="object"?{action:optionalText(value.requested_approval.action,120),reason:optionalText(value.requested_approval.reason,1200)}:null,next:optionalText(value.next,1200)};
}

function normaliseRepositoryUrl(value){if(value==null||String(value).trim()==="")return null;const text=String(value).trim().replace(/\.git$/,"");if(!SAFE_REPO_RE.test(text))throw new Error("repositoryUrl must be a public https://github.com/owner/repo URL");return text;}
function normaliseRepositoryRef(value){const text=requiredText(value,"repositoryRef",200);if(!SAFE_REF_RE.test(text)||text.includes("..")||text.startsWith("/")||text.endsWith("/"))throw new Error("invalid repositoryRef");return text;}
function normaliseCriteria(value,fallback){const rows=value==null?[fallback]:value;if(!Array.isArray(rows)||rows.length<1||rows.length>20)throw new Error("acceptanceCriteria must contain 1 to 20 items");return Object.freeze(rows.map((row,i)=>({id:`C${i+1}`,text:requiredText(typeof row==="string"?row:row?.text,`acceptance criterion ${i+1}`,1000)})));}
function normaliseCommands(value){if(value==null)return Object.freeze([]);if(!Array.isArray(value)||value.length>12)throw new Error("verificationCommands supports at most 12 items");return Object.freeze(value.map((x,i)=>requiredText(x,`verification command ${i+1}`,1000)));}
function normaliseApprovalPolicy(value){const raw=value&&typeof value==="object"&&!Array.isArray(value)?value:{},out={};for(const [key,fallback] of Object.entries(DEFAULT_APPROVAL_POLICY))out[key]=raw[key]===true?true:fallback;return Object.freeze(out);}
function requiredText(value,label,max){const text=String(value??"").trim();if(!text)throw new Error(`${label} is required`);if(text.length>max)throw new Error(`${label} exceeds ${max} characters`);return text;}
function optionalText(value,max){if(value==null)return "";const text=String(value).trim();return text.length>max?text.slice(0,max):text;}
function isNormalised(value){return Boolean(value&&typeof value==="object"&&Array.isArray(value.acceptanceCriteria)&&value.approvalPolicy&&"definitionOfDone" in value);}
