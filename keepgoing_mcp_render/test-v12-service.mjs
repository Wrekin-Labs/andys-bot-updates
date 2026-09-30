import assert from "node:assert/strict";
import { createV12Service, planLimits } from "./v12_service.js";
import { MemoryJobStore } from "./durable_store.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";
import { createToolProfileRegistry } from "./tool_profiles.js";

let turn = 1;
const sent = [];
const viewedTurns = [];
const engine = {
  async createSession() { return { id: "sess_service" }; },
  async getSession() { return { status: "idle", required_actions: [] }; },
  async listItems() {
    return { data: [{ content: [{ type: "output_text", text: turn === 1 ? "half\nSTATUS: PARTIAL" : "done\nSTATUS: COMPLETED" }] }] };
  },
  async listTurnItems(_id, turnId) {
    viewedTurns.push(turnId);
    return {
      data: [{
        id: "message_" + turn,
        type: "message",
        turn_id: turnId,
        status: "completed",
        content: [{ type: "output_text", text: turn === 1 ? "half\nSTATUS: PARTIAL" : "done\nSTATUS: COMPLETED" }]
      }],
      found: true,
      truncated: false
    };
  },
  async listTurns() {
    return { data: [{ id: "turn_" + turn, status: "completed", subagent_id: null, usage: { total_tokens: 20 } }] };
  },
  async sendMessage(id, text, key) { sent.push({ id, text, key }); },
  async cancelTurn() {}
};

const store = new MemoryJobStore();
let clock = 1_000;
const orchestrator = new KeepGoingOrchestrator({ engine, store, now: () => ++clock });
const service = createV12Service({
  engine,
  store,
  orchestrator,
  model: "gpt-test",
  now: () => ++clock,
  sleep: async () => { clock += 2000; }
});

let quota = 0;
const started = await service.start({
  goal: "finish it",
  definitionOfDone: "done",
  ownerSubjectHash: "ownerhash",
  clientRequestId: "req-1",
  beforeCreateSession: async () => { quota++; }
});
assert.equal(started.status, JOB_STATES.WORKING);
assert.equal(quota, 1);
assert.equal("model" in started, false);
assert.equal("tier" in started, false);
assert.equal("limits" in started, false);

const ownedActive = await service.list("ownerhash", { activeOnly: true });
assert.equal(ownedActive.jobs.length, 1);
assert.equal(ownedActive.jobs[0].job_id, started.job_id);
assert.equal(ownedActive.jobs[0].tool_profile, "web");
const otherOwner = await service.list("different-owner", { activeOnly: false });
assert.equal(otherOwner.jobs.length, 0);

const duplicate = await service.start({
  goal: "finish it",
  definitionOfDone: "done",
  ownerSubjectHash: "ownerhash",
  clientRequestId: "req-1",
  beforeCreateSession: async () => { quota++; }
});
assert.equal(duplicate.duplicate, true);
assert.equal(quota, 1);

await orchestrator.reconcile(started.job_id);
assert.equal(sent.length, 1);

turn = 2;
await orchestrator.reconcile(started.job_id);
viewedTurns.length = 0;
const finished = await service.get(started.job_id, "ownerhash");
assert.equal(finished.status, JOB_STATES.COMPLETED);
assert.equal(finished.tool_profile, "web");
assert.match(finished.output, /COMPLETED/);
assert.deepEqual(viewedTurns, ["turn_2"]);
assert.deepEqual(Object.keys(finished.progress).sort(), ["attempt", "max_attempts"]);
assert.equal("incomplete_details" in finished, false);
assert.equal("tokens_used" in finished.progress, false);

const noLongerActive = await service.list("ownerhash", { activeOnly: true });
assert.equal(noLongerActive.jobs.length, 0);
const recentAll = await service.list("ownerhash", { activeOnly: false });
assert.equal(recentAll.jobs.some((job) => job.job_id === started.job_id), true);

await assert.rejects(
  () => service.get(started.job_id, "different-owner"),
  /not found/i
);

const paused = newJobRecord({
  id: "kgj_dddddddddddddddddddddddddddddddd",
  ownerSubjectHash: "ownerhash",
  now: 5_000
});
paused.status = JOB_STATES.INPUT_REQUIRED;
paused.providerSessionId = "sess_service";
paused.lastAssessedTurnId = "turn_pause";
await store.createOrGet({ job: paused, ownerSubjectHash: "ownerhash" });

const resumed = await service.resume(
  paused.id,
  "Here is the missing information",
  "ownerhash"
);
assert.equal(resumed.status, JOB_STATES.WORKING);
assert.equal(sent.at(-1).id, "sess_service");
assert.match(sent.at(-1).key, /^kg-user-/);


