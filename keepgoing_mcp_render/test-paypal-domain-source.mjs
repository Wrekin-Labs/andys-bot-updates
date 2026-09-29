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
assert.match(source, /app\.post\("\/paypal\/start-subscription"/);
assert.match(source, /\/v1\/billing\/subscriptions/);
assert.match(source, /safePayPalApprovalUrl/);
assert.match(source, /return_url:\s*PUBLIC_BASE_URL \+ "\/paypal\/return\?claim_id="/);
assert.match(source, /Continue with PayPal/);
assert.doesNotMatch(source, /www\.paypal\.com\/sdk\/js/);

assert.match(source, /const claimId = String\(req\.body\?\.claim_id/);
assert.match(source, /claim_id_invalid/);
assert.match(source, /sub\.custom_id/);
assert.match(source, /crypto\.timingSafeEqual\(expectedClaim, suppliedClaim\)/);
assert.match(source, /claim_mismatch/);
assert.match(source, /crypto\.randomBytes\(32\)\.toString\("hex"\)/);
assert.match(source, /custom_id:\s*claimId/);
assert.match(source, /claim_id:claimId/);
assert.match(source, /app\.get\("\/paypal\/return"/);
assert.match(source, /res\.redirect\(303, approvalUrl\)/);
