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

  async function sendMessage(sessionId, text) {
    requireSessionId(sessionId);
    const value = String(text || "").trim();
    if (!value) throw new Error("message required");
    return request("/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
      method: "POST",
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

  async function cancelTurn(sessionId) {
    requireSessionId(sessionId);
    return request("/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
      method: "POST",
      body: JSON.stringify({
        events: [{ type: "agent.session.input.cancel" }]
      })
    });
  }

  return { createSession, getSession, listItems, sendMessage, cancelTurn };
}

export function latestSessionText(itemsResponse) {
  const items = Array.isArray(itemsResponse)
    ? itemsResponse
    : Array.isArray(itemsResponse?.data) ? itemsResponse.data
    : Array.isArray(itemsResponse?.items) ? itemsResponse.items
    : [];

  for (let i = items.length - 1; i >= 0; i--) {
    const texts = [];
    collectText(items[i], texts);
    const value = texts.filter(Boolean).join("\n").trim();
    if (value) return value;
  }
  return "";
}

export function classifySession(session, latestText = "") {
  const status = String(session?.status || "").toLowerCase();
  const required = session?.required_actions;
  if (Array.isArray(required) && required.length > 0) {
    return { providerStatus: "action_required", output: latestText };
  }
  if (status === "failed") return { providerStatus: "failed", output: latestText };
  if (status === "cancelled") return { providerStatus: "cancelled", output: latestText };
  if (status === "idle") return { providerStatus: "completed", output: latestText };
  return { providerStatus: "working", output: latestText };
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

function requireSessionId(sessionId) {
  const value = String(sessionId || "").trim();
  if (!/^sess_[A-Za-z0-9_-]+$/.test(value)) throw new Error("valid session id required");
}
