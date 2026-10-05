import assert from "node:assert/strict";
import { boundedEnvInt, validateEnvironment } from "./config_check.js";
import { createLogger } from "./logger.js";

// ---- config validation reports names/problems only, never values
const secretValue = "sk-live-should-never-appear";
const bad = validateEnvironment({
  OPENAI_API_KEY: secretValue,
  KEEPGOING_OAUTH_SECRET: "short",
  KEEPGOING_AUTH_URL: "http://billing.example.com/auth",
  KEEPGOING_OAUTH_CODE_URL: "https://user:pass@ledger.example.com",
  KEEPGOING_OWNER_TOKEN_HASH: "not-hex",
  KEEPGOING_V12_ENABLED: "true",
  KEEPGOING_MCP_RATE_LIMIT_PER_MINUTE: "lots",
  KEEPGOING_ALLOW_QUERY_TOKEN: "1"
});
assert.equal(bad.ok, false);
assert.ok(bad.errors.includes("KEEPGOING_AUTH_URL must use https"));
assert.ok(bad.errors.includes("KEEPGOING_OAUTH_CODE_URL must not embed credentials"));
assert.ok(bad.errors.some((e) => e.startsWith("KEEPGOING_OWNER_TOKEN_HASH")));
assert.ok(bad.errors.some((e) => e.startsWith("durable store not configured")));
assert.ok(bad.errors.includes("KEEPGOING_MCP_RATE_LIMIT_PER_MINUTE must be a non-negative number"));
assert.ok(bad.warnings.some((w) => w.includes("shorter than 32")));
assert.ok(bad.warnings.some((w) => w.includes("KEEPGOING_ALLOW_QUERY_TOKEN")));
assert.ok(!JSON.stringify(bad).includes(secretValue), "values are never echoed");
assert.ok(!JSON.stringify(bad).includes("user:pass"));

const good = validateEnvironment({
  OPENAI_API_KEY: "x",
  KEEPGOING_OAUTH_SECRET: "y".repeat(40),
  KEEPGOING_AUTH_URL: "https://billing.example.com/auth",
  KEEPGOING_OAUTH_CODE_URL: "https://billing.example.com/code",
  KEEPGOING_OWNER_TOKEN_HASH: "a".repeat(64),
  KEEPGOING_V12_ENABLED: "1",
  KEEPGOING_SUPABASE_URL: "https://x.supabase.co",
  KEEPGOING_SUPABASE_SERVICE_KEY: "svc"
});
assert.deepEqual(good.errors, []);
assert.equal(good.ok, true);

// ---- malformed numeric settings fail back to safe defaults, not NaN/fail-open
assert.equal(boundedEnvInt(undefined, 120, { min: 10, max: 1000 }), 120);
assert.equal(boundedEnvInt("", 120, { min: 10, max: 1000 }), 120);
assert.equal(boundedEnvInt("lots", 120, { min: 10, max: 1000 }), 120);
assert.equal(boundedEnvInt("-1", 5, { min: 0, max: 100 }), 5);
assert.equal(boundedEnvInt("1001", 120, { min: 10, max: 1000 }), 120);
assert.equal(boundedEnvInt("12.5", 120, { min: 10, max: 1000 }), 120);
assert.equal(boundedEnvInt("0", 5, { min: 0, max: 100 }), 0, "explicit zero can disable a cap where documented");
assert.equal(boundedEnvInt("250", 120, { min: 10, max: 1000 }), 250);

// ---- structured logger: JSON lines, redaction, bounded strings, level filter
const lines = [];
const log = createLogger({ sink: (line, level) => lines.push({ line, level }), minLevel: "info" });
log.debug("hidden_event", { a: 1 });
log.info("job_event", {
  job_id: "kgj_1",
  token: "kgat_secret",
  goal: "user prompt text",
  error: new Error("Authorization: Bearer abc"),
  note: "a".repeat(1000),
  nested: { prompt: "p", ok: true },
  multi: "x\ny"
});
assert.equal(lines.length, 1, "debug is filtered at info level");
const record = JSON.parse(lines[0].line);
assert.equal(record.event, "job_event");
assert.equal(record.level, "info");
assert.equal(record.job_id, "kgj_1");
assert.equal(record.token, "[redacted]");
assert.equal(record.goal, "[redacted]");
assert.equal(record.error.message, "redacted protected error");
assert.equal(record.note.length, 300);
assert.equal(record.nested.prompt, "[redacted]");
assert.equal(record.nested.ok, true);
assert.equal(record.multi, "x y");
const child = log.child({ request_id: "req-9" });
child.warn("child_event");
assert.equal(JSON.parse(lines[1].line).request_id, "req-9");
assert.equal(lines[1].level, "warn");
const throwing = createLogger({ sink: () => { throw new Error("disk full"); } });
assert.doesNotThrow(() => throwing.error("x"), "logging never throws into callers");

console.log("config check and logger tests passed");
