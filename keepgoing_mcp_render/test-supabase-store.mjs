import assert from "node:assert/strict";
import { SupabaseJobStore } from "./supabase_job_store.js";

const calls = [];
const baseRow = {
  job_id: "kgj_0123456789abcdef0123456789abcdef",
  owner_subject_hash: "1234567890abcdef",
  client_request_hash: "hash",
  engine: "agents",
  tool_profile: "developer-owner",
  tool_policy_hash: "a".repeat(64),
  tool_write_capable: true,
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
    assert.equal(body.p_tool_profile, "developer-owner");
    assert.equal(body.p_tool_policy_hash, "a".repeat(64));
    assert.equal(body.p_tool_write_capable, true);
    return reply([baseRow]);
  }
  if (url.includes("/rpc/cleanup_keepgoing_durable_state")) {
    const body = JSON.parse(init.body);
    assert.equal(body.p_job_retention_days, 30);
    assert.equal(body.p_event_retention_days, 14);
    return reply([{ deleted_jobs: 2, deleted_events: 4 }]);
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

const health = await store.healthCheck();
assert.deepEqual(health, { ok: true });
assert.ok(calls.some((c) => c.url.includes("keepgoing_jobs?select=job_id,tool_profile,tool_policy_hash,tool_write_capable&limit=1")));
assert.ok(calls.some((c) => c.url.includes("keepgoing_job_events?select=id&limit=1")));

const reservation = await store.createOrGet({
  job: {
    id: baseRow.job_id,
    engine: "agents",
    goalHash: "goal",
    definitionHash: "done",
    toolProfileName: "developer-owner",
    toolPolicyHash: "a".repeat(64),
    toolWriteCapable: true,
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
assert.equal(reservation.job.toolProfileName, "developer-owner");
assert.equal(reservation.job.toolPolicyHash, "a".repeat(64));
assert.equal(reservation.job.toolWriteCapable, true);

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

const listed = await store.listOwnerJobs(baseRow.owner_subject_hash, {
  limit: 10,
  activeOnly: true
});
assert.equal(listed.length, 1);
assert.equal(listed[0].id, baseRow.job_id);
const listCall = calls.find((c) =>
  c.url.includes("owner_subject_hash=eq.") &&
  c.url.includes("status=in.%28queued%2Cworking%2Ccontinuing%2Cinput_required%29")
);
assert.ok(listCall, "owner-scoped active job query was not issued");
assert.ok(listCall.url.includes("limit=10"));

const cleanup = await store.cleanupRetention({
  jobRetentionDays: 30,
  eventRetentionDays: 14
});
assert.deepEqual(cleanup, { deleted_jobs: 2, deleted_events: 4 });

const event = await store.recordEvent({
  jobId: baseRow.job_id,
  providerEventId: "evt_1",
  eventType: "agent.session.idle",
  safeDetail: { source: "test" }
});
assert.equal(event.inserted, true);

assert.ok(calls.every((c) => c.init.headers.apikey === "service-test"));

// The durable store can also use a narrow server-to-server proxy so Render
// never needs the Supabase service-role key.
const proxyCalls = [];
const proxyFetch = async (url, init) => {
  proxyCalls.push({ url, init });
  assert.equal(url, "https://example.supabase.co/functions/v1/keepgoing-durable-store");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-keepgoing-ingest-token"], "bridge-token");
  const envelope = JSON.parse(init.body);
  assert.match(envelope.path, /^\/rest\/v1\/keepgoing_/);
  assert.equal(typeof envelope.method, "string");
  return reply(envelope.path.includes("keepgoing_job_events") ? [{ id: 1 }] : [baseRow]);
};
const proxyStore = new SupabaseJobStore({
  proxyUrl: "https://example.supabase.co/functions/v1/keepgoing-durable-store",
  proxyToken: "bridge-token",
  fetchImpl: proxyFetch
});
assert.deepEqual(await proxyStore.healthCheck(), { ok: true });
assert.equal(proxyCalls.length, 2);
assert.ok(proxyCalls.some((c) => JSON.parse(c.init.body).path.includes("keepgoing_jobs?select=job_id,tool_profile,tool_policy_hash,tool_write_capable&limit=1")));
assert.ok(proxyCalls.some((c) => JSON.parse(c.init.body).path.includes("keepgoing_job_events?select=id&limit=1")));

assert.throws(
  () => new SupabaseJobStore({ fetchImpl: fakeFetch }),
  /direct credentials or durable-store proxy required/
);

console.log("supabase store tests passed");

function reply(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}