// Concurrent user-input resumes: only one delivery may reach the provider.
{
  const raceStore = new MemoryJobStore();
  let releaseSend;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  let sendCount = 0;
  const raceEngine = {
    async createSession() { return { id: "sess_race" }; },
    async getSession() { return { status: "idle", required_actions: [] }; },
    async listItems() { return { data: [] }; },
    async listTurns() { return { data: [] }; },
    async sendMessage() {
      sendCount++;
      await sendGate;
    },
    async cancelTurn() {}
  };
  let raceClock = 10_000;
  const raceOrchestrator = new KeepGoingOrchestrator({
    engine: raceEngine,
    store: raceStore,
    now: () => ++raceClock
  });
  const raceService = createV12Service({
    engine: raceEngine,
    store: raceStore,
    orchestrator: raceOrchestrator,
    now: () => ++raceClock,
    sleep: async () => {}
  });
  const raceJob = newJobRecord({
    id: "kgj_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ownerSubjectHash: "ownerhash",
    now: 10_000
  });
  raceJob.status = JOB_STATES.INPUT_REQUIRED;
  raceJob.providerSessionId = "sess_race";
  raceJob.lastAssessedTurnId = "turn_race";
  await raceStore.createOrGet({ job: raceJob, ownerSubjectHash: "ownerhash" });

  const firstResume = raceService.resume(raceJob.id, "same answer", "ownerhash");
  await new Promise((resolve) => setImmediate(resolve));
  const secondResume = await raceService.resume(raceJob.id, "same answer", "ownerhash");
  assert.equal(sendCount, 1);
  assert.match(secondResume.message, /already being delivered/i);
  releaseSend();
  const firstResult = await firstResume;
  assert.equal(firstResult.status, JOB_STATES.WORKING);
}

// If delivery outcome is unknown, only the exact same input may be retried,
// and it reuses the same provider idempotency key.
{
  const retryStore = new MemoryJobStore();
  let fail = true;
  const keys = [];
  const retryEngine = {
    async createSession() { return { id: "sess_retry" }; },
    async getSession() { return { status: "idle", required_actions: [] }; },
    async listItems() { return { data: [] }; },
    async listTurns() { return { data: [] }; },
    async sendMessage(_id, _text, key) {
      keys.push(key);
      if (fail) {
        fail = false;
        throw new Error("connection dropped");
      }
    },
    async cancelTurn() {}
  };
  let retryClock = 20_000;
  const retryOrchestrator = new KeepGoingOrchestrator({
    engine: retryEngine,
    store: retryStore,
    now: () => ++retryClock
  });
  const retryService = createV12Service({
    engine: retryEngine,
    store: retryStore,
    orchestrator: retryOrchestrator,
    now: () => ++retryClock,
    sleep: async () => {}
  });
  const retryJob = newJobRecord({
    id: "kgj_ffffffffffffffffffffffffffffffff",
    ownerSubjectHash: "ownerhash",
    now: 20_000
  });
  retryJob.status = JOB_STATES.INPUT_REQUIRED;
  retryJob.providerSessionId = "sess_retry";
  retryJob.lastAssessedTurnId = "turn_retry";
  await retryStore.createOrGet({ job: retryJob, ownerSubjectHash: "ownerhash" });

  await assert.rejects(
    () => retryService.resume(retryJob.id, "answer one", "ownerhash"),
    /connection dropped/
  );
  const afterUnknown = await retryStore.get(retryJob.id);
  assert.equal(afterUnknown.status, JOB_STATES.INPUT_REQUIRED);
  assert.equal(afterUnknown.safeErrorCode, "user_input_send_unknown");

  await assert.rejects(
    () => retryService.resume(retryJob.id, "different answer", "ownerhash"),
    /Previous user input delivery is unresolved/
  );

  const retriedInput = await retryService.resume(retryJob.id, "answer one", "ownerhash");
  assert.equal(retriedInput.status, JOB_STATES.WORKING);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
}


