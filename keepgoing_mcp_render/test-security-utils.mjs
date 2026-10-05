import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  normaliseOutputArtifactPath,
  isPublishedOutputPath,
  artifactMimeType,
  safeArtifactName,
  isDurableJobId,
  ownerSubjectHash,
  parseStripeSignatureHeader,
  verifyStripeSignature,
  fallbackStartRequestIds,
  stableStringify,
  looksSecret,
  clientSafeError,
  redactForLog,
  timingSafeHexEqual
} from "./security_utils.js";

// ---- artifact paths: only strictly inside /workspace/outputs
assert.equal(normaliseOutputArtifactPath("/workspace/outputs/changes.patch"), "/workspace/outputs/changes.patch");
assert.equal(normaliseOutputArtifactPath("/workspace/outputs/sub/dir/r.md"), "/workspace/outputs/sub/dir/r.md");
assert.equal(normaliseOutputArtifactPath("\\workspace\\outputs\\win.txt"), "/workspace/outputs/win.txt");
for (const bad of [
  "/workspace/outputs",
  "/workspace/outputs/",
  "/workspace/outputs/../etc/passwd",
  "/workspace/outputs/a/../../project/.env",
  "/workspace/outputsevil/x",
  "workspace/outputs/x",
  "/workspace/project/x",
  "/workspace/outputs/x\0.txt",
  "/workspace/outputs/x\n.txt",
  "",
  null,
  "/workspace/outputs/" + "a".repeat(2000)
]) {
  assert.equal(normaliseOutputArtifactPath(bad), null, "rejects " + JSON.stringify(bad));
  assert.equal(isPublishedOutputPath(bad), false);
}

assert.equal(artifactMimeType("/workspace/outputs/a.patch"), "text/x-diff");
assert.equal(artifactMimeType("/workspace/outputs/A.MD"), "text/markdown");
assert.equal(artifactMimeType("/workspace/outputs/blob.bin"), "application/octet-stream");
assert.equal(safeArtifactName("/workspace/outputs/dir/re\u0007port.md"), "report.md");
assert.equal(safeArtifactName(""), "artifact");

// ---- job ids
assert.equal(isDurableJobId("kgj_" + "a".repeat(32)), true);
for (const bad of ["kgj_" + "A".repeat(32), "kgj_" + "a".repeat(31), "resp_123", "../kgj", "kgj_" + "a".repeat(32) + "&x=1"]) {
  assert.equal(isDurableJobId(bad), false, bad);
}

// ---- owner hash fails closed and stays compatible with pre-1.5 derivation
assert.equal(ownerSubjectHash({ subject: "cust_1" }), crypto.createHash("sha256").update("cust_1").digest("hex"));
for (const access of [{}, { tier: "pro" }, { subject: "   " }, null]) {
  assert.throws(() => ownerSubjectHash(access), (error) => error.code === "owner_identity_missing");
}
assert.notEqual(ownerSubjectHash({ subject: "a", tier: "pro" }), ownerSubjectHash({ subject: "b", tier: "pro" }));

// ---- Stripe signatures: rotation (multiple v1), tolerance, tampering
const secret = "whsec_test";
const payload = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
const t = 1_800_000_000;
const sig = (s, ts = t, body = payload) => crypto.createHmac("sha256", s).update(ts + "." + body).digest("hex");
assert.deepEqual(parseStripeSignatureHeader("t=1,v1=" + "a".repeat(64) + ",v0=zzz,v1=bad"), { timestamp: "1", signatures: ["a".repeat(64)] });
assert.equal(verifyStripeSignature({ header: "t=" + t + ",v1=" + sig(secret), payload, secret, nowSeconds: t }).ok, true);
assert.equal(verifyStripeSignature({ header: "t=" + t + ",v1=" + sig("old") + ",v1=" + sig(secret), payload, secret, nowSeconds: t }).ok, true,
  "accepts the matching signature among several during rotation");
assert.equal(verifyStripeSignature({ header: "t=" + t + ",v1=" + sig(secret), payload: payload + " ", secret, nowSeconds: t }).ok, false);
assert.equal(verifyStripeSignature({ header: "t=" + t + ",v1=" + sig(secret), payload, secret, nowSeconds: t + 301 }).reason, "timestamp_outside_tolerance");
assert.equal(verifyStripeSignature({ header: "v1=" + sig(secret), payload, secret, nowSeconds: t }).reason, "invalid_signature");
assert.equal(verifyStripeSignature({ header: "t=" + t + ",v1=" + sig(secret), payload, secret: "", nowSeconds: t }).reason, "not_configured");
assert.equal(timingSafeHexEqual("ab", "abc"), false);
assert.equal(timingSafeHexEqual("zz", "zz"), false);

// ---- fallback start ids bind rpc id AND arguments
const now = 1_000_000_000_000;
const a1 = fallbackStartRequestIds({ rpcId: 1, args: { goal: "alpha" }, nowMs: now });
const a1again = fallbackStartRequestIds({ rpcId: 1, args: { goal: "alpha" }, nowMs: now + 1000 });
const b1 = fallbackStartRequestIds({ rpcId: 1, args: { goal: "beta" }, nowMs: now });
const a2 = fallbackStartRequestIds({ rpcId: 2, args: { goal: "alpha" }, nowMs: now });
assert.equal(a1.current, a1again.current, "identical retry maps to the same key");
assert.notEqual(a1.current, b1.current, "different goal with the same JSON-RPC id is a different key");
assert.notEqual(a1.current, a2.current);
const nextWindow = fallbackStartRequestIds({ rpcId: 1, args: { goal: "alpha" }, nowMs: now + 10 * 60 * 1000 });
assert.ok(nextWindow.previous.includes(a1.current), "retry across the window boundary still finds the original");
assert.deepEqual(fallbackStartRequestIds({ rpcId: null, args: {} }), { current: null, previous: [] });
const withFiles = fallbackStartRequestIds({ rpcId: 1, args: { goal: "alpha", workspaceFiles: [{ path: "a", content: "1" }] }, nowMs: now });
const withOtherFiles = fallbackStartRequestIds({ rpcId: 1, args: { goal: "alpha", workspaceFiles: [{ path: "a", content: "2" }] }, nowMs: now });
assert.notEqual(withFiles.current, withOtherFiles.current);
assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');

// ---- secret detection / client-safe errors / log redaction
assert.equal(looksSecret("Bearer abc.def"), true);
assert.equal(looksSecret("sk-proj-abcdefghijk"), true);
assert.equal(looksSecret("kgat_abc"), true);
assert.equal(looksSecret("KeepGoing job not found"), false);
assert.deepEqual(clientSafeError(new Error("KeepGoing job not found")), { message: "KeepGoing job not found", code: "request_rejected" });
const internal = clientSafeError(new Error("ECONNRESET at 10.0.0.4:5432"), "req-1");
assert.equal(internal.code, "internal_error");
assert.match(internal.message, /ref req-1/);
assert.doesNotMatch(internal.message, /ECONNRESET/);
assert.equal(clientSafeError(new Error("invalid api_key sk-live-123456789")).code, "internal_error");
assert.equal(clientSafeError(Object.assign(new Error("x"), { code: "provider_timeout" })).code, "provider_timeout");
assert.equal(clientSafeError(Object.assign(new Error("custom"), { userFacing: true, code: "active_job_limit" })).code, "active_job_limit");
assert.equal(clientSafeError(new Error("each workspace file must contain path and content")).code, "request_rejected");
assert.equal(redactForLog(new Error("token=abc")), "redacted protected error");
assert.equal(redactForLog("line1\nline2"), "line1 line2");

console.log("security utils tests passed");
