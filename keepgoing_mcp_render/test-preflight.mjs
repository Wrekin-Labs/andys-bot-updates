import assert from "node:assert/strict";
import { runDeploymentPreflight } from "./deployment_preflight.js";

function response(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      }
    },
    async json() { return typeof body === "string" ? JSON.parse(body) : body; },
    async text() { return text; }
  };
}

const base = "https://keepgoing.example";
const fetchOk = async (url, init = {}) => {
  const path = new URL(url).pathname;
  if (path === "/health") {
    return response(200, { ok: true, version: "1.2.0-beta.24", durableEngineEnabled: true });
  }
  if (path === "/readiness") {
    return response(200, {
      ok: true,
      sell_ready: true,
      durable_engine_enabled: true,
      durable_engine_ready: true,
      durable_store_ready: true,
      tool_profiles_ready: true,
      github_worker_requested: false,
      github_worker_ready: false,
      github_worker_repo_count: 0,
      relay_profiles_requested: false,
      relay_profiles_ready: false,
      openai_webhook_ready: true
    });
  }
  if (path === "/.well-known/oauth-protected-resource") {
    return response(200, {
      resource: base + "/mcp",
      authorization_servers: [base]
    });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return response(200, {
      issuer: base,
      code_challenge_methods_supported: ["S256"]
    });
  }
  if (path === "/mcp") {
    assert.equal(init.method, "POST");
    return response(401, { error: "token_required" }, {
      "www-authenticate": 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource"'
    });
  }
  if (path === "/worker-mcp") {
    assert.equal(init.method, "POST");
    return response(401, { error: "unauthorized" }, {
      "www-authenticate": 'Bearer realm="KeepGoing private worker"'
    });
  }
  if (["/privacy","/terms","/support","/security"].includes(path)) {
    return response(200, "<html>" + "x".repeat(200) + "</html>");
  }
  if (path === "/.well-known/openai-apps-challenge") {
    return response(200, "challenge-token");
  }
  return response(404, "not found");
};

const ok = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: fetchOk,
  requireSellReady: true,
  requireV12: true,
  requireChallenge: true
});
assert.equal(ok.ok, true);
assert.deepEqual(ok.failed, []);
assert.equal(ok.checks.length, 10);

const toolReady = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/readiness") {
      return response(200, {
        ok: true,
        sell_ready: true,
        durable_engine_enabled: true,
        durable_engine_ready: true,
        durable_store_ready: true,
        tool_profiles_ready: true,
        github_worker_requested: true,
        github_worker_ready: true,
        github_worker_repo_count: 2,
        relay_profiles_requested: true,
        relay_profiles_ready: true,
        openai_webhook_ready: true
      });
    }
    if (path === "/worker-mcp") {
      return response(401, { error: "unauthorized" }, {
        "www-authenticate": 'Bearer realm="KeepGoing private worker"'
      });
    }
    return fetchOk(url, init);
  },
  requireV12: true,
  requireToolProfiles: true,
  requireGithubWorker: true,
  requireRelayProfiles: true
});
assert.equal(toolReady.ok, true);
assert.ok(toolReady.checks.some((item) => item.name === "private_worker_mcp_protected"));

const missingGithub = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: fetchOk,
  requireGithubWorker: true
});
assert.equal(missingGithub.ok, false);
assert.ok(missingGithub.failed.includes("readiness"));

const toolsBroken = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/readiness") {
      return response(200, {
        ok: true,
        sell_ready: true,
        durable_engine_enabled: true,
        durable_engine_ready: true,
        durable_store_ready: true,
        tool_profiles_ready: false,
        github_worker_requested: true,
        github_worker_ready: false,
        github_worker_repo_count: 0,
        relay_profiles_requested: true,
        relay_profiles_ready: false,
        openai_webhook_ready: true
      });
    }
    return fetchOk(url, init);
  },
  requireV12: true,
  requireToolProfiles: true,
  requireGithubWorker: true,
  requireRelayProfiles: true
});
assert.equal(toolsBroken.ok, false);
assert.ok(toolsBroken.failed.includes("readiness"));

const broken = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/readiness") {
      return response(200, {
        ok: true,
        sell_ready: false,
        durable_engine_enabled: true,
        durable_engine_ready: true,
        durable_store_ready: false,
        openai_webhook_ready: true
      });
    }
    return fetchOk(url, init);
  },
  requireSellReady: true,
  requireV12: true
});
assert.equal(broken.ok, false);
assert.ok(broken.failed.includes("readiness"));

const optionalChallenge = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: async (url, init) => {
    if (new URL(url).pathname === "/.well-known/openai-apps-challenge") {
      return response(404, "not configured");
    }
    return fetchOk(url, init);
  }
});
assert.equal(optionalChallenge.ok, true);

await assert.rejects(
  () => runDeploymentPreflight({ baseUrl: "http://example.com", fetchImpl: fetchOk }),
  /https/
);

console.log("deployment preflight tests passed");

const sha = "a".repeat(40);
const deployedFetch = async (url, init) => {
  const result = await fetchOk(url, init);
  if (["/health", "/readiness"].includes(new URL(url).pathname)) {
    return response(200, { ...(await result.json()), release_commit: sha, watchdog_ready: true, openai_webhook_ready: false });
  }
  return result;
};
assert.equal((await runDeploymentPreflight({ baseUrl: base, fetchImpl: deployedFetch, expectedCommit: sha, requireV12: true })).ok, true);
const mismatch = await runDeploymentPreflight({ baseUrl: base, fetchImpl: deployedFetch, expectedCommit: "b".repeat(40) });
assert.ok(mismatch.failed.includes("health"));
assert.ok(mismatch.failed.includes("readiness"));
assert.equal((await runDeploymentPreflight({ baseUrl: base, fetchImpl: deployedFetch, requireWebhook: true })).ok, false);
const maliciousOrigin = await runDeploymentPreflight({ baseUrl: base, fetchImpl: async (url, init) => {
  if (new URL(url).pathname === "/.well-known/oauth-protected-resource") return response(200, {resource: base + ".attacker.example/mcp", authorization_servers:[base]});
  return fetchOk(url, init);
}});
assert.ok(maliciousOrigin.failed.includes("protected_resource_metadata"));