// Job recovery listing is owner-scoped and does not expose prompt content.
{
  const other = newJobRecord({
    id: "kgj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ownerSubjectHash: "other-owner",
    now: 30_000
  });
  other.status = JOB_STATES.WORKING;
  await store.createOrGet({ job: other, ownerSubjectHash: "other-owner" });

  const listed = await service.list("ownerhash", { limit: 20, activeOnly: false });
  assert.ok(listed.jobs.some((job) => job.job_id === started.job_id));
  assert.ok(listed.jobs.some((job) => job.job_id === paused.id));
  assert.ok(!listed.jobs.some((job) => job.job_id === other.id));
  assert.ok(listed.jobs.every((job) =>
    !("goal" in job) &&
    !("definitionOfDone" in job) &&
    !("started_at" in job) &&
    !("updated_at" in job) &&
    !("completion_marker" in job)
  ));

  const active = await service.list("ownerhash", { limit: 20, activeOnly: true });
  assert.ok(active.jobs.some((job) => job.job_id === paused.id));
  assert.ok(!active.jobs.some((job) => job.job_id === started.job_id));
}

// Tool profiles reach the durable Agents session with owner-only writes gated.
{
  const toolRegistry = createToolProfileRegistry({
    rawJson: JSON.stringify({
      profiles: {
        "developer-owner": {
          ownerOnly: true,
          writeCapable: true,
          allowWeb: false,
          maxToolCalls: 20,
          servers: [{
            label: "github",
            url: "https://mcp.example.com/github",
            authorization_env: "TEST_GITHUB_MCP_AUTH",
            allowed_tools: ["search", "fetch_file", "update_file"]
          }]
        }
      }
    }),
    env: { TEST_GITHUB_MCP_AUTH: "Bearer test-secret" }
  });

  const captured = [];
  const profileEngine = {
    async createSession(args) {
      captured.push(args);
      return { id: "sess_tools" };
    },
    async cancelTurn() {}
  };
  const profileStore = new MemoryJobStore();
  let profileClock = 40_000;
  const profileOrchestrator = new KeepGoingOrchestrator({
    engine: profileEngine,
    store: profileStore,
    now: () => ++profileClock
  });
  const profileService = createV12Service({
    engine: profileEngine,
    store: profileStore,
    orchestrator: profileOrchestrator,
    toolProfiles: toolRegistry,
    now: () => ++profileClock
  });

  const publicProfiles = profileService.listToolProfiles(false);
  assert.ok(publicProfiles.profiles.some((p) => p.name === "web"));
  assert.ok(!publicProfiles.profiles.some((p) => p.name === "developer-owner"));

  const ownerProfiles = profileService.listToolProfiles(true);
  assert.ok(ownerProfiles.profiles.some((p) => p.name === "developer-owner"));

  await assert.rejects(
    () => profileService.start({
      goal: "edit code",
      ownerSubjectHash: "customer-owner",
      tier: "business",
      admin: false,
      toolProfile: "developer-owner"
    }),
    /owner-only/
  );
  assert.equal(captured.length, 0);

  const toolJob = await profileService.start({
    goal: "edit code",
    ownerSubjectHash: "real-owner",
    tier: "owner",
    admin: true,
    allowWeb: false,
    toolProfile: "developer-owner",
    clientRequestId: "tool-job-1"
  });
  assert.equal(toolJob.tool_profile, "developer-owner");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].allowWeb, false);
  assert.equal(captured[0].mcpTools.length, 1);
  assert.deepEqual(captured[0].mcpTools[0].allowed_tools, ["search", "fetch_file", "update_file"]);
  assert.equal(captured[0].mcpTools[0].transport.authorization, "Bearer test-secret");

  const storedToolJob = await profileStore.get(toolJob.job_id);
  assert.equal(storedToolJob.toolCallBudgetTotal, 20);
assert.equal(storedToolJob.toolProfileName, "developer-owner");
assert.equal(storedToolJob.toolWriteCapable, true);
assert.ok(/^[0-9a-f]{64}$/.test(storedToolJob.toolPolicyHash));
}

const limits = planLimits("business", true);
assert.equal(limits.max_attempts, 8);
assert.equal(limits.max_total_tokens, 30_000);
assert.equal(limits.max_total_tool_calls, 5);

const proLimits = planLimits("pro", true);
assert.equal(proLimits.max_attempts, 6);
assert.equal(proLimits.max_total_tokens, 20_000);
assert.equal(proLimits.max_total_tool_calls, 3);

const offlineLimits = planLimits("pro", false);
assert.equal(offlineLimits.max_total_tool_calls, 0);

const externalOnly = planLimits("pro", false, true);
assert.equal(externalOnly.max_total_tool_calls, 3);

const ownerToolLimits = planLimits("owner", false, true);
assert.equal(ownerToolLimits.max_attempts, 12);
assert.equal(ownerToolLimits.max_total_tokens, 60_000);
assert.equal(ownerToolLimits.max_total_tool_calls, 40);

console.log("v1.2 service tests passed");
