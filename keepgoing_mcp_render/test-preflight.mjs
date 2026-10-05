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
    return response(200, { ok: true, version: "1.2.0-beta.1", durableEngineEnabled: true });
  }
  if (path === "/readiness") {
    return response(200, {
      ok: true,
      sell_ready: true,
      durable_engine_enabled: true,
      durable_engine_ready: true,
      durable_store_ready: true,
      watchdog_ready: true,
      openai_webhook_ready: false
    });
  }
  if (path === "/version") {
    return response(200, { release: "1.5.0-beta.1", engine: "durable", features: { remote_push: false } });
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
  requireChallenge: true,
  expectedRelease: "1.5.0-beta.1"
});
assert.equal(ok.ok, true, JSON.stringify(ok.failed));
assert.deepEqual(ok.failed, []);
assert.equal(ok.checks.length, 11);

// Webhook is optional unless explicitly required.
const webhookRequired = await runDeploymentPreflight({ baseUrl: base, fetchImpl: fetchOk, requireWebhook: true });
assert.ok(webhookRequired.failed.includes("readiness"));

// A stale deployment is caught by --release.
const staleRelease = await runDeploymentPreflight({ baseUrl: base, fetchImpl: fetchOk, expectedRelease: "9.9.9" });
assert.ok(staleRelease.failed.includes("version"));

// Older servers without /version still pass when no release is demanded.
const noVersion = await runDeploymentPreflight({
  baseUrl: base,
  fetchImpl: async (url, init) => new URL(url).pathname === "/version" ? response(404, "not found") : fetchOk(url, init)
});
assert.equal(noVersion.ok, true);

// requireV12 needs the watchdog.
const noWatchdog = await runDeploymentPreflight({
  baseUrl: base,
  requireV12: true,
  fetchImpl: async (url, init) => {
    if (new URL(url).pathname === "/readiness") {
      return response(200, { ok: true, durable_engine_enabled: true, durable_engine_ready: true, durable_store_ready: true, watchdog_ready: false });
    }
    return fetchOk(url, init);
  }
});
assert.ok(noWatchdog.failed.includes("readiness"));

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
