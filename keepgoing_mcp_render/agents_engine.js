const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createAgentsEngine({
  apiKey,
  model = "gpt-6-astra",
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!apiKey) throw new Error("OpenAI API key required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");

  async function request(path, init = {}) {
    const response = await fetchImpl(baseUrl + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + apiKey,
        "OpenAI-Beta": "agents=v1",
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || ("Agents API request failed (" + response.status + ")"));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function createSession({
    prompt,
    instructions,
    allowWeb = true,
    reasoningEffort = "medium",
    metadata = {}
  }) {
    if (!String(prompt || "").trim()) throw new Error("prompt required");
    const agent = {
      model,
      instructions: String(instructions || "").trim() || undefined,
      reasoning: { effort: reasoningEffort }
    };
    if (allowWeb) {
      agent.tools = [{ type: "web_search", mode: "live" }];
    }
    const body = {
      agent,
      environment: { type: "none" },
      input: String(prompt),
      metadata
    };
    return request("/agents/sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async function getSession(sessionId) {
    requireSessionId(sessionId);
    return request("/agents/sessions/" + encodeURIComponent(sessionId), { method: "GET" });
  }

  async function listItems(sessionId, { order = "asc", limit = 100 } = {}) {
    requireSessionId(sessionId);
    const safeOrder = order === "desc" ? "desc" : "asc";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    return request(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/items?order=" + safeOrder + "&limit=" + safeLimit,
      { method: "GET" }
    );
  }

  async function listTurns(sessionId, { order = "desc", limit = 10 } = {}) {
    requireSessionId(sessionId);
    const safeOrder = order === "asc" ? "asc" : "desc";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    return request(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/turns?order=" + safeOrder + "&limit=" + safeLimit,
      { method: "GET" }
    );
  }

  async function sendMessage(sessionId, text, idempotencyKey = null) {
    requireSessionId(sessionId);
    const value = String(text || "").trim();
    if (!value) throw new Error("message required");
    const key = normaliseIdempotencyKey(idempotencyKey);
    return request("/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : undefined,
      body: JSON.stringify({
        events: [{
          type: "agent.session.input.message",
          input: [{
            role: "user",
            content: [{ type: "input_text", text: value }]
          }]
        }]
      })
    });
  }

  async function cancelTurn(sessionId, idempotencyKey = null) {
    requireSessionId(sessionId);
    const key = normaliseIdempotencyKey(idempotencyKey);
    return request("/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : undefined,
      body: JSON.stringify({
        events: [{ type: "agent.session.input.cancel" }]
      })
    });
  }

  return { createSession, getSession, listItems, listTurns, sendMessage, cancelTurn };
}

export function latestSessionText(itemsResponse) {
  const items = collection(itemsResponse);

  for (let i = items.length - 1; i >= 0; i--) {
    const texts = [];
    collectText(items[i], texts);
    const value = texts.filter(Boolean).join("\n").trim();
    if (value) return value;
  }
  return "";
}

export function latestRootTurn(turnsResponse) {
  const turns = collection(turnsResponse);
  if (!turns.length) return null;
  return turns.find((turn) => turn?.subagent_id == null) || turns[0] || null;
}

export function classifySession(session, latestText = "", turnsResponse = null, itemsResponse = null) {
  const status = String(session?.status || "").toLowerCase();
  const required = session?.required_actions;
  if (Array.isArray(required) && required.length > 0) {
    return { providerStatus: "action_required", output: latestText, turnId: null, tokensUsed: 0 };
  }
  if (status === "failed") {
    return { providerStatus: "failed", output: latestText, turnId: null, tokensUsed: 0 };
  }

  const turn = latestRootTurn(turnsResponse);
  const turnStatus = String(turn?.status || "").toLowerCase();
  const tokensUsed = turnTokens(turn);

  if (turnStatus === "completed") {
    const failedWork = turnHasFailedWork(itemsResponse, turn?.id || null);
    return {
      providerStatus: failedWork ? "incomplete" : "completed",
      output: latestText,
      turnId: turn?.id || null,
      tokensUsed,
      toolFailureDetected: failedWork
    };
  }
  if (turnStatus === "failed") {
    return { providerStatus: "failed", output: latestText, turnId: turn?.id || null, tokensUsed };
  }
  if (turnStatus === "cancelled") {
    return { providerStatus: "cancelled", output: latestText, turnId: turn?.id || null, tokensUsed };
  }
  if (["queued", "in_progress", "waiting"].includes(turnStatus)) {
    return { providerStatus: "working", output: latestText, turnId: turn?.id || null, tokensUsed };
  }

  // Session idle means no turn is currently running; it does not prove the
  // last turn succeeded. Without a terminal root turn, fail safe as working.
  return { providerStatus: "working", output: latestText, turnId: turn?.id || null, tokensUsed };
}

export function turnHasFailedWork(itemsResponse, turnId = null) {
  const failedStatuses = new Set(["failed", "incomplete"]);
  return collection(itemsResponse).some((item) => {
    if (turnId && item?.turn_id && item.turn_id !== turnId) return false;
    const status = String(item?.status || "").toLowerCase();
    if (!failedStatuses.has(status)) return false;
    const type = String(item?.type || "").toLowerCase();
    return (
      type.includes("call") ||
      type.includes("tool") ||
      type.includes("execution") ||
      type.includes("search")
    );
  });
}

function collection(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  return [];
}

function turnTokens(turn) {
  const usage = turn?.usage;
  if (!usage || typeof usage !== "object") return 0;
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total >= 0) return Math.trunc(total);
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  const sum = (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
  return Math.max(0, Math.trunc(sum));
}

function collectText(value, out) {
  if (value == null) return;
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (typeof value !== "object") return;

  if (typeof value.text === "string" &&
      (value.type === "output_text" || value.type === "text" || value.type === "input_text")) {
    out.push(value.text);
  }
  if (typeof value.output_text === "string") out.push(value.output_text);

  for (const [key, child] of Object.entries(value)) {
    if (key === "text" || key === "output_text") continue;
    if (key === "metadata") continue;
    collectText(child, out);
  }
}

function normaliseIdempotencyKey(value) {
  if (value == null || value === "") return null;
  const key = String(value);
  if (key.length < 1 || key.length > 256) throw new Error("valid idempotency key required");
  if (/[\r\n\0]/.test(key)) throw new Error("valid idempotency key required");
  return key;
}

function requireSessionId(sessionId) {
  const value = String(sessionId || "").trim();
  if (!/^sess_[A-Za-z0-9_-]+$/.test(value)) throw new Error("valid session id required");
}
