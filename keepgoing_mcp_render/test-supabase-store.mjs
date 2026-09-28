import assert from "node:assert/strict";
import { SupabaseJobStore } from "./supabase_job_store.js";

const calls = [];
const baseRow = {
  job_id: "kgj_0123456789abcdef0123456789abcdef",
  owner_subject_hash: "1234567890abcdef",
  client_request_hash: "hash",
  engine: "agents",
  provider_session_id: null,
  status: "queued",
  version: 1,
  attempt: 0,
  max_attempts: 6,
  tokens_used: 0,
  token_budget_total: 120000,
  tool_calls_used: 0,
  tool_call_budget_total: 30,
  goal_hash: "goal",
  definition_hash: "done",
  completion_marker: null,
  continuation_needed: false,
  continuation_claim_id: null,
  start_lease_until: "2026-09-28T22:00:00.000Z",
  continuation_lease_until: null,
  repeated_output_count: 0,
  last_output_hash: null,
  safe_error_code: null,
  safe_error_message: null,
  started_at: "2026-09-28T21:00:00.000Z",
  updated_at: "2026-09-28T21:00:00.000Z",
  last_progress_at: "2026-09-28T21:00:00.000Z",
  wall_deadline_at: "2026-09-28T23:00:00.000Z"
};

const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  if (url.includes("/rpc/reserve_keepgoing_job")) {
    const body = JSON.parse(init.body);
    assert.equal(body.p_job_id, baseRow.job_id);
    assert.notEqual(body.p_client_request_hash, "req-secret");
    return reply([baseRow]);
  }
  if (init.method === "PATCH") {
    const body = JSON.parse(init.body);
    assert.equal(body.version, 2);
    return reply([{ ...baseRow, ...body }]);
  }
  if (url.includes("keepgoing_job_events")) return reply([{ id: 1 }]);
  return reply([baseRow]);
};

const store = new SupabaseJobStore({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "service-test",
  fetchImpl: fakeFetch
});

const reservation = await store.createOrGet({
  job: {
    id: baseRow.job_id,
    engine: "agents",
    goalHash: "goal",
    definitionHash: "done",
    maxAttempts: 6,
    tokenBudgetTotal: 120000,
    toolCallBudgetTotal: 30,
    wallDeadlineAt: Date.parse(baseRow.wall_deadline_at),
    startLeaseUntil: Date.parse(baseRow.start_lease_until)
  },
  ownerSubjectHash: baseRow.owner_subject_hash,
  clientRequestId: "req-secret"
});
assert.equal(reservation.created, true);
assert.equal(reservation.job.id, baseRow.job_id);

const saved = await store.compareAndSet(baseRow.job_id, 1, {
  ...reservation.job,
  status: "working",
  providerSessionId: "sess_abc",
  updatedAt: Date.parse("2026-09-28T21:01:00.000Z"),
  lastProgressAt: Date.parse("2026-09-28T21:01:00.000Z")
});
assert.equal(saved.ok, true);
assert.equal(saved.job.version, 2);
assert.equal(saved.job.providerSessionId, "sess_abc");

const event = await store.recordEvent({
  jobId: baseRow.job_id,
  providerEventId: "evt_1",
  eventType: "agent.session.idle",
  safeDetail: { source: "test" }
});
assert.equal(event.inserted, true);

assert.ok(calls.every((c) => c.init.headers.apikey === "service-test"));
console.log("supabase store tests passed");

function reply(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}
