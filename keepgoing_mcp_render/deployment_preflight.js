export async function runDeploymentPreflight({
  baseUrl,
  fetchImpl = globalThis.fetch,
  requireSellReady = false,
  requireV12 = false,
  requireToolProfiles = false,
  requireGithubWorker = false,
  requireRelayProfiles = false,
  requireWebhook = false,
  requireChallenge = false,
  expectedRelease = null
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");
  const base = normalizeBase(baseUrl);
  const checks = [];

  async function check(name, fn) {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail: detail ?? null });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: safeMessage(error)
      });
    }
  }

  let health = null;
  let readiness = null;

  await check("health", async () => {
    const response = await fetchImpl(base + "/health", { method: "GET" });
    health = await jsonResponse(response, "health");
    if (!health?.ok) throw new Error("health endpoint did not report ok");
    return {
      version: health.version || null,
      durableEngineEnabled: Boolean(health.durableEngineEnabled)
    };
  });

  await check("readiness", async () => {
    const response = await fetchImpl(base + "/readiness", { method: "GET" });
    readiness = await jsonResponse(response, "readiness");
    if (!readiness?.ok) throw new Error("readiness endpoint did not report ok");
    if (requireSellReady && !readiness.sell_ready) {
      throw new Error("sell_ready is false");
    }
    if (requireV12) {
      if (!readiness.durable_engine_enabled) throw new Error("durable engine is not enabled");
      if (!readiness.durable_engine_ready) throw new Error("durable engine configuration is not ready");
      if (!readiness.durable_store_ready) throw new Error("durable store is not reachable");
      // The watchdog is the production continuation path; the OpenAI webhook
      // is optional and only required with --webhook.
      if (!readiness.watchdog_ready) throw new Error("watchdog is not ready");
    }
    if (requireWebhook && !readiness.openai_webhook_ready) {
      throw new Error("OpenAI webhook is not ready");
    }
    if (requireToolProfiles && !readiness.tool_profiles_ready) {
      throw new Error("tool profiles are not ready");
    }
    if (requireGithubWorker) {
      if (!readiness.github_worker_requested) throw new Error("GitHub worker is not configured");
      if (!readiness.github_worker_ready) throw new Error("GitHub worker is not ready");
      if (Number(readiness.github_worker_repo_count || 0) < 1) {
        throw new Error("GitHub worker has no allowlisted repositories");
      }
    }
    if (requireRelayProfiles) {
      if (!readiness.relay_profiles_requested) throw new Error("Project Relay profiles are not configured");
      if (!readiness.relay_profiles_ready) throw new Error("Project Relay profiles are not ready");
    }
    return {
      sell_ready: Boolean(readiness.sell_ready),
      durable_engine_enabled: Boolean(readiness.durable_engine_enabled),
      durable_store_ready: Boolean(readiness.durable_store_ready),
      tool_profiles_ready: Boolean(readiness.tool_profiles_ready),
      github_worker_ready: Boolean(readiness.github_worker_ready),
      relay_profiles_ready: Boolean(readiness.relay_profiles_ready)
    };
  });

  await check("version", async () => {
    const response = await fetchImpl(base + "/version", { method: "GET" });
    if (response.status === 404 && !expectedRelease) {
      return { available: false, optional: true };
    }
    const data = await jsonResponse(response, "version");
    if (expectedRelease && data.release !== expectedRelease) {
      throw new Error("deployed release " + String(data.release || "unknown") + " does not match expected " + expectedRelease);
    }
    if (data.features?.remote_push) throw new Error("version endpoint advertises remote push, which KeepGoing must not do");
    return { release: data.release || null, engine: data.engine || null };
  });

  await check("protected_resource_metadata", async () => {
    const response = await fetchImpl(base + "/.well-known/oauth-protected-resource", { method: "GET" });
    const data = await jsonResponse(response, "protected resource metadata");
    const resource = String(data?.resource || "");
    const servers = Array.isArray(data?.authorization_servers) ? data.authorization_servers : [];
    if (!resource.startsWith(base)) throw new Error("resource metadata points at another origin");
    if (!servers.some((value) => String(value).startsWith(base))) {
      throw new Error("authorization server metadata points at another origin");
    }
    return { resource, authorization_servers: servers.length };
  });

  await check("authorization_server_metadata", async () => {
    const response = await fetchImpl(base + "/.well-known/oauth-authorization-server", { method: "GET" });
    const data = await jsonResponse(response, "authorization server metadata");
    if (!String(data?.issuer || "").startsWith(base)) throw new Error("OAuth issuer points at another origin");
    const methods = Array.isArray(data?.code_challenge_methods_supported)
      ? data.code_challenge_methods_supported
      : [];
    if (!methods.includes("S256")) throw new Error("OAuth metadata does not advertise PKCE S256");
    return { issuer: data.issuer, pkce_s256: true };
  });

  await check("unauthenticated_mcp_rejected", async () => {
    const response = await fetchImpl(base + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "preflight",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "KeepGoing preflight", version: "1" }
        }
      })
    });
    if (response.status !== 401) {
      throw new Error("unauthenticated MCP request was not rejected with 401");
    }
    const challenge = response.headers?.get?.("www-authenticate") || "";
    if (!/Bearer/i.test(challenge)) throw new Error("missing Bearer authentication challenge");
    return { status: response.status };
  });

  if (requireGithubWorker || readiness?.github_worker_ready) {
    await check("private_worker_mcp_protected", async () => {
      const response = await fetchImpl(base + "/worker-mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "worker-preflight",
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "KeepGoing worker preflight", version: "1" }
          }
        })
      });
      if (response.status !== 401) {
        throw new Error("private worker MCP was not rejected with 401");
      }
      const challenge = response.headers?.get?.("www-authenticate") || "";
      if (!/Bearer/i.test(challenge)) {
        throw new Error("private worker MCP is missing Bearer challenge");
      }
      return { status: response.status };
    });
  }

  for (const path of ["/privacy", "/terms", "/support", "/security"]) {
    await check("page:" + path.slice(1), async () => {
      const response = await fetchImpl(base + path, { method: "GET" });
      if (!response.ok) throw new Error(path + " returned " + response.status);
      const text = await response.text();
      if (text.length < 100) throw new Error(path + " returned unexpectedly short content");
      return { status: response.status, bytes: text.length };
    });
  }

  await check("openai_apps_challenge", async () => {
    const response = await fetchImpl(base + "/.well-known/openai-apps-challenge", { method: "GET" });
    if (response.status === 404 && !requireChallenge) {
      return { configured: false, optional: true };
    }
    if (!response.ok) throw new Error("OpenAI apps challenge returned " + response.status);
    const text = (await response.text()).trim();
    if (!text || /not configured/i.test(text)) throw new Error("OpenAI apps challenge is empty/unconfigured");
    if (/\s/.test(text)) throw new Error("OpenAI apps challenge must be plain single-token text");
    return { configured: true };
  });

  const failed = checks.filter((item) => !item.ok);
  return {
    ok: failed.length === 0,
    base_url: base,
    health_version: health?.version || null,
    readiness: readiness
      ? {
          ok: Boolean(readiness.ok),
          sell_ready: Boolean(readiness.sell_ready),
          durable_engine_enabled: Boolean(readiness.durable_engine_enabled),
          durable_store_ready: Boolean(readiness.durable_store_ready),
          tool_profiles_ready: Boolean(readiness.tool_profiles_ready),
          github_worker_ready: Boolean(readiness.github_worker_ready),
          relay_profiles_ready: Boolean(readiness.relay_profiles_ready)
        }
      : null,
    checks,
    failed: failed.map((item) => item.name)
  };
}

function normalizeBase(value) {
  const text = String(value || "").trim().replace(/\/$/, "");
  const parsed = new URL(text);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("preflight target must use https");
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

async function jsonResponse(response, name) {
  if (!response?.ok) throw new Error(name + " returned " + Number(response?.status || 0));
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error(name + " did not return JSON");
  return data;
}

function safeMessage(error) {
  const value = String(error?.message || error || "preflight check failed");
  return value.slice(0, 300);
}
