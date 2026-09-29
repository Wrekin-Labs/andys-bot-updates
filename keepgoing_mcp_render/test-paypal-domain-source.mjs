import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /https:\/\/keepgoing-mcp\.onrender\.com\/paypal\/webhook/,
  "PayPal webhook URL must follow KEEPGOING_PUBLIC_BASE_URL"
);
assert.match(source, /home_url:\s*PUBLIC_BASE_URL/);
assert.match(source, /const desiredWebhookUrl = PUBLIC_BASE_URL \+ "\/paypal\/webhook"/);
assert.match(
  source,
  /\/v1\/notifications\/webhooks\/" \+ encodeURIComponent\(paypalConfig\.webhook_id\)[\s\S]{0,250}\{ method: "GET" \}/
);
assert.match(
  source,
  /method: "PATCH"[\s\S]{0,220}\{ op: "replace", path: "\/url", value: desiredWebhookUrl \}/
);
assert.match(source, /if \(Number\(error\?\.status \|\| 0\) === 404\)/);
assert.match(source, /paypalConfig\.webhook_url = desiredWebhookUrl/);
assert.match(source, /error\.status = response\.status/);

console.log("PayPal public-domain reconciliation guards passed");

assert.doesNotMatch(source, /\["ACTIVE","APPROVED"\]\.includes\(status\)/);
assert.match(source, /if \(status !== "ACTIVE"\)/);
assert.match(source, /subscription_not_active/);
assert.match(source, /keepgoing_paypal_subscription/);
assert.match(source, /Retry activation/);
