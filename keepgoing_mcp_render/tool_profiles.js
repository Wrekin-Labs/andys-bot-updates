import crypto from "node:crypto";

const PROFILE_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const SERVER_LABEL_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:/-]{1,160}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,127}$/;
const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;

export function createToolProfileRegistry({
  rawJson = "",
  extraProfiles = {},
  env = process.env
} = {}) {
  const configured = parseProfiles(rawJson);
  if (!extraProfiles || typeof extraProfiles !== "object" || Array.isArray(extraProfiles)) {
    throw new Error("extraProfiles must be an object");
  }
  const profiles = new Map();

  profiles.set("web", freezeProfile({
    name: "web",
    description: "Public web research only.",
    ownerOnly: false,
    writeCapable: false,
    defaultAllowWeb: true,
    maxToolCalls: null,
    servers: []
  }));

  for (const [name, input] of Object.entries(configured)) {
    profiles.set(name, normaliseProfile(name, input));
  }

  for (const [name, input] of Object.entries(extraProfiles)) {
    if (profiles.has(name)) throw new Error("Duplicate KeepGoing tool profile");
    profiles.set(name, normaliseProfile(name, input));
  }

  function list({ admin = false } = {}) {
    return [...profiles.values()]
      .filter((profile) => admin || !profile.ownerOnly)
      .map(publicProfile);
  }

  function resolve(name = "web", {
    admin = false,
    allowWeb = true
  } = {}) {
    const key = String(name || "web").trim() || "web";
    const profile = profiles.get(key);
    if (!profile) throw new Error("Unknown KeepGoing tool profile");
    if (profile.ownerOnly && !admin) throw new Error("This KeepGoing tool profile is owner-only");
    if (profile.writeCapable && !admin) throw new Error("Write-capable KeepGoing tool profiles are owner-only");

    const mcpTools = profile.servers.map((server) => buildMcpTool(server, env));
    return {
      name: profile.name,
      description: profile.description,
      ownerOnly: profile.ownerOnly,
      writeCapable: profile.writeCapable,
      allowWeb: Boolean(allowWeb && profile.defaultAllowWeb),
      maxToolCalls: profile.maxToolCalls,
      mcpTools,
      policyHash: profile.policyHash,
      public: publicProfile(profile)
    };
  }

  function healthCheck() {
    let serverCount = 0;
    let secretRefs = 0;
    for (const profile of profiles.values()) {
      for (const server of profile.servers) {
        serverCount += 1;
        if (server.authorization_env) {
          secretRefs += 1;
          const value = String(env?.[server.authorization_env] || "").trim();
          if (!value) {
            return {
              ok: false,
              error: "missing_mcp_authorization_secret",
              profiles: profiles.size,
              servers: serverCount,
              secret_refs: secretRefs
            };
          }
        }
      }
    }
    return {
      ok: true,
      profiles: profiles.size,
      servers: serverCount,
      secret_refs: secretRefs
    };
  }

  return {
    list,
    resolve,
    healthCheck,
    has(name) { return profiles.has(String(name || "")); }
  };
}

export function parseProfiles(rawJson) {
  const text = String(rawJson || "").trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("KEEPGOING_TOOL_PROFILES_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("KEEPGOING_TOOL_PROFILES_JSON must be an object");
  }
  const source = parsed.profiles && typeof parsed.profiles === "object" && !Array.isArray(parsed.profiles)
    ? parsed.profiles
    : parsed;
  return source;
}

export function normaliseProfile(name, input) {
  const profileName = String(name || "").trim();
  if (!PROFILE_NAME_RE.test(profileName)) throw new Error("Invalid KeepGoing tool profile name");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("KeepGoing tool profile must be an object");
  }

  const ownerOnly = Boolean(input.ownerOnly);
  const writeCapable = Boolean(input.writeCapable);
  if (writeCapable && !ownerOnly) {
    throw new Error("Write-capable KeepGoing tool profiles must be owner-only");
  }

  const servers = Array.isArray(input.servers)
    ? input.servers.map((server, index) => normaliseServer(server, index))
    : [];

  const labels = new Set();
  for (const server of servers) {
    if (labels.has(server.server_label)) throw new Error("Duplicate MCP server_label in tool profile");
    labels.add(server.server_label);
  }

  const maxToolCalls = input.maxToolCalls == null
    ? null
    : clampInt(input.maxToolCalls, 1, ownerOnly ? 100 : 5);

  const profile = {
    name: profileName,
    description: String(input.description || profileName).trim().slice(0, 240),
    ownerOnly,
    writeCapable,
    defaultAllowWeb: input.allowWeb !== false,
    maxToolCalls,
    servers
  };

  profile.policyHash = policyHash(profile);
  return freezeProfile(profile);
}

