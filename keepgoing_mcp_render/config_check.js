// Startup/readiness environment validation. Reports only variable NAMES and
// problem codes, never values, so the result is safe to log and to expose in
// /readiness.

const TRUE_RE = /^(1|true|yes)$/i;

/**
 * Parse a bounded integer environment setting. Invalid/out-of-range values
 * fall back to the known-safe default instead of producing NaN or silently
 * disabling a guard. An explicit zero is retained when min allows it.
 */
export function boundedEnvInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function validateEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const has = (name) => Boolean(String(env[name] || "").trim());
  const v12 = TRUE_RE.test(env.KEEPGOING_V12_ENABLED || "");

  if (!has("OPENAI_API_KEY")) errors.push("OPENAI_API_KEY missing");
  if (!has("KEEPGOING_OAUTH_SECRET")) errors.push("KEEPGOING_OAUTH_SECRET missing");
  else if (String(env.KEEPGOING_OAUTH_SECRET).length < 32) warnings.push("KEEPGOING_OAUTH_SECRET shorter than 32 characters");
  if (!has("KEEPGOING_OAUTH_CODE_URL")) errors.push("KEEPGOING_OAUTH_CODE_URL missing");
  if (!has("KEEPGOING_AUTH_URL")) errors.push("KEEPGOING_AUTH_URL missing");

  const ownerHash = String(env.KEEPGOING_OWNER_TOKEN_HASH || "");
  if (ownerHash && !/^[0-9a-f]{64}$/i.test(ownerHash)) {
    errors.push("KEEPGOING_OWNER_TOKEN_HASH is not a 64-character SHA-256 hex digest");
  }

  for (const name of [
    "KEEPGOING_PUBLIC_BASE_URL",
    "KEEPGOING_AUTH_URL",
    "KEEPGOING_CLAIM_URL",
    "KEEPGOING_BILLING_INGEST_URL",
    "KEEPGOING_CONFIG_URL",
    "KEEPGOING_OAUTH_CODE_URL",
    "KEEPGOING_DURABLE_STORE_URL",
    "KEEPGOING_SUPABASE_URL",
    "SUPABASE_URL"
  ]) {
    if (!has(name)) continue;
    try {
      const url = new URL(String(env[name]));
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        errors.push(name + " must use https");
      }
      if (url.username || url.password) errors.push(name + " must not embed credentials");
    } catch {
      errors.push(name + " is not a valid URL");
    }
  }

  if (v12) {
    const direct = has("KEEPGOING_SUPABASE_SERVICE_KEY") && (has("KEEPGOING_SUPABASE_URL") || has("SUPABASE_URL"));
    const proxy = has("KEEPGOING_DURABLE_STORE_URL") || has("KEEPGOING_BILLING_INGEST_URL");
    if (!direct && !proxy) errors.push("durable store not configured (Supabase direct or KEEPGOING_DURABLE_STORE_URL)");
    if (TRUE_RE.test(env.KEEPGOING_V12_CANARY_ONLY || "")) warnings.push("KEEPGOING_V12_CANARY_ONLY enabled: durable engine limited to owner");
  } else {
    warnings.push("KEEPGOING_V12_ENABLED not set: legacy v1.1 engine in use");
  }

  if (TRUE_RE.test(env.KEEPGOING_ALLOW_QUERY_TOKEN || "")) {
    warnings.push("KEEPGOING_ALLOW_QUERY_TOKEN enabled: tokens accepted in URLs (log exposure risk)");
  }

  const mode = String(env.PAYPAL_MODE || "live").toLowerCase();
  if (mode !== "live" && mode !== "sandbox") warnings.push("PAYPAL_MODE unrecognised; defaulting to live");

  for (const name of [
    "KEEPGOING_V12_WATCHDOG_INTERVAL_MS",
    "KEEPGOING_STALL_AFTER_MS",
    "KEEPGOING_MAX_STALL_RECOVERIES",
    "KEEPGOING_PROVIDER_TIMEOUT_MS",
    "KEEPGOING_STORE_TIMEOUT_MS",
    "KEEPGOING_MAX_ACTIVE_JOBS_PRO",
    "KEEPGOING_MAX_ACTIVE_JOBS_BUSINESS",
    "KEEPGOING_MAX_ACTIVE_JOBS_OWNER",
    "KEEPGOING_MCP_RATE_LIMIT_PER_MINUTE"
  ]) {
    if (has(name) && !(Number(env[name]) >= 0)) errors.push(name + " must be a non-negative number");
  }

  return { ok: errors.length === 0, errors, warnings };
}
