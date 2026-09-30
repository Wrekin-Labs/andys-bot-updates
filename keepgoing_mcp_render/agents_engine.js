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
    metadata = {},
    idempotencyKey = null,
    workspace = null
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
      environment: buildAgentEnvironment(workspace),
      input: String(prompt),
      metadata
    };
    const key = normaliseIdempotencyKey(idempotencyKey);
    return request("/agents/sessions", {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : undefined,
      body: JSON.stringify(body)
    });
  }

  async function getSession(sessionId) {
    requireSessionId(sessionId);
    return request("/agents/sessions/" + encodeURIComponent(sessionId), { method: "GET" });
  }

  async function listSessions({ order = "desc", limit = 100, after = null } = {}) {
    const safeOrder = order === "asc" ? "asc" : "desc";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const query = new URLSearchParams({
      order: safeOrder,
      limit: String(safeLimit)
    });
    if (after) query.set("after", String(after));
    return request("/agents/sessions?" + query.toString(), { method: "GET" });
  }

  async function findSessionByMetadata(key, value, { maxPages = 3, pageSize = 100 } = {}) {
    const metadataKey = String(key || "").trim();
    const metadataValue = String(value || "");
    if (!metadataKey || !metadataValue) throw new Error("metadata key and value required");
    const pages = Math.max(1, Math.min(10, Number(maxPages) || 3));
    let after = null;

    for (let page = 0; page < pages; page++) {
      const result = await listSessions({ order: "desc", limit: pageSize, after });
      for (const session of collection(result)) {
        if (String(session?.metadata?.[metadataKey] || "") === metadataValue) {
          return session;
        }
      }
      if (!result?.has_more) return null;
      const next = String(result?.last_id || "").trim();
      if (!next || next === after) return null;
      after = next;
    }
    return null;
  }

  async function listItems(sessionId, { order = "asc", limit = 100, after = null } = {}) {
    requireSessionId(sessionId);
    const safeOrder = order === "desc" ? "desc" : "asc";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const query = new URLSearchParams({
      order: safeOrder,
      limit: String(safeLimit)
    });
    if (after) query.set("after", String(after));
    return request(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/items?" + query.toString(),
      { method: "GET" }
    );
  }

  async function listAllItems(sessionId, {
    order = "asc",
    pageSize = 100,
    maxPages = 5
  } = {}) {
    requireSessionId(sessionId);
    const pages = Math.max(1, Math.min(10, Number(maxPages) || 5));
    const data = [];
    let after = null;
    let hasMore = false;

    for (let page = 0; page < pages; page++) {
      const result = await listItems(sessionId, {
        order,
        limit: pageSize,
        after
      });
      const rows = collection(result);
      data.push(...rows);
      hasMore = Boolean(result?.has_more);
      if (!hasMore) break;
      const next = String(result?.last_id || "").trim();
      if (!next || next === after) break;
      after = next;
    }

    return {
      data,
      has_more: hasMore,
      truncated: hasMore,
      last_id: after
    };
  }

  async function listTurnItems(sessionId, turnId, {
    pageSize = 100,
    maxPages = 10
  } = {}) {
    requireSessionId(sessionId);
    const target = String(turnId || "").trim();
    if (!/^turn_[A-Za-z0-9_-]+$/.test(target)) {
      throw new Error("valid turn id required");
    }

    const pages = Math.max(1, Math.min(20, Number(maxPages) || 10));
    const data = [];
    let after = null;
    let hasMore = false;
    let sawTarget = false;
    let crossedIntoOlderTurn = false;

    for (let page = 0; page < pages; page++) {
      const result = await listItems(sessionId, {
        order: "desc",
        limit: pageSize,
        after
      });
      const rows = collection(result);

      for (const item of rows) {
        const itemTurn = String(item?.turn_id || "");
        if (itemTurn === target) {
          sawTarget = true;
          data.push(item);
          continue;
        }

        // Items are newest-first. Once target-turn items have been observed,
        // the first different turn means subsequent items are older and cannot
        // belong to the target turn.
        if (sawTarget && itemTurn && itemTurn !== target) {
          crossedIntoOlderTurn = true;
          break;
        }
      }

      if (crossedIntoOlderTurn) {
        hasMore = false;
        break;
      }

      hasMore = Boolean(result?.has_more);
      if (!hasMore) break;

      const next = String(result?.last_id || "").trim();
      if (!next || next === after) break;
      after = next;
    }

    // Preserve the ascending item order expected by latestSessionText and
    // existing classification helpers.
    data.reverse();

    return {
      data,
      has_more: hasMore && !crossedIntoOlderTurn,
      truncated: hasMore && !crossedIntoOlderTurn,
      last_id: after,
      turn_id: target,
      found: sawTarget
    };
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

  return { createSession, getSession, listSessions, findSessionByMetadata, listItems, listAllItems, listTurnItems, listTurns, sendMessage, cancelTurn };
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
      toolCallsUsed: turnToolCallCount(itemsResponse, turn?.id || null),
      toolFailureDetected: failedWork
    };
  }
  if (turnStatus === "failed") {
    return { providerStatus: "failed", output: latestText, turnId: turn?.id || null, tokensUsed, toolCallsUsed: turnToolCallCount(itemsResponse, turn?.id || null) };
  }
  if (turnStatus === "cancelled") {
    return { providerStatus: "cancelled", output: latestText, turnId: turn?.id || null, tokensUsed, toolCallsUsed: turnToolCallCount(itemsResponse, turn?.id || null) };
  }
  if (["queued", "in_progress", "waiting"].includes(turnStatus)) {
    return { providerStatus: "working", output: latestText, turnId: turn?.id || null, tokensUsed, toolCallsUsed: turnToolCallCount(itemsResponse, turn?.id || null) };
  }

  // Session idle means no turn is currently running; it does not prove the
  // last turn succeeded. Without a terminal root turn, fail safe as working.
  return { providerStatus: "working", output: latestText, turnId: turn?.id || null, tokensUsed, toolCallsUsed: turnToolCallCount(itemsResponse, turn?.id || null) };
}

