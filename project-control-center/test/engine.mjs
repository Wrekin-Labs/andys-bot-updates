import assert from "node:assert/strict";
import { EngineeringTaskStore } from "../engine.mjs";

const changes = [];
const store = new EngineeringTaskStore({ onChange: c => changes.push(c) });

const created = store.create({
  title:"Build autonomous engineer milestone",
  project_name:"Project Control Center",
  repository:"Wrekin-Labs/andys-bot-updates",
  branch:"project-control-center-v0.3-autonomous-engineer"
});
assert.equal(created.phase, "planning");
assert.equal(created.progress, 10);

assert.throws(() => store.transition(created.id, "ci"), /invalid_transition/);
store.transition(created.id, "coding", { summary:"Implementation underway" });
store.transition(created.id, "testing");
store.transition(created.id, "reviewing");

const evidence = store.addEvidence(created.id, { kind:"test", label:"Unit tests passed", detail:"Core state machine verified" });
assert.equal(evidence.kind, "test");

const waiting = store.requestApproval(created.id, {
  title:"Merge protected branch",
  detail:"Human approval is required before an irreversible merge.",
  risk:"high"
});
assert.equal(waiting.phase, "blocked");
assert.equal(waiting.needs_owner, true);
assert.ok(waiting.pending_approval);
assert.throws(() => store.transition(created.id, "ci"), /approval_pending/);

const resumed = store.resolveApproval(created.id, { approved:true });
assert.equal(resumed.phase, "reviewing");
assert.equal(resumed.needs_owner, false);

store.transition(created.id, "ci");
store.transition(created.id, "pr_ready");
const done = store.transition(created.id, "completed");
assert.equal(done.progress, 100);
assert.equal(store.summary().completed, 1);
assert.equal(store.get(created.id).evidence.length, 1);
assert.ok(changes.length >= 9);

console.log("engineering_store_ok", JSON.stringify({ changes:changes.length, phase:done.phase }));
