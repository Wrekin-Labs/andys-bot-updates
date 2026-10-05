// Small, dependency-free security helpers shared by server.js and the durable
// engine. Everything here is pure so it can be unit-tested without Express,
// the MCP SDK or network access.
import crypto from "node:crypto";
import path from "node:path";

export const OUTPUT_ROOT = "/workspace/outputs";
export const DURABLE_JOB_ID_RE = /^kgj_[0-9a-f]{32}$/;

/**
 * Return the canonical absolute path of an artifact if, and only if, it is
 * strictly inside /workspace/outputs. Rejects `..` traversal, NUL bytes,
 * relative paths and encoded escape attempts. Returns null otherwise.
 */
export function normaliseOutputArtifactPath(value) {
  const raw = String(value ?? "");
  if (!raw || raw.length > 1024) return null;
  if (/[\0\r\n]/.test(raw)) return null;
  const slashed = raw.replace(/\\/g, "/");
  if (!slashed.startsWith("/")) return null;
  // Reject any dot-segment outright rather than resolving it: a provider path
  // containing ".." is never legitimate output and resolving could mask abuse.
  if (slashed.split("/").some((part) => part === "..")) return null;
  // A trailing slash names a directory, never a publishable file.
  if (slashed.endsWith("/")) return null;
  const normalised = path.posix.normalize(slashed);
  if (normalised === OUTPUT_ROOT) return null; // directory itself is not a file
  if (!normalised.startsWith(OUTPUT_ROOT + "/")) return null;
  return normalised;
}

export function isPublishedOutputPath(value) {
  return normaliseOutputArtifactPath(value) !== null;
}

const MIME_BY_EXT = Object.freeze({
  ".patch": "text/x-diff",
  ".diff": "text/x-diff",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".html": "text/html"
});

export function artifactMimeType(filePath) {
  const ext = path.posix.extname(String(filePath || "").toLowerCase());
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/** File name only, stripped of control characters, bounded for display. */
export function safeArtifactName(filePath) {
  const base = path.posix.basename(String(filePath || ""));
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "artifact";
}

export function isDurableJobId(value) {
  return DURABLE_JOB_ID_RE.test(String(value || ""));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value == null ? "" : value).digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function timingSafeHexEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  if (left.length !== right.length || left.length % 2 !== 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

/**
 * Durable owner hash. Fails closed: an access object without a concrete
 * subject must never collapse onto a shared tier-wide owner, which would let
 * every customer on that tier see each other's jobs.
 */
export function ownerSubjectHash(access) {
  const subject = String(access?.subject || "").trim();
  if (!subject) {
    const error = new Error("KeepGoing account identity is unavailable; reconnect KeepGoing.");
    error.code = "owner_identity_missing";
    error.userFacing = true;
    throw error;
  }
  return sha256Hex(subject);
}

/**
 * Parse a Stripe-Signature header. Supports multiple v1 signatures (Stripe
 * sends several during secret rotation) and ignores unknown schemes.
 */
export function parseStripeSignatureHeader(header) {
  const result = { timestamp: "", signatures: [] };
  for (const part of String(header || "").split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") result.timestamp = value;
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) result.signatures.push(value.toLowerCase());
  }
  return result;
}

export function verifyStripeSignature({
  header,
  payload,
  secret,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  if (!secret) return { ok: false, reason: "not_configured" };
  const { timestamp, signatures } = parseStripeSignatureHeader(header);
  if (!/^\d{1,12}$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "invalid_signature" };
  }
  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + "." + String(payload ?? ""), "utf8")
    .digest("hex");
  const ok = signatures.some((candidate) => timingSafeHexEqual(expected, candidate));
  return ok ? { ok: true, timestamp: Number(timestamp) } : { ok: false, reason: "invalid_signature" };
}

/**
 * Deterministic fallback idempotency keys for MCP start calls that omit
 * clientRequestId. JSON-RPC ids are only unique per client connection (often
 * small integers), so the key also binds the request arguments and a bounded
 * time window. The previous window is returned too so a retry that straddles
 * the boundary still finds the original job instead of creating a duplicate.
 */