export function turnToolCallCount(itemsResponse, turnId = null) {
  return collection(itemsResponse).filter((item) => {
    if (turnId && item?.turn_id && item.turn_id !== turnId) return false;
    return isBudgetedExternalToolItem(item);
  }).length;
}

export function turnHasFailedWork(itemsResponse, turnId = null) {
  const failedStatuses = new Set(["failed", "incomplete"]);
  return collection(itemsResponse).some((item) => {
    if (turnId && item?.turn_id && item.turn_id !== turnId) return false;
    const status = String(item?.status || "").toLowerCase();
    if (!failedStatuses.has(status)) return false;
    return isToolLikeItem(item);
  });
}

function isToolLikeItem(item) {
  const type = String(item?.type || "").toLowerCase();
  return (
    type.includes("call") ||
    type.includes("tool") ||
    type.includes("execution") ||
    type.includes("search")
  );
}

function isBudgetedExternalToolItem(item) {
  const type = String(item?.type || "").toLowerCase();
  return (
    type === "web_search_call" ||
    type === "mcp_call" ||
    type === "function_call"
  );
}

export function normaliseCodingWorkspace(workspace = null) {
  if (!workspace || workspace.enabled !== true) {
    return { enabled: false, repositoryUrl: null, repositoryRef: null };
  }

  const repositoryUrl = normaliseGitHubRepositoryUrl(workspace.repositoryUrl);
  const repositoryRef = normaliseGitRef(workspace.repositoryRef);

  if (repositoryRef && !repositoryUrl) {
    throw new Error("repositoryRef requires repositoryUrl");
  }

  return {
    enabled: true,
    repositoryUrl,
    repositoryRef
  };
}

export function buildAgentEnvironment(workspace = null) {
  const spec = normaliseCodingWorkspace(workspace);
  if (!spec.enabled) return { type: "none" };

  const setupCommands = [{ command: "mkdir -p /workspace/outputs" }];

  if (spec.repositoryUrl) {
    if (spec.repositoryRef) {
      setupCommands.unshift(
        {
          command:
            "git clone --filter=blob:none --no-checkout " +
            shellQuote(spec.repositoryUrl) +
            " /workspace/project"
        },
        {
          command: "git fetch --depth 1 origin " + shellQuote(spec.repositoryRef),
          cwd: "/workspace/project"
        },
        {
          command: "git checkout -B keepgoing-work FETCH_HEAD",
          cwd: "/workspace/project"
        }
      );
    } else {
      setupCommands.unshift(
        {
          command:
            "git clone --depth 1 " +
            shellQuote(spec.repositoryUrl) +
            " /workspace/project"
        },
        {
          command: "git checkout -B keepgoing-work",
          cwd: "/workspace/project"
        }
      );
    }
  } else {
    setupCommands.unshift({ command: "mkdir -p /workspace/project" });
  }

  return {
    type: "openai_hosted",
    container_size: "small",
    network: { access: "enabled" },
    setup_commands: setupCommands
  };
}

function normaliseGitHubRepositoryUrl(value) {
  if (value == null || String(value).trim() === "") return null;

  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("repositoryUrl must be a valid public GitHub HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("repositoryUrl must be a public github.com HTTPS repository URL without credentials");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(pathname)) {
    throw new Error("repositoryUrl must identify one GitHub owner/repository");
  }
  if (!pathname.endsWith(".git")) pathname += ".git";
  return "https://github.com" + pathname;
}

function normaliseGitRef(value) {
  if (value == null || String(value).trim() === "") return null;
  const ref = String(value).trim();

  if (
    ref.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock")
  ) {
    throw new Error("repositoryRef is not a valid safe Git ref");
  }
  return ref;
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
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
