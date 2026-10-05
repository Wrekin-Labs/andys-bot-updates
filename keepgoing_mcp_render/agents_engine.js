import { createHash } from "node:crypto";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export function createAgentsEngine({
  apiKey,
  model = "gpt-6-astra",
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.KEEPGOING_PROVIDER_TIMEOUT_MS || DEFAULT_PROVIDER_TIMEOUT_MS)
} = {}) {
  if (!apiKey) throw new Error("OpenAI API key required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");
  const providerTimeoutMs = Math.max(1_000, Math.min(120_000, Number(timeoutMs) || DEFAULT_PROVIDER_TIMEOUT_MS));

  // Every provider call is bounded: a stalled upstream must surface as a
  // classified, retryable error rather than hanging the watchdog or a tool call.
  async function send(path, init = {}) {
    try {
      return await fetchImpl(baseUrl + path, {
        ...init,
        signal: init.signal || AbortSignal.timeout(providerTimeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw providerError("Agents API request timed out", 504, "provider_timeout");
      }
      throw providerError("Agents API is unreachable", 0, "provider_unreachable");
    }
  }

  async function request(path, init = {}) {
    const response = await send(path, {
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
      throw providerError(
        data?.error?.message || ("Agents API request failed (" + response.status + ")"),
        response.status
      );
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

  async function listArtifacts(sessionId, {
    order = "desc",
    limit = 50,
    after = null
  } = {}) {
    requireSessionId(sessionId);
    const safeOrder = order === "asc" ? "asc" : "desc";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const query = new URLSearchParams({
      order: safeOrder,
      limit: String(safeLimit)
    });
    if (after) query.set("after", String(after));

    return request(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/artifacts?" + query.toString(),
      { method: "GET" }
    );
  }

  async function readArtifactText(sessionId, artifactId, {
    maxBytes = 512_000
  } = {}) {
    requireSessionId(sessionId);
    const id = String(artifactId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
      throw new Error("valid artifact id required");
    }

    const metadata = await request(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/artifacts/" + encodeURIComponent(id),
      { method: "GET" }
    );

    const path = String(metadata?.path || "");
    if (!isReadableTextArtifactPath(path)) {
      throw new Error("artifact type is not readable as text");
    }

    const size = Number(metadata?.size_bytes || 0);
    const safeMax = Math.max(1, Math.min(1_000_000, Number(maxBytes) || 512_000));
    if (!Number.isFinite(size) || size < 0 || size > safeMax) {
      throw new Error("artifact exceeds the readable text size limit");
    }

    const response = await send(
      "/agents/sessions/" + encodeURIComponent(sessionId) +
      "/artifacts/" + encodeURIComponent(id) + "/content",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + apiKey,
          "OpenAI-Beta": "agents=v1",
          Accept: "application/octet-stream"
        }
      }
    );

    if (!response.ok) {
      // Never echo a raw upstream body to the caller.
      throw providerError("Artifact content request failed (" + response.status + ")", response.status);
    }

    // Read at most safeMax bytes even if size_bytes metadata was wrong, so a
    // hostile or runaway artifact cannot exhaust server memory.
    const bytes = await readBounded(response, safeMax);
    if (bytes === null) {
      throw new Error("artifact exceeds the readable text size limit");
    }
    if (bytes.includes(0)) {
      throw new Error("artifact type is not readable as text");
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    return {
      artifact: metadata,
      text,
      sha256: sha256Bytes(bytes),
      byteLength: bytes.length
    };
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

  return { createSession, getSession, listSessions, findSessionByMetadata, listItems, listAllItems, listTurnItems, listTurns, listArtifacts, readArtifactText, sendMessage, cancelTurn };
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
    return {
      enabled: false,
      repositoryUrl: null,
      repositoryRef: null,
      files: []
    };
  }

  const repositoryUrl = normaliseGitHubRepositoryUrl(workspace.repositoryUrl);
  const repositoryRef = normaliseGitRef(workspace.repositoryRef);
  const files = normaliseWorkspaceFiles(workspace.files);

  if (repositoryRef && !repositoryUrl) {
    throw new Error("repositoryRef requires repositoryUrl");
  }

  return {
    enabled: true,
    repositoryUrl,
    repositoryRef,
    files
  };
}

export function buildAgentEnvironment(workspace = null) {
  const spec = normaliseCodingWorkspace(workspace);
  if (!spec.enabled) return { type: "none" };

  const setupCommands = [];

  if (spec.repositoryUrl) {
    if (spec.repositoryRef) {
      setupCommands.push(
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
      setupCommands.push(
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
    setupCommands.push({ command: "mkdir -p /workspace/project" });
  }

  if (spec.files.length) {
    for (const file of spec.files) {
      const source = "/workspace/input/" + file.path;
      const destination = "/workspace/project/" + file.path;
      setupCommands.push({
        command: [
          "dest=" + shellQuote(destination),
          "parent=$(dirname -- \"$dest\")",
          "resolved=$(realpath -m -- \"$parent\")",
          "case \"$resolved\" in /workspace/project|/workspace/project/*) ;; *) echo 'KeepGoing inline file path escaped project workspace' >&2; exit 42 ;; esac",
          "mkdir -p -- \"$parent\"",
          "rm -rf -- \"$dest\"",
          "cp -- " + shellQuote(source) + " \"$dest\""
        ].join(" && ")
      });
    }
  }
  setupCommands.push({ command: "mkdir -p /workspace/outputs" });

  const files = spec.files.map((file) => ({
    type: "inline",
    path: "/workspace/input/" + file.path,
    data: Buffer.from(file.content, "utf8").toString("base64")
  }));

  return {
    type: "openai_hosted",
    container_size: "small",
    files,
    network: {
      access: "restricted",
      allowed_domains: [
        "github.com",
        "raw.githubusercontent.com",
        "codeload.github.com",
        "objects.githubusercontent.com",
        "registry.npmjs.org",
        "pypi.org",
        "files.pythonhosted.org",
        "deb.debian.org",
        "security.debian.org",
        "crates.io",
        "static.crates.io",
        "repo.maven.apache.org",
        "plugins.gradle.org"
      ]
    },
    setup_commands: setupCommands
  };
}

function normaliseWorkspaceFiles(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("workspaceFiles must be an array");
  if (value.length > 8) throw new Error("workspaceFiles supports at most 8 files");

  let totalBytes = 0;
  const seen = new Set();

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("each workspace file must contain path and content");
    }

    const path = normaliseWorkspaceFilePath(item.path);
    const content = String(item.content ?? "");
    if (content.includes("\0")) {
      throw new Error("workspace file content must be UTF-8 text");
    }
    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > 32_000) {
      throw new Error("workspace file exceeds the 32 KB per-file limit");
    }
    totalBytes += bytes;
    if (totalBytes > 128_000) {
      throw new Error("workspace files exceed the 128 KB total limit");
    }
    if (seen.has(path)) throw new Error("workspace file paths must be unique");
    seen.add(path);

    if (looksSensitiveWorkspacePath(path)) {
      throw new Error("workspace file path is not allowed for inline handoff");
    }

    return { path, content };
  });
}

function normaliseWorkspaceFilePath(value) {
  const path = String(value || "").trim().replace(/\\/g, "/");

  if (
    !path ||
    path.length > 180 ||
    path.startsWith("/") ||
    path.includes("//") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/ -]*$/.test(path) ||
    path.endsWith("/")
  ) {
    throw new Error("workspace file path must be a safe relative project path");
  }

  const parts = path.split("/");
  if (
    parts.some((part) =>
      !part ||
      part === "." ||
      part === ".." ||
      part.toLowerCase() === ".git"
    )
  ) {
    throw new Error("workspace file path must be a safe relative project path");
  }

  return parts.join("/");
}

const SENSITIVE_BASENAMES = new Set([
  ".env", ".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials", ".htpasswd",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials", "credentials.json",
  "client_secret.json", "service-account.json", "secrets.json", "secrets.yml", "secrets.yaml"
]);
const SENSITIVE_DIRS = new Set([".ssh", ".aws", ".gnupg", ".docker", ".kube", ".azure", ".gcloud"]);
const SENSITIVE_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk", ".asc", ".gpg", ".tfstate", ".tfvars"];

export function looksSensitiveWorkspacePath(path) {
  const lower = String(path).toLowerCase();
  const parts = lower.split("/");
  const base = parts.at(-1) || lower;
  return (
    SENSITIVE_BASENAMES.has(base) ||
    base.startsWith(".env.") ||
    /^service[-_]?account.*\.json$/.test(base) ||
    parts.slice(0, -1).some((part) => SENSITIVE_DIRS.has(part)) ||
    SENSITIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
  );
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

function isReadableTextArtifactPath(path) {
  const value = String(path || "").toLowerCase();
  return (
    value.endsWith(".patch") ||
    value.endsWith(".diff") ||
    value.endsWith(".md") ||
    value.endsWith(".txt") ||
    value.endsWith(".json") ||
    value.endsWith(".log") ||
    value.endsWith(".csv") ||
    value.endsWith(".xml") ||
    value.endsWith(".yaml") ||
    value.endsWith(".yml")
  );
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

  // User/system input (the job prompt, continuation prompts and resume input)
  // lists the allowed STATUS markers verbatim. Treating it as model output
  // would let an empty assistant turn be misread as "STATUS: COMPLETED".
  const role = String(value.role || "").toLowerCase();
  if (role === "user" || role === "system" || role === "developer") return;
  if (String(value.type || "").toLowerCase() === "agent.session.input.message") return;

  if (typeof value.text === "string" &&
      (value.type === "output_text" || value.type === "text")) {
    out.push(value.text);
  }
  if (typeof value.output_text === "string") out.push(value.output_text);

  for (const [key, child] of Object.entries(value)) {
    if (key === "text" || key === "output_text") continue;
    if (key === "metadata") continue;
    collectText(child, out);
  }
}

function providerError(message, status = 0, code = null) {
  const error = new Error(String(message || "Agents API request failed").slice(0, 300));
  error.status = Number(status) || 0;
  error.code = code || (
    error.status === 429 ? "provider_rate_limited"
      : error.status >= 500 ? "provider_unavailable"
      : error.status >= 400 ? "provider_rejected"
      : "provider_error"
  );
  error.retryable = error.code !== "provider_rejected";
  return error;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = typeof response.arrayBuffer === "function"
      ? Buffer.from(await response.arrayBuffer())
      : Buffer.from(String(await response.text()), "utf8");
    return buffer.length > maxBytes ? null : buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
