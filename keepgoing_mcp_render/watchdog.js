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
  let inFlight = null;
  let consecutiveFailures = 0;

  // setInterval does not wait for async work. Without this guard a slow pass
  // (50 jobs x several provider calls) overlapped the next tick and the same
  // jobs were reconciled concurrently in one process.
  function runOnce() {
    if (inFlight) return Promise.resolve({ skipped: true, reason: "previous_run_in_progress" });
    inFlight = runPass()
      .then((result) => { consecutiveFailures = 0; return result; })
      .catch((error) => { consecutiveFailures += 1; throw error; })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Resolves when no pass is running (used for graceful shutdown). */
  async function idle() {
    if (inFlight) {
      try { await inFlight; } catch {}
    }
  }

  function status() {
    return { running: Boolean(inFlight), consecutive_failures: consecutiveFailures };
  }

  async function runPass() {
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
        let deferred = null;
        if (typeof orchestrator.recordRecoveryFailure === "function") {
          try {
            deferred = await orchestrator.recordRecoveryFailure(job.id, error);
          } catch {}
        }
        results.push({
          job_id: job.id,
          action: deferred?.action === "dead_lettered" ? "dead_lettered" : "error",
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

  return { runOnce, idle, status };
}

function safeError(error) {
  const message = String(error?.message || "watchdog error");
  if (/password|token|secret|credential|authorization/i.test(message)) {
    return "KeepGoing recovery failed; inspect protected service logs.";
  }
  return message.slice(0, 240);
}
