import assert from "node:assert/strict";
import { createWatchdog } from "./watchdog.js";
import { MemoryJobStore } from "./durable_store.js";
import { JOB_STATES, newJobRecord } from "./durable_job.js";

const store = new MemoryJobStore();
const now = 100_000;

const queued = newJobRecord({
  id: "kgj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ownerSubjectHash: "ownerhash00000001",
  now: 1_000
});
queued.status = JOB_STATES.QUEUED;
queued.startLeaseUntil = 20_000;
await store.createOrGet({ job: queued, ownerSubjectHash: queued.ownerSubjectHash });

const working = newJobRecord({
  id: "kgj_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ownerSubjectHash: "ownerhash00000002",
  now: 1_000
});
working.status = JOB_STATES.WORKING;
working.providerSessionId = "sess_work";
await store.createOrGet({ job: working, ownerSubjectHash: working.ownerSubjectHash });

const fresh = newJobRecord({
  id: "kgj_cccccccccccccccccccccccccccccccc",
  ownerSubjectHash: "ownerhash00000003",
  now: 95_000
});
fresh.status = JOB_STATES.WORKING;
fresh.providerSessionId = "sess_fresh";
await store.createOrGet({ job: fresh, ownerSubjectHash: fresh.ownerSubjectHash });

const calls = [];
const orchestrator = {
  async reconcile(jobId) {
    calls.push(jobId);
    return { action: "working", job: await store.get(jobId) };
  }
};

const watchdog = createWatchdog({
  store,
  orchestrator,
  now: () => now,
  staleAfterMs: 30_000
});

const result = await watchdog.runOnce();
assert.equal(result.checked, 2);
assert.deepEqual(calls, ["kgj_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);

const failedStart = await store.get("kgj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
assert.equal(failedStart.status, JOB_STATES.FAILED);
assert.equal(failedStart.safeErrorCode, "ambiguous_start_outcome");

const untouchedFresh = await store.get("kgj_cccccccccccccccccccccccccccccccc");
assert.equal(untouchedFresh.status, JOB_STATES.WORKING);


// Retention cleanup runs on its own cadence and never deletes active jobs.
{
  const retentionStore = new MemoryJobStore();
  const retentionNow = 200_000_000;

  const oldDone = newJobRecord({
    id: "kgj_dddddddddddddddddddddddddddddddd",
    ownerSubjectHash: "ownerhash00000004",
    now: 1_000
  });
  oldDone.status = JOB_STATES.COMPLETED;
  oldDone.updatedAt = 1_000;
  await retentionStore.createOrGet({ job: oldDone, ownerSubjectHash: oldDone.ownerSubjectHash });

  const oldActive = newJobRecord({
    id: "kgj_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ownerSubjectHash: "ownerhash00000005",
    now: 1_000
  });
  oldActive.status = JOB_STATES.WORKING;
  oldActive.providerSessionId = "sess_old_active";
  oldActive.updatedAt = 1_000;
  await retentionStore.createOrGet({ job: oldActive, ownerSubjectHash: oldActive.ownerSubjectHash });

  const retentionWatchdog = createWatchdog({
    store: retentionStore,
    orchestrator: {
      async reconcile(jobId) {
        return { action: "working", job: await retentionStore.get(jobId) };
      }
    },
    now: () => retentionNow,
    staleAfterMs: 30_000,
    cleanupEveryMs: 60_000,
    jobRetentionDays: 1
  });

  const firstCleanup = await retentionWatchdog.runOnce();
  assert.equal(firstCleanup.cleanup.deleted_jobs, 1);
  assert.equal(await retentionStore.get(oldDone.id), null);
  assert.equal((await retentionStore.get(oldActive.id)).status, JOB_STATES.WORKING);

  const secondCleanup = await retentionWatchdog.runOnce();
  assert.equal(secondCleanup.cleanup, null);
}

console.log("watchdog tests passed");
