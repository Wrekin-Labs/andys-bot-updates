import { JOB_STATES } from "./durable_job.js";

export function createWatchdog({
  store,
  orchestrator,
  now = () => Date.now(),
  staleAfterMs = 30_000,
  limit = 50,
  cleanupEveryMs = 24 * 60 * 60 * 1000,
  jobRetentionDays = 30,
  eventRetentionDays = 14
} = {}) {
  if (!store || typeof store.listRecoverableJobs !== "function") {
    throw new Error("recoverable job store required");
  }
  if (!orchestrator || typeof orchestrator.reconcile !== "function") {
    throw new Error("orchestrator required");
  }

  let lastCleanupAt = 0;

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
          if (typeof orchestrator.recoverStart === "function") {
            const recovered = await orchestrator.recoverStart(job.id);
            results.push({ job_id: job.id, action: recovered.action });
            continue;
          }
          results.push({ job_id: job.id, action: "recovery_unavailable" });
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

    let cleanup = null;
    const cleanupInterval = Math.max(60_000, Number(cleanupEveryMs) || 24 * 60 * 60 * 1000);
    if (
      typeof store.cleanupRetention === "function" &&
      currentTime - lastCleanupAt >= cleanupInterval
    ) {
      lastCleanupAt = currentTime;
      try {
        cleanup = await store.cleanupRetention({
          now: currentTime,
          jobRetentionDays,
          eventRetentionDays
        });
      } catch (error) {
        cleanup = { error: safeError(error) };
      }
    }

    return {
      checked: jobs.length,
      results,
      cleanup
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