function normaliseServer(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("MCP server entry must be an object");
  }

  const serverLabel = String(input.server_label || input.label || "").trim();
  if (!SERVER_LABEL_RE.test(serverLabel)) throw new Error("Invalid MCP server_label");

  const serverUrl = String(input.server_url || input.url || "").trim();
  let parsed;
  try { parsed = new URL(serverUrl); }
  catch { throw new Error("Invalid MCP server URL"); }
  if (parsed.protocol !== "https:") throw new Error("KeepGoing MCP servers must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("Credentials are not allowed in MCP server URLs");
  if (parsed.hash) throw new Error("MCP server URL fragments are not allowed");

  const allowedTools = Array.isArray(input.allowed_tools)
    ? [...new Set(input.allowed_tools.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  if (!allowedTools.length) {
    throw new Error("Each KeepGoing MCP server requires an explicit allowed_tools allowlist");
  }
  if (allowedTools.length > 100) throw new Error("MCP allowed_tools exceeds 100 tools");
  if (allowedTools.some((name) => !TOOL_NAME_RE.test(name))) {
    throw new Error("Invalid MCP tool name in allowed_tools");
  }

  const credentialId = input.credential_id == null ? null : String(input.credential_id).trim();
  const authorizationEnv = input.authorization_env == null ? null : String(input.authorization_env).trim();
  if (credentialId && authorizationEnv) {
    throw new Error("Use credential_id or authorization_env for an MCP server, not both");
  }
  if (authorizationEnv && !ENV_NAME_RE.test(authorizationEnv)) {
    throw new Error("Invalid MCP authorization_env name");
  }

  const headers = {};
  if (input.headers != null) {
    if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) {
      throw new Error("MCP headers must be an object");
    }
    for (const [key, value] of Object.entries(input.headers)) {
      const name = String(key || "").trim();
      if (!name || /[\r\n:]/.test(name)) throw new Error("Invalid MCP header name");
      if (SENSITIVE_HEADER_RE.test(name)) {
        throw new Error("Secret MCP headers must use credential_id or authorization_env");
      }
      const text = String(value ?? "");
      if (/[
]/.test(text)) throw new Error("Invalid MCP header value");
      headers[name] = text.slice(0, 1000);
    }
  }

  return {
    server_label: serverLabel,
    server_url: serverUrl,
    allowed_tools: allowedTools,
    credential_id: credentialId || null,
    authorization_env: authorizationEnv || null,
    headers,
    connection_origin: normaliseConnectionOrigin(input.connection_origin),
    required: Boolean(input.required)
  };
}

function normaliseConnectionOrigin(value) {
  const origin = String(value || "service").trim().toLowerCase();
  if (origin !== "service") {
    throw new Error("KeepGoing v1.2 MCP profiles currently support service connection_origin only");
  }
  return "service";
}

function buildMcpTool(server, env) {
  const transport = {
    type: "http",
    server_url: server.server_url
  };

  if (server.authorization_env) {
    const authorization = String(env?.[server.authorization_env] || "").trim();
    if (!authorization) {
      throw new Error("Required KeepGoing MCP authorization secret is not configured");
    }
    if (/[
]/.test(authorization)) throw new Error("Invalid MCP authorization secret");
    transport.authorization = authorization;
  }

  if (Object.keys(server.headers).length) {
    transport.headers = { ...server.headers };
  }

  const tool = {
    type: "mcp",
    server_label: server.server_label,
    transport,
    allowed_tools: [...server.allowed_tools],
    connection_origin: server.connection_origin,
    required: server.required
  };
  if (server.credential_id) tool.credential_id = server.credential_id;
  return tool;
}

function publicProfile(profile) {
  return {
    name: profile.name,
    description: profile.description,
    owner_only: profile.ownerOnly,
    write_capable: profile.writeCapable,
    web: profile.defaultAllowWeb,
    mcp_servers: profile.servers.map((server) => ({
      label: server.server_label,
      tool_count: server.allowed_tools.length,
      required: server.required
    })),
    max_tool_calls: profile.maxToolCalls,
    policy_hash: profile.policyHash
  };
}

function policyHash(profile) {
  const safe = {
    name: profile.name,
    ownerOnly: profile.ownerOnly,
    writeCapable: profile.writeCapable,
    defaultAllowWeb: profile.defaultAllowWeb,
    maxToolCalls: profile.maxToolCalls,
    servers: profile.servers.map((server) => ({
      server_label: server.server_label,
      server_url: server.server_url,
      allowed_tools: [...server.allowed_tools].sort(),
      credential_id: server.credential_id || null,
      authorization_env: server.authorization_env || null,
      headers: Object.fromEntries(Object.entries(server.headers).sort(([a], [b]) => a.localeCompare(b))),
      connection_origin: server.connection_origin,
      required: server.required
    }))
  };
  return crypto.createHash("sha256").update(stableStringify(safe)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + stableStringify(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    servers: Object.freeze(profile.servers.map((server) => Object.freeze({
      ...server,
      allowed_tools: Object.freeze([...server.allowed_tools]),
      headers: Object.freeze({ ...server.headers })
    })))
  });
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Invalid maxToolCalls");
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
