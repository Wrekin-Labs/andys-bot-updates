const RECONCILE_EVENTS = new Set([
  "agent.session.idle",
  "agent.session.action_required",
  "agent.session.failed"
]);

export function createOpenAIWebhookVerifier({
  apiKey,
  webhookSecret,
  OpenAIClass = null
} = {}) {
  if (!apiKey) throw new Error("OpenAI API key required");
  if (!webhookSecret) throw new Error("OpenAI webhook secret required");
  // The OpenAI SDK is loaded lazily so the durable engine, watchdog and their
  // tests do not require it; only signature verification does.
  let clientPromise = OpenAIClass
    ? Promise.resolve(new OpenAIClass({ apiKey, webhookSecret }))
    : null;

  return async function verify(rawBody, headers) {
    if (typeof rawBody !== "string") throw new Error("raw webhook body must be text");
    if (!clientPromise) {
      clientPromise = import("openai").then(({ default: OpenAI }) => new OpenAI({ apiKey, webhookSecret }));
    }
    const client = await clientPromise;
    return client.webhooks.unwrap(rawBody, headers);
  };
}

export function createWebhookProcessor({ store, orchestrator, verify } = {}) {
  if (!store) throw new Error("store required");
  if (!orchestrator) throw new Error("orchestrator required");
  if (typeof verify !== "function") throw new Error("verify function required");

  async function ingest(rawBody, headers) {
    const event = await verify(rawBody, headers);
    const type = String(event?.type || "");
    const providerEventId =
      headerValue(headers, "webhook-id") ||
      String(event?.id || "").trim() ||
      null;
    const providerSessionId = sessionIdFromEvent(event);

    const job = providerSessionId && typeof store.findByProviderSessionId === "function"
      ? await store.findByProviderSessionId(providerSessionId)
      : null;

    const recorded = typeof store.recordEvent === "function"
      ? await store.recordEvent({
          jobId: job?.id || null,
          providerEventId,
          eventType: type || "unknown",
          safeDetail: compact({
            provider_session_id: providerSessionId,
            required_action_type: event?.data?.required_action?.type || null
          })
        })
      : { inserted: true };

    return {
      accepted: true,
      duplicate: recorded.inserted === false,
      providerEventId,
      providerSessionId,
      jobId: job?.id || null,
      eventType: type,
      shouldReconcile: Boolean(job?.id && RECONCILE_EVENTS.has(type))
    };
  }

  async function process(acceptedEvent) {
    if (!acceptedEvent || acceptedEvent.duplicate) {
      return { action: "duplicate" };
    }

    let jobId = acceptedEvent.jobId || null;
    if (!jobId && acceptedEvent.providerSessionId &&
        typeof store.findByProviderSessionId === "function") {
      const job = await store.findByProviderSessionId(acceptedEvent.providerSessionId);
      jobId = job?.id || null;
    }

    if (!jobId) {
      return { action: "orphan", reason: "job_not_attached_yet" };
    }
    if (!RECONCILE_EVENTS.has(acceptedEvent.eventType)) {
      return { action: "recorded", jobId };
    }

    return orchestrator.reconcile(jobId);
  }

  return { ingest, process };
}

export function sessionIdFromEvent(event) {
  const value =
    event?.data?.id ??
    event?.data?.session_id ??
    event?.session_id ??
    null;
  const id = String(value || "").trim();
  return /^sess_[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) {
      return Array.isArray(value) ? String(value[0] || "") : String(value || "");
    }
  }
  return "";
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}
