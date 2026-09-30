import assert from "node:assert/strict";
import {
  createToolProfileRegistry,
  normaliseProfile,
  parseProfiles
} from "./tool_profiles.js";

assert.deepEqual(parseProfiles(""), {});
assert.throws(() => parseProfiles("{"), /valid JSON/);

const raw = JSON.stringify({
  profiles: {
    "github-read": {
      description: "Read approved GitHub repositories.",
      allowWeb: true,
      maxToolCalls: 4,
      servers: [{
        label: "github",
        url: "https://mcp.example.com/github",
        credential_id: "cred_123",
        allowed_tools: ["search", "fetch_file"],
        required: true
      }]
    },
    "developer-owner": {
      description: "Owner development profile.",
      ownerOnly: true,
      writeCapable: true,
      maxToolCalls: 40,
      servers: [{
        server_label: "relay",
        server_url: "https://relay.example.com/mcp",
        authorization_env: "RELAY_MCP_AUTH",
        allowed_tools: ["read_text_file", "prepare_write_file", "write_file"]
      }]
    }
  }
});

const registry = createToolProfileRegistry({
  rawJson: raw,
  env: { RELAY_MCP_AUTH: "Bearer secret-value" }
});

const extraRegistry = createToolProfileRegistry({
  rawJson: "",
  extraProfiles: {
    "github-read": {
      ownerOnly: true,
      writeCapable: false,
      allowWeb: true,
      servers: [{
        label: "github_worker",
        url: "https://keepgoing.example/worker-mcp",
        authorization_env: "WORKER_AUTH",
        allowed_tools: ["github_get_file"]
      }]
    }
  },
  env: { WORKER_AUTH: "Bearer worker-secret" }
});
assert.ok(extraRegistry.list({ admin: true }).some((p) => p.name === "github-read"));
assert.ok(!extraRegistry.list({ admin: false }).some((p) => p.name === "github-read"));
assert.equal(extraRegistry.resolve("github-read", { admin: true }).mcpTools[0].transport.authorization, "Bearer worker-secret");
assert.throws(
  () => createToolProfileRegistry({
    rawJson: JSON.stringify({ "github-read": { ownerOnly: true } }),
    extraProfiles: { "github-read": { ownerOnly: true } }
  }),
  /Duplicate KeepGoing tool profile/
);

const publicList = registry.list({ admin: false });
assert.ok(publicList.some((p) => p.name === "web"));
assert.ok(publicList.some((p) => p.name === "github-read"));
assert.ok(!publicList.some((p) => p.name === "developer-owner"));

const ownerList = registry.list({ admin: true });
assert.ok(ownerList.some((p) => p.name === "developer-owner"));
assert.deepEqual(registry.healthCheck(), {
  ok: true,
  profiles: 3,
  servers: 2,
  secret_refs: 1
});

const gh = registry.resolve("github-read", { admin: false, allowWeb: true });
assert.equal(gh.allowWeb, true);
assert.equal(gh.mcpTools.length, 1);
assert.deepEqual(gh.mcpTools[0], {
  type: "mcp",
  server_label: "github",
  transport: {
    type: "http",
    server_url: "https://mcp.example.com/github"
  },
  allowed_tools: ["search", "fetch_file"],
  connection_origin: "service",
  required: true,
  credential_id: "cred_123"
});
assert.equal(gh.public.mcp_servers[0].tool_count, 2);
assert.ok(/^[0-9a-f]{64}$/.test(gh.policyHash));

const owner = registry.resolve("developer-owner", { admin: true, allowWeb: false });
assert.equal(owner.allowWeb, false);
assert.equal(owner.writeCapable, true);
assert.equal(owner.maxToolCalls, 40);
assert.equal(owner.mcpTools[0].transport.authorization, "Bearer secret-value");
assert.ok(!JSON.stringify(owner.public).includes("secret-value"));
assert.ok(!JSON.stringify(owner.public).includes("cred_123"));

assert.throws(
  () => registry.resolve("developer-owner", { admin: false }),
  /owner-only/
);
assert.throws(
  () => createToolProfileRegistry({
    rawJson: raw,
    env: {}
  }).resolve("developer-owner", { admin: true }),
  /authorization secret/
);

const missingSecretRegistry = createToolProfileRegistry({ rawJson: raw, env: {} });
assert.equal(missingSecretRegistry.healthCheck().ok, false);
assert.equal(missingSecretRegistry.healthCheck().error, "missing_mcp_authorization_secret");

assert.throws(
  () => normaliseProfile("bad write", {}),
  /profile name/
);
assert.throws(
  () => normaliseProfile("unsafe-write", { writeCapable: true, ownerOnly: false }),
  /owner-only/
);
assert.throws(
  () => normaliseProfile("no-allowlist", {
    servers: [{ label: "x", url: "https://example.com/mcp" }]
  }),
  /allowed_tools/
);
assert.throws(
  () => normaliseProfile("environment-origin", {
    servers: [{
      label: "x",
      url: "https://example.com/mcp",
      connection_origin: "environment",
      allowed_tools: ["read"]
    }]
  }),
  /service connection_origin/
);

assert.throws(
  () => normaliseProfile("bad-http", {
    servers: [{
      label: "x",
      url: "http://example.com/mcp",
      allowed_tools: ["read"]
    }]
  }),
  /HTTPS/
);
assert.throws(
  () => normaliseProfile("secret-header", {
    servers: [{
      label: "x",
      url: "https://example.com/mcp",
      allowed_tools: ["read"],
      headers: { Authorization: "Bearer nope" }
    }]
  }),
  /Secret MCP headers/
);

console.log("tool profile tests passed");
