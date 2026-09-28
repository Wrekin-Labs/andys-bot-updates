import { JOB_STATES } from "./durable_job.js";

export function createWatchdog({
  store,
  orchestrator,
  now = () => Date.now(),
  staleAfterMs = 30_000,
  limit = 50
} = {}) {
  if (!store || typeof store.listRecoverableJobs !== "function") {
    throw new Error("recoverable job store required");
  }
  if (!orchestrator || typeof orchestrator.reconcile !== "function") {
    throw new Error("orchestrator required");
  }

  async function runOnce() {
    const currentTime = now();
    const jobs = await store.listRecoverableJobs({
      before: currentTime - Math.max(5_000, Number(staleAfterMs) || 30_000),
      limit
    });

    const results = [];
    for (const job of jobs) {
      try {
        if (job.status === JOB_STATES.QUEUED && !job.providerSessionId) {
          if (Number(job.startLeaseUntil || 0) > currentTime) {
            results.push({ job_id: job.id, action: "start_pending" });
            continue;
          }

          // A crash may have happened after the provider created a session but
          // before its ID was stored. Without provider-side idempotency for
          // session creation, creating another session could double-spend.
          const failed = {
            ...job,
            status: JOB_STATES.FAILED,
            startLeaseUntil: null,
            safeErrorCode: "ambiguous_start_outcome",
            safeErrorMessage: "KeepGoing could not safely confirm whether the initial model session was created.",
            updatedAt: currentTime
          };
          const saved = await store.compareAndSet(job.id, job.version, failed);
          results.push({
            job_id: job.id,
            action: saved.ok ? "failed_ambiguous_start" : "already_updated"
          });
          continue;
        }

        const result = await orchestrator.reconcile(job.id);
        results.push({ job_id: job.id, action: result.action });
      } catch (error) {
        results.push({
          job_id: job.id,
          action: "error",
          error: safeError(error)
        });
      }
    }

    return {
      checked: jobs.length,
      results
    };
  }

  return { runOnce };
}

function safeError(error) {
  const message = String(error?.message || "watchdog error");
  if (/password|token|secret|credential|authorization/i.test(message)) {
    return "KeepGoing recovery failed; inspect protected service logs.";
  }
  return message.slice(0, 240);
}
