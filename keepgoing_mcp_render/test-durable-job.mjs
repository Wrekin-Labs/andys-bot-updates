import assert from "node:assert/strict";
import {
  JOB_STATES,
  assessRun,
  continuationPrompt,
  newJobRecord,
  parseCompletionMarker
} from "./durable_job.js";

const base = () => newJobRecord({
  id: "job_1",
  goalHash: "g",
  definitionHash: "d",
  ownerSubjectHash: "u",
  now: 1_000,
  limits: { maxAttempts: 4, maxWallMs: 600_000, maxTotalTokens: 50_000, maxToolCalls: 20 }
});

assert.equal(parseCompletionMarker("x\nSTATUS: COMPLETED\n"), "COMPLETED");
assert.equal(parseCompletionMarker("STATUS: NEEDS_USER"), "NEEDS_USER");
assert.equal(parseCompletionMarker("none"), null);

let job = assessRun(base(), { providerStatus: "completed", output: "done\nSTATUS: COMPLETED", now: 2_000 });
assert.equal(job.status, JOB_STATES.COMPLETED);
assert.equal(job.continuationNeeded, false);

job = assessRun(base(), { providerStatus: "completed", output: "need login\nSTATUS: NEEDS_USER", now: 2_000 });
assert.equal(job.status, JOB_STATES.INPUT_REQUIRED);

job = assessRun(base(), { providerStatus: "completed", output: "half\nSTATUS: PARTIAL", now: 2_000 });
assert.equal(job.status, JOB_STATES.CONTINUING);
assert.equal(job.continuationNeeded, true);

job = assessRun(base(), { providerStatus: "incomplete", output: "half", now: 2_000 });
assert.equal(job.status, JOB_STATES.CONTINUING);

let loop = base();
for (let i = 0; i < 3; i++) {
  loop = assessRun(loop, { providerStatus: "completed", output: "same\nSTATUS: PARTIAL", now: 2_000 + i });
}
assert.equal(loop.status, JOB_STATES.FAILED);
assert.equal(loop.safeErrorCode, "continuation_loop");

let budget = base();
budget.maxAttempts = 1;
budget = assessRun(budget, { providerStatus: "completed", output: "partial\nSTATUS: PARTIAL", now: 2_000 });
assert.equal(budget.status, JOB_STATES.BUDGET_EXHAUSTED);

const prompt = continuationPrompt("checkpoint text", 1, 4);
assert.match(prompt, /PREVIOUS CHECKPOINT/);
assert.match(prompt, /attempt 2 of at most 4/i);

console.log("durable job tests passed");
