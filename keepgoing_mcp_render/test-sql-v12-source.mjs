import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./sql/durable_jobs.sql", import.meta.url), "utf8");

assert.match(sql, /alter table public\.keepgoing_jobs enable row level security;/i);
assert.match(sql, /revoke all on table public\.keepgoing_jobs from public, anon, authenticated;/i);
assert.match(sql, /grant select, insert, update, delete on table public\.keepgoing_jobs to service_role;/i);

assert.match(sql, /alter table public\.keepgoing_job_events enable row level security;/i);
assert.match(sql, /revoke all on table public\.keepgoing_job_events from public, anon, authenticated;/i);
assert.match(sql, /grant select, insert, update, delete on table public\.keepgoing_job_events to service_role;/i);

assert.match(sql, /tool_profile text not null default 'web'/i);
assert.match(sql, /tool_policy_hash text/i);
assert.match(sql, /tool_write_capable boolean not null default false/i);
assert.match(sql, /create or replace function public\.reserve_keepgoing_job/i);
assert.match(sql, /p_tool_profile text/i);
assert.match(sql, /p_tool_policy_hash text/i);
assert.match(sql, /p_tool_write_capable boolean/i);
assert.match(sql, /on conflict \(owner_subject_hash, client_request_hash\) do nothing;/i);
assert.match(sql, /security invoker\s+set search_path = public, pg_temp/i);
assert.match(sql, /grant execute on function public\.reserve_keepgoing_job[\s\S]*to service_role;/i);

assert.match(sql, /create or replace function public\.cleanup_keepgoing_durable_state/i);
assert.match(sql, /status in \('completed', 'failed', 'cancelled', 'budget_exhausted'\)/i);
assert.match(sql, /created_at < now\(\) - make_interval\(days => p_event_retention_days\)/i);
assert.match(sql, /grant execute on function public\.cleanup_keepgoing_durable_state\(integer, integer\)[\s\S]*to service_role;/i);

assert.doesNotMatch(sql, /\braw_prompt\b|\bprompt_text\b|\bmodel_output\b|\boauth_token\b|\bactivation_token\b/i);

console.log("durable jobs SQL security guards passed");
