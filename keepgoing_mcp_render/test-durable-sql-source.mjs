import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobs = readFileSync(new URL("./sql/durable_jobs.sql", import.meta.url), "utf8");
const retention = readFileSync(new URL("./sql/durable_retention.sql", import.meta.url), "utf8");
const all = jobs + "\n" + retention;

assert.match(jobs, /alter table public\.keepgoing_jobs enable row level security/i);
assert.match(jobs, /alter table public\.keepgoing_job_events enable row level security/i);
assert.match(jobs, /revoke all on table public\.keepgoing_jobs from public, anon, authenticated/i);
assert.match(jobs, /revoke all on table public\.keepgoing_job_events from public, anon, authenticated/i);
assert.match(jobs, /security invoker/i);
assert.match(jobs, /agents-dev:c/i);
assert.match(jobs, /keepgoing_jobs_engine_check/i);
assert.match(retention, /security invoker/i);
assert.doesNotMatch(all, /security definer/i);
assert.match(retention, /status in \('completed', 'failed', 'cancelled', 'budget_exhausted'\)/i);
assert.doesNotMatch(retention, /status in \([^)]*input_required/i);

console.log("durable SQL security guards passed");