export function fallbackStartRequestIds({ rpcId, args, nowMs = Date.now(), windowMs = 10 * 60 * 1000 }) {
  if (rpcId == null || rpcId === "") return { current: null, previous: [] };
  const argsHash = sha256Hex(stableStringify({
    goal: args?.goal ?? "",
    definitionOfDone: args?.definitionOfDone ?? "",
    mode: args?.mode ?? "",
    allowWeb: args?.allowWeb ?? null,
    context: args?.context ?? "",
    codingWorkspace: Boolean(args?.codingWorkspace),
    repositoryUrl: args?.repositoryUrl ?? "",
    repositoryRef: args?.repositoryRef ?? "",
    workspaceFiles: Array.isArray(args?.workspaceFiles)
      ? args.workspaceFiles.map((file) => [String(file?.path ?? ""), sha256Hex(String(file?.content ?? ""))])
      : []
  })).slice(0, 32);
  const rpc = sha256Hex(String(rpcId)).slice(0, 16);
  const bucket = Math.floor(Number(nowMs) / windowMs);
  const make = (b) => "mcp-" + rpc + "-" + argsHash + "-" + b;
  return { current: make(bucket), previous: [make(bucket - 1)] };
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key]))
    .join(",") + "}";
}

const SECRETISH_RE = /(password|passwd|token|secret|credential|authorization|api[_-]?key|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{8,}|kg(at|rt|c|pp)_[a-z0-9_-]+)/i;

export function looksSecret(text) {
  return SECRETISH_RE.test(String(text || ""));
}

/**
 * Error classes whose messages are written by KeepGoing for end users and
 * are safe to return verbatim. Anything else (provider/store/network errors)
 * is replaced with a generic message plus a support reference.
 */
const USER_FACING_PATTERNS = [
  /^KeepGoing /,
  /^repository(Url|Ref)/,
  /^workspace ?[Ff]ile/,
  /^workspaceFiles/,
  /^each workspace file/,
  /^Job reports require/,
  /^repositoryUrl\/repositoryRef\/workspaceFiles/,
  /^Coding workspace requires/,
  /^Durable job (listing|resume) requires/,
  /^Job artifacts require/,
  /^Previous user input delivery is unresolved/,
  /^input is required/,
  /^Artifact is outside/,
  /^artifact (exceeds|type|is not)/,
  /^valid artifact id required/,
  /^job quota/i,
  /^token_required|^monthly_limit|^subscription/i,
  /^Too many active KeepGoing jobs/
];

export function clientSafeError(error, requestId = "") {
  const message = String(error?.message || error || "KeepGoing request failed");
  const ref = requestId ? " (ref " + String(requestId).slice(0, 64) + ")" : "";
  if (looksSecret(message)) {
    return { message: "KeepGoing request failed" + ref + ".", code: "internal_error" };
  }
  if (error?.userFacing || USER_FACING_PATTERNS.some((re) => re.test(message))) {
    return { message: message.slice(0, 500), code: String(error?.code || "request_rejected") };
  }
  if (error?.code === "provider_timeout" || error?.code === "store_timeout") {
    return { message: "KeepGoing's upstream service timed out. The job state is preserved; retry the same request" + ref + ".", code: error.code };
  }
  if (error?.code === "provider_rate_limited") {
    return { message: "KeepGoing's model provider is rate limiting requests. Retry the same request shortly" + ref + ".", code: error.code };
  }
  return { message: "KeepGoing could not complete this request. Retry the same request or check the job status" + ref + ".", code: "internal_error" };
}

/** Redact secret-looking substrings for log lines. */
export function redactForLog(value, max = 500) {
  const text = String(value?.message || value || "");
  if (looksSecret(text)) return "redacted protected error";
  return text.replace(/[\r\n]+/g, " ").slice(0, max);
}
