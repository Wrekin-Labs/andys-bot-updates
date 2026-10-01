import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  createOpenAIWebhookVerifier,
  createWebhookProcessor,
  sessionIdFromEvent
} from "./webhook_processor.js";

const events = [];
const jobsBySession = new Map([["sess_abc", { id: "kgj_abc", providerSessionId: "sess_abc" }]]);
let reconciles = 0;

const store = {
  async findByProviderSessionId(id) { return jobsBySession.get(id) || null; },
  async recordEvent(event) {
    if (events.some((x) => x.providerEventId === event.providerEventId)) return { inserted: false };
    events.push(event);
    return { inserted: true };
  }
};
const orchestrator = {
  async reconcile(jobId) {
    reconciles++;
    return { action: "continued", job: { id: jobId } };
  }
};
const verify = async (rawBody) => JSON.parse(rawBody);
const processor = createWebhookProcessor({ store, orchestrator, verify });

const raw = JSON.stringify({
  id: "evt_1",
  type: "agent.session.idle",
  data: { id: "sess_abc" }
});
const headers = { "webhook-id": "wh_1" };

const accepted = await processor.ingest(raw, headers);
assert.equal(accepted.providerEventId, "wh_1");
assert.equal(accepted.providerSessionId, "sess_abc");
assert.equal(accepted.jobId, "kgj_abc");
assert.equal(accepted.shouldReconcile, true);
assert.equal(accepted.duplicate, false);

const processed = await processor.process(accepted);
assert.equal(processed.action, "continued");
assert.equal(reconciles, 1);

const duplicate = await processor.ingest(raw, headers);
assert.equal(duplicate.duplicate, true);
assert.equal((await processor.process(duplicate)).action, "duplicate");
assert.equal(reconciles, 1);

const progress = await processor.ingest(JSON.stringify({
  id: "evt_2",
  type: "agent.session.in_progress",
  data: { id: "sess_abc" }
}), { "webhook-id": "wh_2" });
assert.equal(progress.shouldReconcile, false);
assert.equal((await processor.process(progress)).action, "recorded");

const orphan = await processor.ingest(JSON.stringify({
  id: "evt_3",
  type: "agent.session.idle",
  data: { id: "sess_missing" }
}), { "webhook-id": "wh_3" });
assert.equal(orphan.jobId, null);
assert.equal((await processor.process(orphan)).action, "orphan");

assert.equal(sessionIdFromEvent({ data: { id: "sess_ok" } }), "sess_ok");
assert.equal(sessionIdFromEvent({ data: { id: "../bad" } }), null);

let ctorOptions = null;
let unwrapArgs = null;
class FakeOpenAI {
  constructor(options) {
    ctorOptions = options;
    this.webhooks = {
      unwrap: async (...args) => {
        unwrapArgs = args;
        return { id: "evt_verified", type: "agent.session.idle", data: { id: "sess_ok" } };
      }
    };
  }
}
const verifier = createOpenAIWebhookVerifier({
  apiKey: "api-test",
  webhookSecret: "whsec-test",
  OpenAIClass: FakeOpenAI
});
const verified = await verifier('{"x":1}', new Headers({ "webhook-id": "wh_x" }));
assert.equal(verified.id, "evt_verified");
assert.deepEqual(ctorOptions, { apiKey: "api-test", webhookSecret: "whsec-test" });
assert.equal(unwrapArgs[0], '{"x":1}');

console.log("webhook processor tests passed");

// Exercise the installed official SDK verifier, without any provider request.
const secretBytes = randomBytes(32);
const signedVerifier = createOpenAIWebhookVerifier({
  apiKey: "local-signature-test-only",
  webhookSecret: "whsec_" + secretBytes.toString("base64")
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signedHeaders = {
  "webhook-id": "wh_signed_test",
  "webhook-timestamp": timestamp,
  "webhook-signature": "v1," + createHmac("sha256", secretBytes).update(`wh_signed_test.${timestamp}.${raw}`).digest("base64")
};
assert.equal((await signedVerifier(raw, signedHeaders)).type, "agent.session.idle");
await assert.rejects(() => signedVerifier(raw + " ", signedHeaders), /signature/i);
await assert.rejects(() => signedVerifier(raw, { ...signedHeaders, "webhook-timestamp": "1" }), /too old/i);
const signedProcessor = createWebhookProcessor({ store, orchestrator, verify: signedVerifier });
const signedFirst = await signedProcessor.ingest(raw, signedHeaders);
assert.equal(signedFirst.duplicate, false);
assert.equal((await signedProcessor.ingest(raw, signedHeaders)).duplicate, true);
console.log("official SDK webhook signature, tamper, expiry, and deduplication tests passed");
