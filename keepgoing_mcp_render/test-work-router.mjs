import assert from "node:assert/strict";
import {
  WORK_TOOL_CLASSES,
  buildWorkRoutingInstructions,
  normaliseWorkPlan,
  routeWorkStep
} from "./work_router.js";

assert.equal(routeWorkStep({capability:"public_research"},{allowWeb:true}).executableHere,true);
assert.equal(routeWorkStep({capability:"inspect_repository"},{workspace:false}).reason,"host_tool_handoff_required");
assert.equal(routeWorkStep({capability:"read_local_computer"},{projectRelay:true}).route,WORK_TOOL_CLASSES.RELAY_READ);
assert.equal(routeWorkStep({capability:"read_local_computer"},{projectRelay:true}).executableHere,true);
assert.equal(routeWorkStep({capability:"operate_local_computer"},{projectRelay:true}).approvalRequired,true);
assert.equal(routeWorkStep({capability:"operate_local_computer"},{projectRelay:true}).executableHere,false);
assert.equal(routeWorkStep({capability:"payment"},{projectRelay:true,connectedApps:true}).approvalRequired,true);
assert.equal(routeWorkStep({capability:"legal_acceptance"},{connectedApps:true}).approvalRequired,true);
assert.equal(routeWorkStep({capability:"unknown"},{allowWeb:true}).approvalRequired,true);

const plan=normaliseWorkPlan([
  {id:"S1",text:"Research",capability:"public_research"},
  {id:"S2",text:"Inspect PC",capability:"read_local_computer"}
]);
assert.equal(plan.length,2);
assert.throws(()=>normaliseWorkPlan([{capability:"made_up"}]),/unknown work capability/);

const instructions=buildWorkRoutingInstructions({allowWeb:true,workspace:true,projectRelay:false,connectedApps:false});
assert.match(instructions,/web_search/);
assert.match(instructions,/isolated_workspace/);
assert.match(instructions,/host-executed capabilities/);
assert.match(instructions,/Never claim a host tool action happened/);

console.log("work router tests passed");
