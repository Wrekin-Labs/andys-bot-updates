import express from "express";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createAgentsEngine } from "./agents_engine.js";
import { SupabaseJobStore } from "./supabase_job_store.js";
import { KeepGoingOrchestrator } from "./job_orchestrator.js";
import { createOpenAIWebhookVerifier, createWebhookProcessor } from "./webhook_processor.js";
import { createWatchdog } from "./watchdog.js";
import { createV12Service } from "./v12_service.js";
import { buildStartDevTaskArgs, devTaskToolDescription } from "./dev_task_adapter.js";
import { renderDevDashboard } from "./dev_dashboard.js";

const app = express();
app.disable("x-powered-by");
const APP_VERSION = "1.4.0-beta.24";
const ICON_PNG_FILE = fileURLToPath(new URL("./assets/keepgoing-icon.png", import.meta.url));

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PRO_PRICE_ID = process.env.KEEPGOING_PRO_PRICE_ID || "price_1UJy24B86Ss16l9WEsqSRxh1";
const BUSINESS_PRICE_ID = process.env.KEEPGOING_BUSINESS_PRICE_ID || "price_1UJy26B86Ss16l9W8id4FSsw";
const BILLING_INGEST_URL = process.env.KEEPGOING_BILLING_INGEST_URL || "";
const BILLING_INGEST_TOKEN = process.env.KEEPGOING_BILLING_INGEST_TOKEN || "";
const CLAIM_URL = process.env.KEEPGOING_CLAIM_URL || "";
const AUTH_URL = process.env.KEEPGOING_AUTH_URL || "";
const BILLING_CONFIG_URL = process.env.KEEPGOING_CONFIG_URL || "";
const PORTAL_URL = process.env.KEEPGOING_PORTAL_URL || "";
const PUBLIC_BASE_URL = (process.env.KEEPGOING_PUBLIC_BASE_URL || "https://keepgoing-mcp.onrender.com").replace(/\/$/, "");
const OAUTH_SECRET = process.env.KEEPGOING_OAUTH_SECRET || "";
const OAUTH_SCOPE = "keepgoing.jobs";
const OPENAI_APPS_CHALLENGE = process.env.OPENAI_APPS_CHALLENGE || "";
const OAUTH_CODE_URL = process.env.KEEPGOING_OAUTH_CODE_URL || "";

const V12_ENABLED = /^(1|true|yes)$/i.test(process.env.KEEPGOING_V12_ENABLED || "");
const V12_CANARY_ONLY = /^(1|true|yes)$/i.test(process.env.KEEPGOING_V12_CANARY_ONLY || "");
const V12_SUPABASE_URL = process.env.KEEPGOING_SUPABASE_URL || process.env.SUPABASE_URL || "";
const V12_SUPABASE_SERVICE_KEY = process.env.KEEPGOING_SUPABASE_SERVICE_KEY || "";
const V12_DURABLE_STORE_URL = process.env.KEEPGOING_DURABLE_STORE_URL || (
  BILLING_INGEST_URL.includes("/keepgoing-billing-ingest")
    ? BILLING_INGEST_URL.replace(/\/keepgoing-billing-ingest\/?$/, "/keepgoing-durable-store")
    : ""
);
const V12_DURABLE_STORE_TOKEN = process.env.KEEPGOING_DURABLE_STORE_TOKEN || BILLING_INGEST_TOKEN;
const OPENAI_WEBHOOK_SECRET = process.env.OPENAI_WEBHOOK_SECRET || "";
const V12_WATCHDOG_INTERVAL_MS = Math.max(10_000, Number(process.env.KEEPGOING_V12_WATCHDOG_INTERVAL_MS || 15_000));

const PAYPAL_MODE = (process.env.PAYPAL_MODE || "live").toLowerCase() === "sandbox" ? "sandbox" : "live";
let paypalClientId = process.env.PAYPAL_CLIENT_ID || "";
let paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_BASE = PAYPAL_MODE === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";
const PAYPAL_BOOTSTRAP_TOKEN_HASH = "293b9c5e1f00676fe221870060d8796319b58fe2c97d678beb15a5910a5962c5";
const PAYPAL_BOOTSTRAP_EXPIRES_AT = Date.parse("2026-09-30T00:00:00Z");
const PAYPAL_CREDENTIAL_PREFIX = "kgpp_";
let paypalBootstrapUsed = false;

let paypalConfig = {
  product_id: "",
  pro_plan_id: "",
  business_plan_id: "",
  webhook_id: "",
  webhook_url: ""
};
let paypalSetupPromise = null;
let paypalSetupComplete = false;
let paypalSetupError = "";

app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.status(503).send("Stripe webhook not configured");
  const header = String(req.headers["stripe-signature"] || "");
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const timestamp = parts.t || "";
  const signature = parts.v1 || "";
  if (!timestamp || !signature) return res.status(400).send("Invalid webhook signature");

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return res.status(400).send("Webhook timestamp outside tolerance");

  const payload = req.body.toString("utf8");
  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(timestamp + "." + payload, "utf8")
    .digest("hex");

  let verified = false;
  try {
    verified = crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {}
  if (!verified) return res.status(400).send("Invalid webhook signature");

  let event;
  try { event = JSON.parse(payload); }
  catch { return res.status(400).send("Invalid JSON"); }

  const relevant = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed"
  ]);

  if (relevant.has(event.type)) {
    console.log("stripe_event", event.type, event.data?.object?.id || "");
    try {
      await forwardBillingEvent("stripe", event.type, event.data?.object || {}, null);
    } catch (error) {
      console.error("stripe_billing_ingest_error", safeLogError(error), req.keepgoingRequestId || "");
      return res.status(500).json({ error: "billing_ingest_error" });
    }
  }
  return res.json({ received: true });
});

app.post("/paypal/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!paypalClientId || !paypalClientSecret) return res.status(503).send("PayPal not configured");
  try {
    await ensurePayPalSetup();
  } catch (error) {
    console.error("paypal_setup_error", safeLogError(error), req.keepgoingRequestId || "");
    return res.status(503).send("PayPal setup incomplete");
  }
  if (!paypalConfig.webhook_id) return res.status(503).send("PayPal webhook not configured");

  const raw = req.body.toString("utf8");
  let event;
  try { event = JSON.parse(raw); }
  catch { return res.status(400).send("Invalid JSON"); }

  const h = req.headers;
  const authAlgo = String(h["paypal-auth-algo"] || "");
  const certUrl = String(h["paypal-cert-url"] || "");
  const transmissionId = String(h["paypal-transmission-id"] || "");
  const transmissionSig = String(h["paypal-transmission-sig"] || "");
  const transmissionTime = String(h["paypal-transmission-time"] || "");
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return res.status(400).send("Missing PayPal signature headers");
  }

  const token = await paypalAccessToken();
  const verifyBody =
    '{"auth_algo":' + JSON.stringify(authAlgo) +
    ',"cert_url":' + JSON.stringify(certUrl) +
    ',"transmission_id":' + JSON.stringify(transmissionId) +
    ',"transmission_sig":' + JSON.stringify(transmissionSig) +
    ',"transmission_time":' + JSON.stringify(transmissionTime) +
    ',"webhook_id":' + JSON.stringify(paypalConfig.webhook_id) +
    ',"webhook_event":' + raw + '}';

  const verify = await fetchWithTimeout(PAYPAL_BASE + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: verifyBody
  });
  const verification = await verify.json().catch(() => ({}));
  if (!verify.ok || verification.verification_status !== "SUCCESS") {
    console.error("paypal_webhook_verify_failed", verify.status, String(verification?.verification_status || "unknown"), req.keepgoingRequestId || "");
    return res.status(400).send("Invalid PayPal webhook signature");
  }

  const relevant = new Set([
    "BILLING.SUBSCRIPTION.CREATED",
    "BILLING.SUBSCRIPTION.ACTIVATED",
    "BILLING.SUBSCRIPTION.UPDATED",
    "BILLING.SUBSCRIPTION.EXPIRED",
    "BILLING.SUBSCRIPTION.CANCELLED",
    "BILLING.SUBSCRIPTION.SUSPENDED",
    "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
    "PAYMENT.SALE.COMPLETED",
    "PAYMENT.SALE.REFUNDED",
    "PAYMENT.SALE.REVERSED"
  ]);

  if (relevant.has(event.event_type)) {
    const planId = String(event.resource?.plan_id || "");
    const tier =
      planId && planId === paypalConfig.business_plan_id ? "business" :
      planId && planId === paypalConfig.pro_plan_id ? "pro" : null;
    try {
      await forwardBillingEvent("paypal", event.event_type, event.resource || {}, tier);
    } catch (error) {
      console.error("paypal_billing_ingest_error", safeLogError(error), req.keepgoingRequestId || "");
      return res.status(500).json({ error: "billing_ingest_error" });
    }
  }

  return res.json({ received: true });
});

app.post("/openai/webhook", express.text({ type: "application/json", limit: "512kb" }), async (req, res) => {
  if (!V12_ENABLED) return res.status(404).send("Not found");
  let runtime;
  try {
    runtime = getV12Runtime();
  } catch {
    return res.status(503).send("KeepGoing v1.2 not configured");
  }
  if (!runtime.webhookProcessor) return res.status(503).send("OpenAI webhook not configured");

  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, String(item));
      } else if (value != null) {
        headers.set(name, String(value));
      }
    }
    const accepted = await runtime.webhookProcessor.ingest(String(req.body || ""), headers);
    res.status(202).json({ received: true, duplicate: accepted.duplicate });

    if (accepted.shouldReconcile && !accepted.duplicate) {
      setImmediate(() => {
        runtime.webhookProcessor.process(accepted).catch((error) => {
          console.error("keepgoing_v12_webhook_process_error", safeLogError(error));
        });
      });
    }
  } catch (error) {
    console.error("keepgoing_v12_webhook_verify_error", safeLogError(error));
    return res.status(400).send("Invalid OpenAI webhook");
  }
});

app.use(express.json({ limit: "384kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.set("trust proxy", 1);

app.use((req, res, next) => {
  const supplied = String(req.headers["x-request-id"] || "").trim();
  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  req.keepgoingRequestId = requestId;
  res.set("X-Request-Id", requestId);
  next();
});

const rateWindows = new Map();

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 128);
}

function rateLimit(keyPrefix, maxRequests, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = keyPrefix + ":" + clientIp(req);
    let entry = rateWindows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      rateWindows.set(key, entry);
    }
    entry.count += 1;

    // Opportunistic pruning keeps the in-memory limiter bounded without a timer.
    if (rateWindows.size > 2000) {
      for (const [k, v] of rateWindows) {
        if (v.resetAt <= now) rateWindows.delete(k);
        if (rateWindows.size <= 1500) break;
      }
    }

    if (entry.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      res.set("Cache-Control", "no-store");
      return res.status(429).json({ error: "rate_limited", retry_after_seconds: retryAfter });
    }
    next();
  };
}

app.use("/oauth/authorize", rateLimit("oauth-authorize", 30, 15 * 60 * 1000));
app.use("/oauth/token", rateLimit("oauth-token", 60, 15 * 60 * 1000));
app.use("/billing/claim", rateLimit("stripe-claim", 30, 15 * 60 * 1000));
app.use("/paypal/claim", rateLimit("paypal-claim", 30, 15 * 60 * 1000));
app.use("/paypal/start-subscription", rateLimit("paypal-start", 20, 15 * 60 * 1000));
app.use("/owner/paypal-setup", rateLimit("paypal-bootstrap", 20, 15 * 60 * 1000));
app.use("/dev/api", rateLimit("dev-dashboard", 240, 15 * 60 * 1000));

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "DENY");
  res.set("Strict-Transport-Security", "max-age=31536000");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  const sensitivePath =
    req.path === "/mcp" ||
    req.path === "/subscribe" ||
    req.path.startsWith("/oauth/") ||
    req.path.startsWith("/billing/") ||
    req.path.startsWith("/paypal/") ||
    req.path.startsWith("/openai/") ||
    req.path.startsWith("/owner/") ||
    req.path === "/dev" ||
    req.path.startsWith("/dev/");

  if (sensitivePath) {
    res.set("Cache-Control", "no-store");
  }

  if (
    sensitivePath ||
    req.path === "/health" ||
    req.path === "/readiness" ||
    req.path.startsWith("/.well-known/")
  ) {
    res.set("X-Robots-Tag", "noindex, nofollow");
  }
  next();
});

const PORT = Number(process.env.PORT || 10000);
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const PRO_MAX_OUTPUT_TOKENS = Number(process.env.KEEPGOING_PRO_MAX_OUTPUT_TOKENS || 10000);
const BUSINESS_MAX_OUTPUT_TOKENS = Number(process.env.KEEPGOING_BUSINESS_MAX_OUTPUT_TOKENS || 20000);
const PRO_MAX_TOOL_CALLS = Number(process.env.KEEPGOING_PRO_MAX_TOOL_CALLS || 3);
const BUSINESS_MAX_TOOL_CALLS = Number(process.env.KEEPGOING_BUSINESS_MAX_TOOL_CALLS || 5);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TOKEN_HASH = process.env.KEEPGOING_OWNER_TOKEN_HASH || "";

let v12RuntimeCache = null;

function v12Configured() {
  const directStoreReady = Boolean(V12_SUPABASE_URL && V12_SUPABASE_SERVICE_KEY);
  const proxyStoreReady = Boolean(V12_DURABLE_STORE_URL && V12_DURABLE_STORE_TOKEN);
  return Boolean(
    V12_ENABLED &&
    OPENAI_API_KEY &&
    (directStoreReady || proxyStoreReady)
  );
}

function v12ForAccess(access) {
  if (!V12_ENABLED) return false;
  if (!V12_CANARY_ONLY) return true;
  return Boolean(access?.admin || access?.tier === "owner");
}

function getV12Runtime() {
  if (v12RuntimeCache) return v12RuntimeCache;
  if (!v12Configured()) throw new Error("KeepGoing v1.2 durable engine is not configured");

  const engine = createAgentsEngine({
    apiKey: OPENAI_API_KEY,
    model: MODEL
  });
  const store = new SupabaseJobStore({
    supabaseUrl: V12_SUPABASE_URL,
    serviceKey: V12_SUPABASE_SERVICE_KEY,
    proxyUrl: V12_DURABLE_STORE_URL,
    proxyToken: V12_DURABLE_STORE_TOKEN
  });
  const orchestrator = new KeepGoingOrchestrator({ engine, store });
  const service = createV12Service({ engine, store, orchestrator, model: MODEL });
  const watchdog = createWatchdog({ store, orchestrator });
  const webhookProcessor = OPENAI_WEBHOOK_SECRET
    ? createWebhookProcessor({
        store,
        orchestrator,
        verify: createOpenAIWebhookVerifier({
          apiKey: OPENAI_API_KEY,
          webhookSecret: OPENAI_WEBHOOK_SECRET
        })
      })
    : null;

  v12RuntimeCache = { engine, store, orchestrator, service, watchdog, webhookProcessor };
  return v12RuntimeCache;
}

function safeLogError(error) {
  const message = String(error?.message || error || "error");
  return /password|token|secret|credential|authorization/i.test(message)
    ? "redacted protected error"
    : message.slice(0, 500);
}

function fetchWithTimeout(url, init = {}, timeoutMs = 10_000) {
  if (init.signal) return fetch(url, init);
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function durableOwnerHash(access) {
  return digest(String(access?.subject || access?.tier || "customer"));
}

async function reserveJobQuota(access) {
  if (access?.admin) return;
  const token = String(access?._customer_token || "");
  if (!token) throw new Error("job quota credential unavailable");
  const result = await validateCustomerToken(token, true);
  if (!result.ok) throw new Error(result.error || "job quota unavailable");
}

function digest(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function oauthKey() {
  if (!OAUTH_SECRET) throw new Error("oauth_not_configured");
  return crypto.createHash("sha256").update(OAUTH_SECRET, "utf8").digest();
}

function sealToken(prefix, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", oauthKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return prefix + base64url(Buffer.concat([iv, tag, ciphertext]));
}

function unsealToken(prefix, value) {
  if (!value || !String(value).startsWith(prefix)) throw new Error("invalid_token_format");
  const packed = Buffer.from(String(value).slice(prefix.length), "base64url");
  if (packed.length < 29) throw new Error("invalid_token_format");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", oauthKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

function validChatGptRedirect(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return false;
    return url.pathname === "/connector_platform_oauth_redirect" ||
      url.pathname.startsWith("/connector/oauth/");
  } catch {
    return false;
  }
}

function validChatGptClientId(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      url.pathname.startsWith("/oauth/") &&
      url.pathname.endsWith("/client.json");
  } catch {
    return false;
  }
}

const cimdCache = new Map();

async function validateCimdClient(clientId, redirectUri) {
  if (!validChatGptClientId(clientId) || !validChatGptRedirect(redirectUri)) return false;
  const cached = cimdCache.get(clientId);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.redirects.includes(redirectUri) && cached.methods.includes("none");
  }
  try {
    const response = await fetch(clientId, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;
    const doc = await response.json();
    const redirects = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String) : [];
    const methods = Array.isArray(doc.token_endpoint_auth_methods_supported)
      ? doc.token_endpoint_auth_methods_supported.map(String)
      : [String(doc.token_endpoint_auth_method || "")].filter(Boolean);
    cimdCache.set(clientId, { redirects, methods, expires: now + 300000 });
    return redirects.includes(redirectUri) && methods.includes("none");
  } catch {
    return false;
  }
}

function safeResource(value) {
  return !value || String(value).replace(/\/$/, "") === PUBLIC_BASE_URL;
}

function oauthChallenge(res, error = "invalid_token", description = "Authentication is required") {
  const metadata = PUBLIC_BASE_URL + "/.well-known/oauth-protected-resource";
  res.set("WWW-Authenticate", 'Bearer resource_metadata="' + metadata + '", scope="' + OAUTH_SCOPE + '", error="' + error + '", error_description="' + String(description).replace(/"/g, "") + '"');
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setOAuthPageHeaders(res) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
  return res;
}


function validPayPalBootstrapToken(value) {
  if (paypalBootstrapUsed || Date.now() > PAYPAL_BOOTSTRAP_EXPIRES_AT) return false;
  const candidate = digest(String(value || ""));
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(PAYPAL_BOOTSTRAP_TOKEN_HASH, "hex")
    );
  } catch {
    return false;
  }
}

async function paypalAccessTokenFor(clientId, clientSecret) {
  const id = String(clientId || "").trim();
  const secret = String(clientSecret || "").trim();
  if (!id || !secret) throw new Error("PayPal credentials are required");
  const basic = Buffer.from(id + ":" + secret).toString("base64");
  const response = await fetchWithTimeout(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || ("PayPal OAuth failed (" + response.status + ")"));
  }
  return data.access_token;
}

async function loadStoredPayPalCredentials() {
  if (paypalClientId && paypalClientSecret) return true;
  if (!BILLING_CONFIG_URL || !BILLING_INGEST_TOKEN || !OAUTH_SECRET) return false;
  const stored = await billingConfig("get");
  const sealed = String(stored.credentials_encrypted || "");
  if (!sealed) return false;
  const payload = unsealToken(PAYPAL_CREDENTIAL_PREFIX, sealed);
  const id = String(payload?.client_id || "").trim();
  const secret = String(payload?.client_secret || "").trim();
  if (!id || !secret) return false;
  paypalClientId = id;
  paypalClientSecret = secret;
  paypalBootstrapUsed = true;
  return true;
}

async function persistPayPalCredentials(clientId, clientSecret) {
  const id = String(clientId || "").trim();
  const secret = String(clientSecret || "").trim();
  if (id.length < 20 || secret.length < 20) throw new Error("PayPal credentials look incomplete");

  await paypalAccessTokenFor(id, secret);

  const stored = await billingConfig("get");
  const credentialsEncrypted = sealToken(PAYPAL_CREDENTIAL_PREFIX, {
    client_id: id,
    client_secret: secret,
    saved_at: new Date().toISOString()
  });
  await billingConfig("set", { ...stored, credentials_encrypted: credentialsEncrypted });

  paypalClientId = id;
  paypalClientSecret = secret;
  paypalSetupComplete = false;
  paypalSetupError = "";
  paypalSetupPromise = null;

  const ready = await ensurePayPalSetup();
  if (!ready) throw new Error("PayPal setup did not complete");
  paypalBootstrapUsed = true;
  return true;
}

app.get("/owner/paypal-setup", (req, res) => {
  setOAuthPageHeaders(res);
  const setupToken = String(req.query?.setup || "");
  if (!validPayPalBootstrapToken(setupToken)) {
    return res.status(410).type("html").send(infoPage(
      "PayPal setup link expired",
      "<p>This one-time setup link is invalid, expired or already used.</p>"
    ));
  }
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect PayPal Live — KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}.card{width:min(680px,100%);box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:18px;padding:30px}label{display:block;font-weight:700;margin:18px 0 8px}input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #484f58;background:#0d1117;color:#fff;font:inherit}button{width:100%;margin-top:20px;padding:13px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font-weight:700;font-size:16px}.muted{color:#8b949e;font-size:14px}</style></head><body><div class="card"><h1>Connect PayPal Live</h1><p>Paste the Live credentials from the KeepGoing PayPal app. They are validated against PayPal, encrypted with KeepGoing&#39;s server key, and stored in the protected billing configuration. They are never returned to ChatGPT.</p><form method="post" action="/owner/paypal-setup"><input type="hidden" name="setup" value="' + htmlEscape(setupToken) + '"><label for="client_id">PayPal Client ID</label><input id="client_id" name="client_id" type="password" autocomplete="off" required><label for="client_secret">PayPal Secret key</label><input id="client_secret" name="client_secret" type="password" autocomplete="off" required><button type="submit">Connect PayPal Live</button></form><p class="muted">Use the Live app credentials only. Do not paste these credentials into a chat message.</p></div></body></html>';
  return res.type("html").send(html);
});

app.post("/owner/paypal-setup", async (req, res) => {
  setOAuthPageHeaders(res);
  const setupToken = String(req.body?.setup || "");
  if (!validPayPalBootstrapToken(setupToken)) {
    return res.status(410).type("html").send(infoPage(
      "PayPal setup link expired",
      "<p>This one-time setup link is invalid, expired or already used.</p>"
    ));
  }

  try {
    await persistPayPalCredentials(req.body?.client_id, req.body?.client_secret);
    return res.type("html").send(infoPage(
      "PayPal Live connected",
      "<p><strong>Success.</strong> KeepGoing validated the Live credentials and created or recovered its PayPal product, subscription plans and webhook.</p><p>You can close this tab.</p>"
    ));
  } catch (error) {
    console.error("paypal_secure_bootstrap_error", safeLogError(error));
    const message = htmlEscape(safeLogError(error));
    return res.status(400).type("html").send(infoPage(
      "PayPal setup failed",
      "<p>The credentials were not stored because validation/setup failed.</p><p><code>" + message + "</code></p><p>Go back and check that you copied the Live Client ID and Secret key.</p>"
    ));
  }
});

async function forwardBillingEvent(provider, type, object, tier) {
  if (!BILLING_INGEST_URL || !BILLING_INGEST_TOKEN) throw new Error("billing_ingest_not_configured");
  const response = await fetchWithTimeout(BILLING_INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-keepgoing-ingest-token": BILLING_INGEST_TOKEN
    },
    body: JSON.stringify({ provider, type, object, tier })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || ("billing ingest failed (" + response.status + ")"));
  return data;
}

async function billingConfig(action, config) {
  if (!BILLING_CONFIG_URL || !BILLING_INGEST_TOKEN) throw new Error("billing_config_not_configured");
  const provider = "paypal_" + PAYPAL_MODE;
  const response = await fetchWithTimeout(BILLING_CONFIG_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-keepgoing-ingest-token": BILLING_INGEST_TOKEN
    },
    body: JSON.stringify({ action, provider, config })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || ("billing config failed (" + response.status + ")"));
  return data.config || {};
}

async function paypalAccessToken() {
  return paypalAccessTokenFor(paypalClientId, paypalClientSecret);
}

async function paypalApi(path, init = {}) {
  const token = await paypalAccessToken();
  const response = await fetchWithTimeout(PAYPAL_BASE + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = data?.details?.[0]?.description || data?.message || data?.name || ("PayPal API failed (" + response.status + ")");
    const error = new Error(issue);
    error.status = response.status;
    error.paypal_name = data?.name || null;
    throw error;
  }
  return data;
}

function safePayPalApprovalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    const allowed = PAYPAL_MODE === "sandbox"
      ? new Set(["www.sandbox.paypal.com", "www.paypal.com"])
      : new Set(["www.paypal.com"]);
    return allowed.has(host) ? url.href : "";
  } catch {
    return "";
  }
}

function paypalPlanBody(productId, name, description, value) {
  return {
    product_id: productId,
    name,
    description,
    billing_cycles: [{
      frequency: { interval_unit: "MONTH", interval_count: 1 },
      tenure_type: "REGULAR",
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: {
        fixed_price: { value, currency_code: "GBP" }
      }
    }],
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3
    }
  };
}

async function ensurePayPalSetup() {
  if (!paypalClientId || !paypalClientSecret) return false;
  if (paypalSetupComplete) return true;
  if (paypalSetupPromise) return paypalSetupPromise;

  paypalSetupPromise = (async () => {
    paypalSetupError = "";
    const stored = await billingConfig("get");
    paypalConfig = { ...paypalConfig, ...stored };

    if (!paypalConfig.product_id) {
      const product = await paypalApi("/v1/catalogs/products", {
        method: "POST",
        headers: { "PayPal-Request-Id": "keepgoing-" + PAYPAL_MODE + "-product-v1" },
        body: JSON.stringify({
          name: "KeepGoing",
          description: "Persistent AI background jobs that continue without repeated continue prompts.",
          type: "SERVICE",
          home_url: PUBLIC_BASE_URL
        })
      });
      paypalConfig.product_id = product.id;
      await billingConfig("set", paypalConfig);
    }

    if (!paypalConfig.pro_plan_id) {
      const plan = await paypalApi("/v1/billing/plans", {
        method: "POST",
        headers: { "PayPal-Request-Id": "keepgoing-" + PAYPAL_MODE + "-pro-v1" },
        body: JSON.stringify(paypalPlanBody(
          paypalConfig.product_id,
          "KeepGoing Pro",
          "100 persistent AI background jobs per month.",
          "7.99"
        ))
      });
      paypalConfig.pro_plan_id = plan.id;
      await billingConfig("set", paypalConfig);
    }

    if (!paypalConfig.business_plan_id) {
      const plan = await paypalApi("/v1/billing/plans", {
        method: "POST",
        headers: { "PayPal-Request-Id": "keepgoing-" + PAYPAL_MODE + "-business-v1" },
        body: JSON.stringify(paypalPlanBody(
          paypalConfig.product_id,
          "KeepGoing Business",
          "500 persistent AI background jobs per month.",
          "29.00"
        ))
      });
      paypalConfig.business_plan_id = plan.id;
      await billingConfig("set", paypalConfig);
    }

    const desiredWebhookUrl = PUBLIC_BASE_URL + "/paypal/webhook";
    let existingWebhook = null;

    if (paypalConfig.webhook_id) {
      try {
        existingWebhook = await paypalApi(
          "/v1/notifications/webhooks/" + encodeURIComponent(paypalConfig.webhook_id),
          { method: "GET" }
        );
      } catch (error) {
        // A webhook may have been deleted manually from the PayPal app while
        // its ID remains in KeepGoing billing config. Re-create only for 404;
        // all other PayPal failures remain fail-closed.
        if (Number(error?.status || 0) === 404) {
          paypalConfig.webhook_id = "";
          paypalConfig.webhook_url = "";
          await billingConfig("set", paypalConfig);
        } else {
          throw error;
        }
      }
    }

    if (paypalConfig.webhook_id && existingWebhook) {
      const currentWebhookUrl = String(existingWebhook.url || "");
      if (currentWebhookUrl !== desiredWebhookUrl) {
        await paypalApi(
          "/v1/notifications/webhooks/" + encodeURIComponent(paypalConfig.webhook_id),
          {
            method: "PATCH",
            body: JSON.stringify([
              { op: "replace", path: "/url", value: desiredWebhookUrl }
            ])
          }
        );
      }
      paypalConfig.webhook_url = desiredWebhookUrl;
      await billingConfig("set", paypalConfig);
    }

    if (!paypalConfig.webhook_id) {
      const webhook = await paypalApi("/v1/notifications/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: desiredWebhookUrl,
          event_types: [
            { name: "BILLING.SUBSCRIPTION.CREATED" },
            { name: "BILLING.SUBSCRIPTION.ACTIVATED" },
            { name: "BILLING.SUBSCRIPTION.UPDATED" },
            { name: "BILLING.SUBSCRIPTION.EXPIRED" },
            { name: "BILLING.SUBSCRIPTION.CANCELLED" },
            { name: "BILLING.SUBSCRIPTION.SUSPENDED" },
            { name: "BILLING.SUBSCRIPTION.PAYMENT.FAILED" },
            { name: "PAYMENT.SALE.COMPLETED" },
            { name: "PAYMENT.SALE.REFUNDED" },
            { name: "PAYMENT.SALE.REVERSED" }
          ]
        })
      });
      paypalConfig.webhook_id = webhook.id;
      paypalConfig.webhook_url = desiredWebhookUrl;
      await billingConfig("set", paypalConfig);
    }

    paypalSetupComplete = Boolean(
      paypalConfig.product_id &&
      paypalConfig.pro_plan_id &&
      paypalConfig.business_plan_id &&
      paypalConfig.webhook_id
    );
    if (paypalSetupComplete) paypalSetupError = "";
    return paypalSetupComplete;
  })();

  try {
    return await paypalSetupPromise;
  } catch (error) {
    paypalSetupError = String(error?.message || error);
    paypalSetupComplete = false;
    throw error;
  } finally {
    paypalSetupPromise = null;
  }
}

function requestToken(req) {
  const queryToken = typeof req.query?.token === "string" ? req.query.token : "";
  const headerToken = req.get("x-keepgoing-token") || "";
  const auth = req.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return [queryToken, headerToken, bearer].find(Boolean) || "";
}

async function oauthCodeLedger(action, value, expiresInSeconds = 300) {
  if (!OAUTH_CODE_URL || !BILLING_INGEST_TOKEN) throw new Error("oauth_code_ledger_not_configured");
  const response = await fetchWithTimeout(OAUTH_CODE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-keepgoing-ingest-token": BILLING_INGEST_TOKEN
    },
    body: JSON.stringify({
      action,
      value,
      expires_in_seconds: expiresInSeconds
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || ("oauth code ledger failed (" + response.status + ")"));
  return data;
}

async function validateCustomerToken(token, consume = false) {
  if (!token) return { ok: false, error: "token_required" };
  if (digest(token) === TOKEN_HASH) {
    return { ok: true, admin: true, tier: "owner", remaining: null, subject: "owner" };
  }
  if (!AUTH_URL) return { ok: false, error: "billing_auth_not_configured" };
  try {
    const response = await fetchWithTimeout(AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, consume })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.allowed) return { ok: false, status: response.status, ...data };
    return {
      ok: true,
      admin: false,
      ...data,
      subject: String(data.subject || data.customer_id || data.subscription_id || digest(token).slice(0, 24))
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function authorise(req, consume = false) {
  let token = requestToken(req);
  if (!token) return { ok: false, error: "token_required" };

  if (token.startsWith("kgat_")) {
    try {
      const payload = unsealToken("kgat_", token);
      if (payload.type !== "access" || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
        return { ok: false, error: "oauth_token_expired" };
      }
      if (!safeResource(payload.resource) || !String(payload.scope || "").split(" ").includes(OAUTH_SCOPE)) {
        return { ok: false, error: "oauth_token_invalid_scope" };
      }
      token = String(payload.customer_token || "");
    } catch {
      return { ok: false, error: "oauth_token_invalid" };
    }
  }

  const access = await validateCustomerToken(token, consume);
  return access.ok ? { ...access, _customer_token: token } : access;
}

function setDevDashboardHeaders(res) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

async function devDashboardAccess(req, res) {
  if (!V12_ENABLED) {
    res.status(503).json({ error: "development_agent_not_enabled" });
    return null;
  }
  const access = await authorise(req, false);
  if (!access.ok || !v12ForAccess(access)) {
    res.status(401).json({ error: access.error || "not_authorised" });
    return null;
  }
  return access;
}

function validDashboardJobId(value) {
  return /^kgj_[A-Za-z0-9_-]{8,180}$/.test(String(value || ""));
}

app.get("/dev", (_req, res) => {
  setDevDashboardHeaders(res);
  res.type("html").send(renderDevDashboard());
});

app.get("/dev/api/me", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  res.json({
    ok: true,
    tier: String(access.tier || "account"),
    admin: Boolean(access.admin),
    development_agent: true
  });
});

app.get("/dev/api/jobs", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  try {
    const runtime = getV12Runtime();
    const activeOnly = String(req.query?.activeOnly || "true").toLowerCase() !== "false";
    const rows = await runtime.store.listOwnerJobs(
      durableOwnerHash(access),
      { limit: 100, activeOnly }
    );
    res.json({
      jobs: rows.map((job) => ({
        job_id: job.id,
        status: job.status,
        engine: job.engine || "agents",
        attempt: Number(job.attempt || 0),
        max_attempts: Number(job.maxAttempts || 0),
        error: job.safeErrorMessage || null,
        updated_at: job.updatedAt || null
      }))
    });
  } catch (error) {
    console.error("dev_dashboard_jobs_error", safeLogError(error), req.keepgoingRequestId || "");
    res.status(500).json({ error: "jobs_unavailable" });
  }
});

app.get("/dev/api/jobs/:jobId", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  if (!validDashboardJobId(req.params.jobId)) return res.status(400).json({ error: "invalid_job_id" });
  try {
    const runtime = getV12Runtime();
    const view = await runtime.service.get(
      req.params.jobId,
      durableOwnerHash(access),
      Boolean(access.admin)
    );
    const raw = await runtime.store.get(req.params.jobId);
    res.json({ ...view, engine: raw?.engine || "agents" });
  } catch (error) {
    res.status(404).json({ error: "job_not_found" });
  }
});

app.get("/dev/api/jobs/:jobId/artifacts", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  if (!validDashboardJobId(req.params.jobId)) return res.status(400).json({ error: "invalid_job_id" });
  try {
    const result = await getV12Runtime().service.artifacts(
      req.params.jobId,
      durableOwnerHash(access),
      Boolean(access.admin),
      100
    );
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: "artifacts_unavailable" });
  }
});

app.get("/dev/api/jobs/:jobId/artifacts/:artifactId", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  if (!validDashboardJobId(req.params.jobId)) return res.status(400).json({ error: "invalid_job_id" });
  try {
    const result = await getV12Runtime().service.readArtifact(
      req.params.jobId,
      String(req.params.artifactId || "").slice(0, 200),
      durableOwnerHash(access),
      Boolean(access.admin)
    );
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: "artifact_unavailable" });
  }
});

app.post("/dev/api/tasks", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  try {
    const result = await startDevTaskCompat(req.body || {}, access);
    res.status(202).json(result);
  } catch (error) {
    const message = String(error?.message || error);
    res.status(/required|invalid|unsafe|at most|exceeds/i.test(message) ? 400 : 500).json({
      error: message.slice(0, 500)
    });
  }
});

app.post("/dev/api/jobs/:jobId/cancel", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  if (!validDashboardJobId(req.params.jobId)) return res.status(400).json({ error: "invalid_job_id" });
  try {
    const result = await getV12Runtime().service.cancel(
      req.params.jobId,
      durableOwnerHash(access),
      Boolean(access.admin)
    );
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: "job_not_found" });
  }
});

app.post("/dev/api/jobs/:jobId/resume", async (req, res) => {
  const access = await devDashboardAccess(req, res);
  if (!access) return;
  if (!validDashboardJobId(req.params.jobId)) return res.status(400).json({ error: "invalid_job_id" });
  const input = String(req.body?.input || "").trim();
  if (!input || input.length > 8000) return res.status(400).json({ error: "input_required" });
  try {
    const result = await getV12Runtime().service.resume(
      req.params.jobId,
      input,
      durableOwnerHash(access),
      Boolean(access.admin)
    );
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: String(error?.message || "job_not_resumable").slice(0, 500) });
  }
});

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

async function openai(path, init = {}) {
  if (!OPENAI_API_KEY) throw new Error("KeepGoing OpenAI key is not configured");
  const response = await fetch("https://api.openai.com/v1" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || ("OpenAI request failed (" + response.status + ")"));
  return data;
}

function jobPrompt(goal, done, mode) {
  const autonomy = {
    safe: "Be cautious. Do not make assumptions where missing information changes the result.",
    balanced: "Work autonomously where reasonable, verify important points, and minimise unnecessary questions.",
    max: "Work as autonomously and comprehensively as possible within the available tools and information."
  }[mode] || "Work autonomously where reasonable.";

  return [
    "You are the execution engine for KeepGoing, a persistent background AI job runner.",
    "",
    "GOAL:", goal,
    "",
    "DEFINITION OF DONE:", done,
    "",
    "AUTONOMY:", autonomy,
    "",
    "Complete the job as fully as possible in this background run.",
    "Do not stop merely because a normal chat response would have ended or because you would usually ask whether to continue.",
    "Never claim to have performed actions outside the tools actually available to this response.",
    "If an essential credential, approval, payment, destructive action, private account action, or missing fact prevents completion, return NEEDS_USER and state exactly what is required.",
    "",
    "End with one of:",
    "STATUS: COMPLETED",
    "STATUS: NEEDS_USER",
    "STATUS: PARTIAL",
    "",
    "Then include a concise WORK_COMPLETED section and RESULT."
  ].join("\n");
}

function jobLimits(tier) {
  const business = tier === "business" || tier === "owner";
  return {
    maxOutputTokens: business ? BUSINESS_MAX_OUTPUT_TOKENS : PRO_MAX_OUTPUT_TOKENS,
    maxToolCalls: business ? BUSINESS_MAX_TOOL_CALLS : PRO_MAX_TOOL_CALLS
  };
}

async function startJob({ goal, definitionOfDone, mode, allowWeb, tier = "pro", safetyIdentifier = "" }) {
  const limits = jobLimits(tier);
  const reasoningEffort = mode === "max" ? "high" : mode === "safe" ? "low" : "medium";
  const body = {
    model: MODEL,
    input: jobPrompt(goal, definitionOfDone, mode),
    background: true,
    store: true,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: limits.maxOutputTokens
  };
  if (safetyIdentifier) body.safety_identifier = safetyIdentifier;
  if (allowWeb) {
    body.tools = [{ type: "web_search", return_token_budget: "default" }];
    body.max_tool_calls = limits.maxToolCalls;
  }
  const data = await openai("/responses", { method: "POST", body: JSON.stringify(body) });
  return {
    job_id: data.id,
    status: data.status,
    model: data.model || MODEL,
    tier,
    limits: {
      max_output_tokens: limits.maxOutputTokens,
      max_tool_calls: allowWeb ? limits.maxToolCalls : 0
    },
    message: "KeepGoing job started. Reuse this job_id with get_persistent_job instead of starting a duplicate."
  };
}

async function getJob(jobId) {
  const data = await openai("/responses/" + encodeURIComponent(jobId), { method: "GET" });
  return {
    job_id: data.id,
    status: data.status,
    output: outputText(data),
    error: data.error?.message || null,
    incomplete_details: data.incomplete_details || null
  };
}

async function cancelJob(jobId) {
  const data = await openai("/responses/" + encodeURIComponent(jobId) + "/cancel", {
    method: "POST",
    body: "{}"
  });
  return { job_id: data.id || jobId, status: data.status || "cancelled" };
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "expired", "incomplete"]);

async function waitForJob(jobId, waitSeconds = 20) {
  const deadline = Date.now() + Math.max(1, Math.min(Number(waitSeconds) || 20, 25)) * 1000;
  let latest = await getJob(jobId);
  while (!TERMINAL_STATUSES.has(latest.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    latest = await getJob(jobId);
  }
  return {
    ...latest,
    should_continue_polling: !TERMINAL_STATUSES.has(latest.status),
    message: TERMINAL_STATUSES.has(latest.status)
      ? "KeepGoing reached a terminal state."
      : "KeepGoing is still running. Call wait_for_persistent_job again with the same job_id. Do not ask the user to type continue."
  };
}

async function startPersistentJobCompat(args, access) {
  if (!v12ForAccess(access)) {
    if (args.codingWorkspace) {
      throw new Error("Coding workspace requires KeepGoing durable v1.2+");
    }
    const legacy = await startJob({
      ...args,
      tier: access.tier || "pro",
      safetyIdentifier: "kg_" + digest(String(access.subject || access.tier || "customer")).slice(0, 32)
    });
    return {
      job_id: legacy.job_id,
      status: legacy.status,
      message: legacy.message
    };
  }
  const runtime = getV12Runtime();
  return runtime.service.start({
    goal: args.goal,
    definitionOfDone: args.definitionOfDone,
    mode: args.mode,
    allowWeb: args.allowWeb,
    tier: access.tier || "pro",
    ownerSubjectHash: durableOwnerHash(access),
    clientRequestId: args.clientRequestId || access._mcp_request_id || null,
    context: args.context || "",
    jobEngine: args.jobEngine || "agents",
    codingWorkspace: Boolean(args.codingWorkspace),
    repositoryUrl: args.repositoryUrl || null,
    repositoryRef: args.repositoryRef || null,
    workspaceFiles: Array.isArray(args.workspaceFiles) ? args.workspaceFiles : [],
    beforeCreateSession: async () => reserveJobQuota(access)
  });
}


async function startDevTaskCompat(args, access) {
  if (!v12ForAccess(access)) {
    throw new Error("Autonomous development tasks require KeepGoing durable v1.2+");
  }
  const { persistentArgs } = buildStartDevTaskArgs(args);
  return startPersistentJobCompat(persistentArgs, access);
}

async function listPersistentJobsCompat(access, limit = 20, activeOnly = true) {
  if (!v12ForAccess(access)) throw new Error("Durable job listing requires KeepGoing v1.2");
  return getV12Runtime().service.list(
    durableOwnerHash(access),
    { limit, activeOnly }
  );
}

async function listJobArtifactsCompat(jobId, access, limit = 50) {
  if (!v12ForAccess(access)) throw new Error("Job artifacts require KeepGoing durable v1.2+");
  return getV12Runtime().service.artifacts(
    jobId,
    durableOwnerHash(access),
    Boolean(access.admin),
    limit
  );
}

async function readJobArtifactCompat(jobId, artifactId, access) {
  if (!v12ForAccess(access)) throw new Error("Job artifacts require KeepGoing durable v1.2+");
  return getV12Runtime().service.readArtifact(
    jobId,
    artifactId,
    durableOwnerHash(access),
    Boolean(access.admin)
  );
}

async function getPersistentJobCompat(jobId, access) {
  if (!v12ForAccess(access)) {
    const legacy = await getJob(jobId);
    return {
      job_id: legacy.job_id,
      status: legacy.status,
      output: legacy.output,
      error: legacy.error
    };
  }
  return getV12Runtime().service.get(jobId, durableOwnerHash(access), Boolean(access.admin));
}

async function waitPersistentJobCompat(jobId, waitSeconds, access) {
  if (!v12ForAccess(access)) {
    const legacy = await waitForJob(jobId, waitSeconds);
    return {
      job_id: legacy.job_id,
      status: legacy.status,
      output: legacy.output,
      error: legacy.error,
      should_continue_polling: legacy.should_continue_polling,
      message: legacy.message
    };
  }
  return getV12Runtime().service.wait(
    jobId,
    durableOwnerHash(access),
    Boolean(access.admin),
    waitSeconds
  );
}

async function cancelPersistentJobCompat(jobId, access) {
  if (!v12ForAccess(access)) return cancelJob(jobId);
  return getV12Runtime().service.cancel(jobId, durableOwnerHash(access), Boolean(access.admin));
}

async function resumePersistentJobCompat(jobId, input, access) {
  if (!v12ForAccess(access)) throw new Error("Durable job resume requires KeepGoing v1.2");
  return getV12Runtime().service.resume(
    jobId,
    input,
    durableOwnerHash(access),
    Boolean(access.admin)
  );
}

function createMcpServer(access = {}) {
  const v12Access = v12ForAccess(access);
  const ownerAutoContinue = Boolean(access?.admin || access?.tier === "owner");
  const oauthSecuritySchemes = [{ type: "oauth2", scopes: [OAUTH_SCOPE] }];
  const oauthMeta = { securitySchemes: oauthSecuritySchemes };

  const publicV12Instructions = "Use KeepGoing when the user explicitly asks to use KeepGoing for a substantial objective or explicitly asks KeepGoing to continue or finish an existing objective. Prefer continue_until_done for that explicit KeepGoing intent. If a checkpoint is needed, pass only the minimum brief task-specific context already intentionally shared for this objective; never pass full chat history, raw transcripts, credentials, or unrelated personal data. Start one durable job and preserve its job_id. Reuse the same job_id and never create duplicate jobs. Stop only for genuine required user input/approval, a safety/cost limit, cancellation, or completion.";
  const ownerV12Instructions = "OWNER MODE: Treat plain continuation phrases such as continue, keep going, finish it, until done, don't stop, carry on, or equivalent as KeepGoing intent when they refer to the current substantial objective. Prefer continue_until_done for those phrases even when the user does not repeat the word KeepGoing. Preserve and reuse the same durable job where possible; never create duplicates just to continue. If a checkpoint is needed, pass only the minimum brief task-specific context already intentionally shared for this objective; never pass full chat history, raw transcripts, credentials, or unrelated personal data. Stop only for genuine required user input/approval, a safety/cost limit, cancellation, or completion.";
  const startToolDescription = ownerAutoContinue
    ? "Owner mode: use for a substantial multi-step objective that should become one durable job. For a continuation of the current objective, prefer continue_until_done. For coding work, when a public GitHub repository is known, set codingWorkspace=true and pass repositoryUrl/repositoryRef so the durable Agent can actually inspect/edit/test the code. If the task depends on a small set of local/uncommitted text files already intentionally available in the current task context, pass only those selected files via workspaceFiles; do not start a no-files coding job. If a checkpoint is needed, pass only brief task-specific context; never send full chat history, raw transcripts, credentials, or unrelated personal data."
    : "Use when the user explicitly asks KeepGoing to start a substantial multi-step objective as one durable job. For coding work, set codingWorkspace=true and optionally supply a public GitHub repository/ref. If a checkpoint is needed, pass only brief task-specific context necessary for that objective; never send full chat history, raw transcripts, credentials, or unrelated personal data. Reuse the returned job ID for later status, wait, resume or cancel operations.";
  const continueToolDescription = ownerAutoContinue
    ? "Owner mode: use when the user says continue, keep going, finish it, until done, don't stop, carry on, or equivalent for the current substantial objective, even if they do not repeat the word KeepGoing. Starts or idempotently recovers one durable job and advances it server-side until completed, genuinely blocked by required user input/approval, cancelled, or stopped by a configured safety/cost limit. For coding objectives with a known public GitHub repo, set codingWorkspace=true and pass repositoryUrl/repositoryRef so the background job has real code access. If a small set of task-relevant local/uncommitted text files are intentionally available, pass only those selected files via workspaceFiles. Reuse the same job where possible."
    : "Use when the user explicitly asks KeepGoing to continue or finish a substantial multi-step objective. Starts or idempotently recovers one durable job and advances it server-side until completed, genuinely blocked by required user input/approval, cancelled, or stopped by a configured safety/cost limit. If a checkpoint is needed, pass only brief task-specific context necessary for that objective; never send full chat history, raw transcripts, credentials, or unrelated personal data.";

  const server = new McpServer(
    { name: "KeepGoing", version: v12Access ? APP_VERSION : "1.1.0" },
    { instructions: v12Access
      ? (ownerAutoContinue ? ownerV12Instructions : publicV12Instructions)
      : "Use KeepGoing for substantial model-only work or research that should continue as a background response instead of stopping at a normal chat-turn boundary. Start one job, preserve its job_id, then call wait_for_persistent_job. If should_continue_polling is true, call wait_for_persistent_job again with the same job_id without asking the user to type continue. Reuse the same job_id and never create duplicate jobs just to keep working. KeepGoing does not automatically control other ChatGPT plugins, desktops, payments, or private accounts." }
  );

  if (v12Access) {
    server.registerTool("get_profile", {
      title: "Get KeepGoing profile",
      description: "Return the authenticated KeepGoing account identity so connected accounts can be distinguished. Does not modify account or job data.",
      inputSchema: {},
      outputSchema: {
        id: z.string(),
        nickname: z.string()
      },
      securitySchemes: oauthSecuritySchemes,
      _meta: { ...oauthMeta, "openai/profile": true },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }, async () => {
      const profile = {
        id: "kg_" + digest(String(access.subject || "customer")).slice(0, 24),
        nickname: "KeepGoing " + String(access.tier || "account")
      };
      return {
        content: [{ type: "text", text: JSON.stringify(profile) }],
        structuredContent: profile
      };
    });
  }

  if (v12Access) {
    server.registerTool("start_dev_task", {
      title: "Start autonomous development task",
      description: devTaskToolDescription(),
      inputSchema: {
        goal: z.string().min(1).max(12000),
        repositoryUrl: z.string().url().max(500),
        repositoryRef: z.string().min(1).max(200).default("main"),
        acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(20),
        verificationCommands: z.array(z.string().min(1).max(1000)).max(12).optional(),
        playbook: z.enum(["bugfix","feature","audit","refactor","ci_repair","dependency_update"]).optional(),
        mode: z.enum(["safe","balanced","max"]).default("max"),
        allowWeb: z.boolean().default(true),
        clientRequestId: z.string().min(1).max(200).optional(),
        context: z.string().max(4000).optional(),
        workspaceFiles: z.array(z.object({
          path: z.string().min(1).max(180),
          content: z.string().max(32000)
        })).max(8).optional()
      },
      outputSchema: {
        job_id: z.string(),
        status: z.string(),
        duplicate: z.boolean().optional(),
        message: z.string()
      },
      securitySchemes: oauthSecuritySchemes,
      _meta: oauthMeta,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }, async (args) => {
      try {
        const result = await startDevTaskCompat(args, access);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
      }
    });
  }

  server.registerTool("start_persistent_job", {
    title: "Start persistent job",
    description: startToolDescription,
    inputSchema: {
      goal: z.string().min(1).max(12000),
      definitionOfDone: z.string().min(1).max(4000).default("All requested work completed and verified"),
      mode: z.enum(["safe","balanced","max"]).default("balanced"),
      allowWeb: z.boolean().default(true),
      clientRequestId: z.string().min(1).max(200).optional(),
      context: z.string().max(4000).describe("Brief task-specific checkpoint only. Do not send full conversation history, raw transcripts, credentials, or unrelated personal data.").optional(),
      codingWorkspace: z.boolean().default(false).describe("Create an isolated OpenAI-hosted coding workspace with Bash/apply-patch support."),
      repositoryUrl: z.string().url().max(500).describe("Optional public https://github.com/owner/repo URL to clone into /workspace/project. Never include credentials.").optional(),
      repositoryRef: z.string().max(200).describe("Optional safe Git branch/tag/commit ref used only with repositoryUrl.").optional(),
      workspaceFiles: z.array(z.object({
        path: z.string().min(1).max(180),
        content: z.string().max(32000)
      })).max(8).describe("Optional explicitly selected non-secret UTF-8 text files to overlay into /workspace/project. Use only for task-relevant local/uncommitted files.").optional()
    },
    outputSchema: {
      job_id: z.string(),
      status: z.string(),
      duplicate: z.boolean().optional(),
      message: z.string()
    },
    securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (args) => {
    try {
      const result = await startPersistentJobCompat(args, access);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });


  server.registerTool("continue_until_done", {
    title: "Continue until done",
    description: continueToolDescription,
    inputSchema: {
      goal: z.string().min(1).max(12000),
      definitionOfDone: z.string().min(1).max(4000).default("All requested work completed and verified"),
      mode: z.enum(["safe","balanced","max"]).default("max"),
      allowWeb: z.boolean().default(true),
      clientRequestId: z.string().min(1).max(200).optional(),
      context: z.string().max(4000).describe("Brief task-specific checkpoint only. Do not send full conversation history, raw transcripts, credentials, or unrelated personal data.").optional(),
      codingWorkspace: z.boolean().default(false).describe("Create an isolated OpenAI-hosted coding workspace with Bash/apply-patch support."),
      repositoryUrl: z.string().url().max(500).describe("Optional public https://github.com/owner/repo URL to clone into /workspace/project. Never include credentials.").optional(),
      repositoryRef: z.string().max(200).describe("Optional safe Git branch/tag/commit ref used only with repositoryUrl.").optional(),
      workspaceFiles: z.array(z.object({
        path: z.string().min(1).max(180),
        content: z.string().max(32000)
      })).max(8).describe("Optional explicitly selected non-secret UTF-8 text files to overlay into /workspace/project. Use only for task-relevant local/uncommitted files.").optional()
    },
    outputSchema: {
      job_id: z.string(),
      status: z.string(),
      duplicate: z.boolean().optional(),
      message: z.string()
    },
    securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (args) => {
    try {
      const result = await startPersistentJobCompat({ ...args, mode: args.mode || "max" }, access);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("get_persistent_job", {
    title: "Get persistent job",
    description: "Use when the user wants the current status or available result of a specific KeepGoing job. Reads only that authenticated account's durable job state.",
    inputSchema: { job_id: z.string().min(1).max(200) },
    outputSchema: {
      job_id: z.string(),
      status: z.string(),
      output: z.string(),
      error: z.string().nullable(),
      progress: z.object({
        attempt: z.number(),
        max_attempts: z.number()
      }).optional()
    },
    securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ job_id }) => {
    try {
      const result = await getPersistentJobCompat(job_id, access);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("wait_for_persistent_job", {
    title: "Wait for persistent job",
    description: "Use when the user wants to wait briefly for an existing KeepGoing job. Reads the same job for up to 25 seconds and never starts a replacement job.",
    inputSchema: {
      job_id: z.string().min(1).max(200),
      wait_seconds: z.number().int().min(1).max(25).default(20)
    },
    outputSchema: {
      job_id: z.string(),
      status: z.string(),
      output: z.string(),
      error: z.string().nullable(),
      progress: z.object({
        attempt: z.number(),
        max_attempts: z.number()
      }).optional(),
      should_continue_polling: z.boolean(),
      message: z.string()
    },
    securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ job_id, wait_seconds }) => {
    try {
      const result = await waitPersistentJobCompat(job_id, wait_seconds, access);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("cancel_persistent_job", {
    title: "Cancel persistent job",
    description: "Use only when the user wants to stop a specific KeepGoing job. Cancels the current durable job and does not create a replacement.",
    inputSchema: { job_id: z.string().min(1).max(200) },
    outputSchema: {
      job_id: z.string(),
      status: z.string()
    },
    securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ job_id }) => {
    try {
      const result = await cancelPersistentJobCompat(job_id, access);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  if (v12Access) {
    server.registerTool("list_persistent_jobs", {
      title: "List persistent jobs",
      description: "Use when the user wants to find or recover their own recent KeepGoing jobs, including from a new chat. Returns minimal job metadata and never returns raw prompts.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        activeOnly: z.boolean().default(true)
      },
      outputSchema: {
        jobs: z.array(z.object({
          job_id: z.string(),
          status: z.string(),
          attempt: z.number(),
          max_attempts: z.number(),
          error: z.string().nullable()
        }))
      },
      securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ limit, activeOnly }) => {
      try {
        const result = await listPersistentJobsCompat(access, limit, activeOnly);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
      }
    });

    server.registerTool("list_job_artifacts", {
      title: "List job artifacts",
      description: "List patch/report artifacts published by an owned KeepGoing coding job. Returns metadata only for files published from /workspace/outputs.",
      inputSchema: {
        job_id: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(50)
      },
      outputSchema: {
        job_id: z.string(),
        artifacts: z.array(z.object({
          artifact_id: z.string(),
          path: z.string(),
          size_bytes: z.number(),
          turn_id: z.string()
        }))
      },
      securitySchemes: oauthSecuritySchemes,
      _meta: oauthMeta,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ job_id, limit }) => {
      try {
        const result = await listJobArtifactsCompat(job_id, access, limit);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
      }
    });

    server.registerTool("read_job_artifact", {
      title: "Read job artifact",
      description: "Read a small text patch/report artifact published by an owned KeepGoing coding job. Only common text artifact formats under /workspace/outputs are readable.",
      inputSchema: {
        job_id: z.string().min(1).max(200),
        artifact_id: z.string().min(1).max(200)
      },
      outputSchema: {
        job_id: z.string(),
        artifact_id: z.string(),
        path: z.string(),
        size_bytes: z.number(),
        text: z.string()
      },
      securitySchemes: oauthSecuritySchemes,
      _meta: oauthMeta,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ job_id, artifact_id }) => {
      try {
        const result = await readJobArtifactCompat(job_id, artifact_id, access);
        return { content: [{ type: "text", text: result.text }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
      }
    });

    server.registerTool("resume_persistent_job", {
      title: "Resume persistent job",
      description: "Use after a KeepGoing job is waiting for user input and the user has supplied the missing information. Resumes the same durable job rather than starting over.",
      inputSchema: {
        job_id: z.string().min(1).max(200),
        input: z.string().min(1).max(8000)
      },
      outputSchema: {
        job_id: z.string(),
        status: z.string(),
        message: z.string()
      },
      securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }, async ({ job_id, input }) => {
      try {
        const result = await resumePersistentJobCompat(job_id, input, access);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
      }
    });
  }

  // OpenAI expects securitySchemes at the root of each tool descriptor.
  // MCP SDK v1 currently drops that root extension from tools/list while
  // preserving the compatibility copy under _meta. Override only tools/list;
  // registered tools/call still uses McpServer's Zod input validation.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      {
        name: "start_persistent_job",
        title: "Start persistent job",
        description: startToolDescription,
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", minLength: 1, maxLength: 12000 },
            definitionOfDone: { type: "string", minLength: 1, maxLength: 4000, default: "All requested work completed and verified" },
            mode: { type: "string", enum: ["safe", "balanced", "max"], default: "balanced" },
            allowWeb: { type: "boolean", default: true },
            clientRequestId: { type: "string", minLength: 1, maxLength: 200 },
            context: { type: "string", maxLength: 4000, description: "Brief task-specific checkpoint only. Do not send full conversation history, raw transcripts, credentials, or unrelated personal data." },
            codingWorkspace: { type: "boolean", default: false, description: "Create an isolated OpenAI-hosted coding workspace with Bash/apply-patch support." },
            repositoryUrl: { type: "string", format: "uri", maxLength: 500, description: "Optional public https://github.com/owner/repo URL to clone into /workspace/project. Never include credentials." },
            repositoryRef: { type: "string", maxLength: 200, description: "Optional safe Git branch/tag/commit ref used only with repositoryUrl." },
            workspaceFiles: {
              type: "array",
              maxItems: 8,
              description: "Optional explicitly selected non-secret UTF-8 text files to overlay into /workspace/project. Use only for task-relevant local/uncommitted files.",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", minLength: 1, maxLength: 180 },
                  content: { type: "string", maxLength: 32000 }
                },
                required: ["path", "content"],
                additionalProperties: false
              }
            }
          },
          required: ["goal"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            duplicate: { type: "boolean" },
            message: { type: "string" }
          },
          required: ["job_id", "status", "message"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: oauthMeta
      },
      {
        name: "continue_until_done",
        title: "Continue until done",
        description: continueToolDescription,
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", minLength: 1, maxLength: 12000 },
            definitionOfDone: { type: "string", minLength: 1, maxLength: 4000, default: "All requested work completed and verified" },
            mode: { type: "string", enum: ["safe", "balanced", "max"], default: "max" },
            allowWeb: { type: "boolean", default: true },
            clientRequestId: { type: "string", minLength: 1, maxLength: 200 },
            context: { type: "string", maxLength: 4000, description: "Brief task-specific checkpoint only. Do not send full conversation history, raw transcripts, credentials, or unrelated personal data." },
            codingWorkspace: { type: "boolean", default: false, description: "Create an isolated OpenAI-hosted coding workspace with Bash/apply-patch support." },
            repositoryUrl: { type: "string", format: "uri", maxLength: 500, description: "Optional public https://github.com/owner/repo URL to clone into /workspace/project. Never include credentials." },
            repositoryRef: { type: "string", maxLength: 200, description: "Optional safe Git branch/tag/commit ref used only with repositoryUrl." },
            workspaceFiles: {
              type: "array",
              maxItems: 8,
              description: "Optional explicitly selected non-secret UTF-8 text files to overlay into /workspace/project. Use only for task-relevant local/uncommitted files.",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", minLength: 1, maxLength: 180 },
                  content: { type: "string", maxLength: 32000 }
                },
                required: ["path", "content"],
                additionalProperties: false
              }
            }
          },
          required: ["goal"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            duplicate: { type: "boolean" },
            message: { type: "string" }
          },
          required: ["job_id", "status", "message"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: oauthMeta
      },
      {
        name: "get_persistent_job",
        title: "Get persistent job",
        description: "Use when the user wants the current status or available result of a specific KeepGoing job. Reads only that authenticated account's durable job state.",
        inputSchema: {
          type: "object",
          properties: { job_id: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["job_id"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            output: { type: "string" },
            error: { type: ["string", "null"] },
            progress: {
              type: "object",
              properties: {
                attempt: { type: "number" },
                max_attempts: { type: "number" }
              },
              required: ["attempt", "max_attempts"],
              additionalProperties: false
            }
          },
          required: ["job_id", "status", "output", "error"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      },
      {
        name: "wait_for_persistent_job",
        title: "Wait for persistent job",
        description: "Use when the user wants to wait briefly for an existing KeepGoing job. Reads the same job for up to 25 seconds and never starts a replacement job.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string", minLength: 1, maxLength: 200 },
            wait_seconds: { type: "integer", minimum: 1, maximum: 25, default: 20 }
          },
          required: ["job_id"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            output: { type: "string" },
            error: { type: ["string", "null"] },
            progress: {
              type: "object",
              properties: {
                attempt: { type: "number" },
                max_attempts: { type: "number" }
              },
              required: ["attempt", "max_attempts"],
              additionalProperties: false
            },
            should_continue_polling: { type: "boolean" },
            message: { type: "string" }
          },
          required: ["job_id", "status", "output", "error", "should_continue_polling", "message"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      },
      {
        name: "cancel_persistent_job",
        title: "Cancel persistent job",
        description: "Use only when the user wants to stop a specific KeepGoing job. Cancels the current durable job and does not create a replacement.",
        inputSchema: {
          type: "object",
          properties: { job_id: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["job_id"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" }
          },
          required: ["job_id", "status"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      }
    ];

    if (v12Access) {
      tools.unshift({
        name: "get_profile",
        title: "Get KeepGoing profile",
        description: "Return the authenticated KeepGoing account identity so connected accounts can be distinguished. Does not modify account or job data.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            nickname: { type: "string" }
          },
          required: ["id", "nickname"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        },
        _meta: { ...oauthMeta, "openai/profile": true }
      });

      tools.push({
        name: "start_dev_task",
        title: "Start autonomous development task",
        description: devTaskToolDescription(),
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", minLength: 1, maxLength: 12000 },
            repositoryUrl: { type: "string", format: "uri", maxLength: 500 },
            repositoryRef: { type: "string", minLength: 1, maxLength: 200, default: "main" },
            acceptanceCriteria: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 1000 } },
            verificationCommands: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 1000 } },
            playbook: { type: "string", enum: ["bugfix", "feature", "audit", "refactor", "ci_repair", "dependency_update"] },
            mode: { type: "string", enum: ["safe", "balanced", "max"], default: "max" },
            allowWeb: { type: "boolean", default: true },
            clientRequestId: { type: "string", minLength: 1, maxLength: 200 },
            context: { type: "string", maxLength: 4000 },
            workspaceFiles: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  path: { type: "string", minLength: 1, maxLength: 180 },
                  content: { type: "string", maxLength: 32000 }
                },
                required: ["path", "content"],
                additionalProperties: false
              }
            }
          },
          required: ["goal", "repositoryUrl", "acceptanceCriteria"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            duplicate: { type: "boolean" },
            message: { type: "string" }
          },
          required: ["job_id", "status", "message"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: oauthMeta
      });

      tools.push({
        name: "list_persistent_jobs",
        title: "List persistent jobs",
        description: "Use when the user wants to find or recover their own recent KeepGoing jobs, including from a new chat. Returns minimal job metadata and never returns raw prompts.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            activeOnly: { type: "boolean", default: true }
          },
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            jobs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  job_id: { type: "string" },
                  status: { type: "string" },
                  attempt: { type: "number" },
                  max_attempts: { type: "number" },
                  error: { type: ["string", "null"] }
                },
                required: [
                  "job_id","status","attempt","max_attempts","error"
                ],
                additionalProperties: false
              }
            }
          },
          required: ["jobs"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      });

      tools.push({
        name: "list_job_artifacts",
        title: "List job artifacts",
        description: "List patch/report artifacts published by an owned KeepGoing coding job. Returns metadata only for files published from /workspace/outputs.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string", minLength: 1, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
          },
          required: ["job_id"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            artifacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artifact_id: { type: "string" },
                  path: { type: "string" },
                  size_bytes: { type: "number" },
                  turn_id: { type: "string" }
                },
                required: ["artifact_id", "path", "size_bytes", "turn_id"],
                additionalProperties: false
              }
            }
          },
          required: ["job_id", "artifacts"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      });

      tools.push({
        name: "read_job_artifact",
        title: "Read job artifact",
        description: "Read a small text patch/report artifact published by an owned KeepGoing coding job. Only common text artifact formats under /workspace/outputs are readable.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string", minLength: 1, maxLength: 200 },
            artifact_id: { type: "string", minLength: 1, maxLength: 200 }
          },
          required: ["job_id", "artifact_id"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            artifact_id: { type: "string" },
            path: { type: "string" },
            size_bytes: { type: "number" },
            text: { type: "string" }
          },
          required: ["job_id", "artifact_id", "path", "size_bytes", "text"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: oauthMeta
      });

      tools.push({
        name: "resume_persistent_job",
        title: "Resume persistent job",
        description: "Use after a KeepGoing job is waiting for user input and the user has supplied the missing information. Resumes the same durable job rather than starting over.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string", minLength: 1, maxLength: 200 },
            input: { type: "string", minLength: 1, maxLength: 8000 }
          },
          required: ["job_id", "input"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string" },
            message: { type: "string" }
          },
          required: ["job_id", "status", "message"],
          additionalProperties: false
        },
        securitySchemes: oauthSecuritySchemes,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: oauthMeta
      });
    }

    return { tools };
  });

  return server;
}


app.get("/.well-known/openai-apps-challenge", (_req, res) => {
  if (!OPENAI_APPS_CHALLENGE) return res.status(404).type("text/plain").send("not configured");
  res.set("Cache-Control", "no-store");
  res.type("text/plain").send(OPENAI_APPS_CHALLENGE);
});

app.get("/.well-known/security.txt", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.type("text/plain").send([
    "Contact: mailto:info@thesmashroom.co.uk",
    "Expires: 2027-09-29T23:59:59Z",
    "Preferred-Languages: en",
    "Canonical: " + PUBLIC_BASE_URL + "/.well-known/security.txt",
    "Policy: " + PUBLIC_BASE_URL + "/security"
  ].join("\n") + "\n");
});

app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: PUBLIC_BASE_URL,
    authorization_servers: [PUBLIC_BASE_URL],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: PUBLIC_BASE_URL + "/install",
    resource_policy_uri: PUBLIC_BASE_URL + "/privacy",
    resource_tos_uri: PUBLIC_BASE_URL + "/terms"
  });
});

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: PUBLIC_BASE_URL,
    authorization_endpoint: PUBLIC_BASE_URL + "/oauth/authorize",
    token_endpoint: PUBLIC_BASE_URL + "/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true
  });
});

app.get("/oauth/authorize", async (req, res) => {
  setOAuthPageHeaders(res);
  const responseType = String(req.query.response_type || "");
  const clientId = String(req.query.client_id || "");
  const redirectUri = String(req.query.redirect_uri || "");
  const state = String(req.query.state || "");
  const codeChallenge = String(req.query.code_challenge || "");
  const method = String(req.query.code_challenge_method || "");
  const resource = String(req.query.resource || PUBLIC_BASE_URL);
  const scope = String(req.query.scope || OAUTH_SCOPE);

  const clientValid = await validateCimdClient(clientId, redirectUri);
  if (
    responseType !== "code" ||
    !clientValid ||
    !state ||
    !codeChallenge ||
    method !== "S256" ||
    !safeResource(resource) ||
    !scope.split(" ").includes(OAUTH_SCOPE)
  ) {
    return res.status(400).type("html").send("<h1>Invalid authorization request</h1><p>Please restart the KeepGoing connection from ChatGPT.</p>");
  }

  const hidden = {
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: method,
    resource: PUBLIC_BASE_URL,
    scope: OAUTH_SCOPE
  };

  const fields = Object.entries(hidden)
    .map(([k, v]) => '<input type="hidden" name="' + htmlEscape(k) + '" value="' + htmlEscape(v) + '">')
    .join("");

  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0d1117"><link rel="icon" href="/icon.svg"><title>Connect KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}.card{width:min(620px,100%);box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:18px;padding:30px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:18px}.brand img{width:58px;height:58px;border-radius:14px}label{display:block;font-weight:700;margin:18px 0 8px}input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #484f58;background:#0d1117;color:#fff;font:inherit}button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font-weight:700;font-size:16px}.muted{color:#8b949e;font-size:14px}a{color:#58a6ff}</style></head><body><div class="card"><div class="brand"><img src="/icon.svg" alt=""><div><h1 style="margin:0">Connect KeepGoing</h1><div class="muted">Connect an existing KeepGoing account to ChatGPT</div></div></div><p>Enter your private KeepGoing activation token. This authorization page does not sell, upgrade or change subscriptions.</p><form method="post" action="/oauth/authorize">' + fields + '<label for="activation_token">Activation token</label><input id="activation_token" name="activation_token" type="password" autocomplete="off" required autofocus><button type="submit">Connect to ChatGPT</button></form><p class="muted">KeepGoing never asks for your ChatGPT password. Do not share your activation token. <a href="/privacy">Privacy</a> · <a href="/support">Support</a></p></div></body></html>';
  res.type("html").send(html);

});

app.post("/oauth/authorize", async (req, res) => {
  setOAuthPageHeaders(res);
  const clientId = String(req.body.client_id || "");
  const redirectUri = String(req.body.redirect_uri || "");
  const state = String(req.body.state || "");
  const codeChallenge = String(req.body.code_challenge || "");
  const method = String(req.body.code_challenge_method || "");
  const resource = String(req.body.resource || PUBLIC_BASE_URL);
  const scope = String(req.body.scope || OAUTH_SCOPE);
  const activationToken = String(req.body.activation_token || "").trim();

  const clientValid = await validateCimdClient(clientId, redirectUri);
  if (
    !OAUTH_SECRET ||
    !clientValid ||
    !state ||
    !codeChallenge ||
    method !== "S256" ||
    !safeResource(resource) ||
    !scope.split(" ").includes(OAUTH_SCOPE)
  ) {
    return res.status(400).type("html").send("<h1>Invalid authorization request</h1>");
  }

  const access = await validateCustomerToken(activationToken, false);
  if (!access.ok) {
    return res.status(401).type("html").send('<!doctype html><html><body style="font-family:system-ui;padding:32px"><h1>KeepGoing could not be connected</h1><p>The activation token is invalid or the subscription is not active.</p><p>Return to ChatGPT and try again.</p></body></html>');
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = base64url(crypto.randomBytes(24));
  const code = sealToken("kgc_", {
    type: "code",
    jti,
    customer_token: activationToken,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    resource: PUBLIC_BASE_URL,
    scope: OAUTH_SCOPE,
    iat: now,
    exp: now + 300
  });

  try {
    await oauthCodeLedger("store", jti, 300);
  } catch {
    return res.status(503).type("html").send("<h1>KeepGoing connection temporarily unavailable</h1><p>Please return to ChatGPT and try again.</p>");
  }

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  target.searchParams.set("iss", PUBLIC_BASE_URL);
  return res.redirect(303, target.toString());
});

function issueOAuthTokens(customerToken) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: sealToken("kgat_", {
      type: "access",
      customer_token: customerToken,
      resource: PUBLIC_BASE_URL,
      scope: OAUTH_SCOPE,
      iat: now,
      exp: now + 3600
    }),
    token_type: "Bearer",
    expires_in: 3600,
    scope: OAUTH_SCOPE,
    refresh_token: sealToken("kgrt_", {
      type: "refresh",
      customer_token: customerToken,
      resource: PUBLIC_BASE_URL,
      scope: OAUTH_SCOPE,
      iat: now,
      exp: now + 2592000
    })
  };
}

app.post("/oauth/token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!OAUTH_SECRET) return res.status(503).json({ error: "temporarily_unavailable" });

  const grantType = String(req.body.grant_type || "");

  if (grantType === "authorization_code") {
    try {
      const code = unsealToken("kgc_", String(req.body.code || ""));
      const clientId = String(req.body.client_id || "");
      const redirectUri = String(req.body.redirect_uri || "");
      const verifier = String(req.body.code_verifier || "");
      const resource = String(req.body.resource || PUBLIC_BASE_URL);
      const now = Math.floor(Date.now() / 1000);

      if (
        code.type !== "code" ||
        Number(code.exp || 0) < now ||
        code.client_id !== clientId ||
        code.redirect_uri !== redirectUri ||
        !safeResource(resource) ||
        !verifier
      ) {
        return res.status(400).json({ error: "invalid_grant" });
      }

      if (!(await validateCimdClient(clientId, redirectUri))) {
        return res.status(400).json({ error: "invalid_client" });
      }

      if (!code.jti) return res.status(400).json({ error: "invalid_grant" });

      const computed = base64url(crypto.createHash("sha256").update(verifier, "utf8").digest());
      const expected = Buffer.from(String(code.code_challenge || ""), "utf8");
      const actual = Buffer.from(computed, "utf8");
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return res.status(400).json({ error: "invalid_grant" });
      }

      const consumed = await oauthCodeLedger("consume", String(code.jti));
      if (!consumed?.ok) return res.status(400).json({ error: "invalid_grant" });

      const access = await validateCustomerToken(String(code.customer_token || ""), false);
      if (!access.ok) return res.status(401).json({ error: "invalid_grant" });
      return res.json(issueOAuthTokens(String(code.customer_token || "")));
    } catch {
      return res.status(400).json({ error: "invalid_grant" });
    }
  }

  if (grantType === "refresh_token") {
    try {
      const refresh = unsealToken("kgrt_", String(req.body.refresh_token || ""));
      const now = Math.floor(Date.now() / 1000);
      if (
        refresh.type !== "refresh" ||
        Number(refresh.exp || 0) < now ||
        !safeResource(refresh.resource)
      ) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      const access = await validateCustomerToken(String(refresh.customer_token || ""), false);
      if (!access.ok) return res.status(401).json({ error: "invalid_grant" });
      return res.json(issueOAuthTokens(String(refresh.customer_token || "")));
    } catch {
      return res.status(400).json({ error: "invalid_grant" });
    }
  }

  return res.status(400).json({ error: "unsupported_grant_type" });
});

app.post("/billing/claim", async (req, res) => {
  const sessionId = String(req.body?.session_id || "");
  if (!sessionId) return res.status(400).json({ error: "session_id_required" });
  if (!CLAIM_URL || !BILLING_INGEST_TOKEN) return res.status(503).json({ error: "claim_not_configured" });
  try {
    const response = await fetchWithTimeout(CLAIM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-keepgoing-ingest-token": BILLING_INGEST_TOKEN
      },
      body: JSON.stringify({ provider: "stripe", session_id: sessionId })
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("stripe_claim_error", safeLogError(error));
    return res.status(502).json({ error: "claim_upstream_error" });
  }
});

app.post("/paypal/start-subscription", async (req, res) => {
  const tier = String(req.body?.tier || "").trim().toLowerCase();
  if (tier !== "pro" && tier !== "business") {
    return res.status(400).type("html").send(infoPage("Invalid subscription", "<p>Please return to the subscription page and choose Pro or Business.</p>"));
  }
  try {
    await ensurePayPalSetup();
    const planId = tier === "business" ? paypalConfig.business_plan_id : paypalConfig.pro_plan_id;
    if (!planId) {
      return res.status(503).type("html").send(infoPage("Checkout temporarily unavailable", "<p>PayPal checkout is not ready yet. Please try again shortly.</p>"));
    }
    const claimId = "kgc_" + crypto.randomBytes(32).toString("hex");
    const subscription = await paypalApi("/v1/billing/subscriptions", {
      method: "POST",
      headers: { "PayPal-Request-Id": "keepgoing-" + PAYPAL_MODE + "-" + tier + "-" + claimId.slice(-24) },
      body: JSON.stringify({
        plan_id: planId,
        custom_id: claimId,
        application_context: {
          brand_name: "KeepGoing",
          locale: "en-GB",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: PUBLIC_BASE_URL + "/paypal/return?claim_id=" + encodeURIComponent(claimId),
          cancel_url: PUBLIC_BASE_URL + "/subscribe?cancelled=1"
        }
      })
    });
    const approval = Array.isArray(subscription?.links)
      ? subscription.links.find((link) => String(link?.rel || "").toLowerCase() === "approve")
      : null;
    const approvalUrl = safePayPalApprovalUrl(approval?.href);
    if (!approvalUrl) throw new Error("PayPal approval URL missing or invalid");
    return res.redirect(303, approvalUrl);
  } catch (error) {
    console.error("paypal_start_subscription_error", safeLogError(error), req.keepgoingRequestId || "");
    return res.status(502).type("html").send(infoPage("Could not start PayPal checkout", "<p>PayPal checkout could not be started. No subscription was activated. Please return and try again.</p>"));
  }
});

app.get("/paypal/return", (req, res) => {
  const subscriptionId = String(req.query?.subscription_id || req.query?.subscriptionId || "").trim();
  const claimId = String(req.query?.claim_id || "").trim();
  if (!subscriptionId || !/^I-[A-Z0-9]+$/i.test(subscriptionId) || !/^kgc_[0-9a-f]{64}$/.test(claimId)) {
    return res.status(400).type("html").send(infoPage("Could not confirm PayPal subscription", "<p>The PayPal return information is incomplete. Please return to the subscription page and try again.</p>"));
  }
  const target = "/subscribe?subscription_id=" + encodeURIComponent(subscriptionId) + "&claim_id=" + encodeURIComponent(claimId);
  return res.redirect(303, target);
});
app.post("/paypal/claim", async (req, res) => {
  const subscriptionId = String(req.body?.subscription_id || "");
  const claimId = String(req.body?.claim_id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "subscription_id_required" });
  if (!/^kgc_[0-9a-f]{64}$/.test(claimId)) return res.status(400).json({ error: "claim_id_invalid" });
  if (!CLAIM_URL || !BILLING_INGEST_TOKEN) return res.status(503).json({ error: "claim_not_configured" });
  try {
    await ensurePayPalSetup();
    const sub = await paypalApi("/v1/billing/subscriptions/" + encodeURIComponent(subscriptionId), { method: "GET" });
    const customId = String(sub.custom_id || "");
    const expectedClaim = Buffer.from(customId, "utf8");
    const suppliedClaim = Buffer.from(claimId, "utf8");
    const claimMatches = Boolean(
      customId &&
      expectedClaim.length === suppliedClaim.length &&
      crypto.timingSafeEqual(expectedClaim, suppliedClaim)
    );
    if (!claimMatches) return res.status(403).json({ error: "claim_mismatch" });

    const status = String(sub.status || "").toUpperCase();
    if (status !== "ACTIVE") {
      return res.status(409).json({ error: "subscription_not_active", status });
    }
    const planId = String(sub.plan_id || "");
    const tier =
      planId === paypalConfig.business_plan_id ? "business" :
      planId === paypalConfig.pro_plan_id ? "pro" : "";
    if (!tier) return res.status(403).json({ error: "unknown_paypal_plan" });

    await forwardBillingEvent("paypal", "BILLING.SUBSCRIPTION.ACTIVATED", { ...sub, status: "ACTIVE" }, tier);

    const response = await fetchWithTimeout(CLAIM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-keepgoing-ingest-token": BILLING_INGEST_TOKEN
      },
      body: JSON.stringify({ provider: "paypal", subscription_id: subscriptionId })
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("paypal_claim_error", safeLogError(error));
    return res.status(502).json({ error: "claim_upstream_error" });
  }
});

app.get("/billing/success", (req, res) => {
  const sessionId = String(req.query.session_id || "");
  const sessionJson = JSON.stringify(sessionId);
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KeepGoing subscription</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}.card{max-width:680px;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:18px;width:100%;box-sizing:border-box}button,a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:14px;border-radius:10px;margin:14px 0}.ok{color:#3fb950}.muted{color:#8b949e}</style></head><body><div class="card"><h1>KeepGoing subscription</h1><p id="status">Confirming your Stripe subscription…</p><div id="result"></div><p><a href="/subscribe">Return to subscription page</a></p></div><script>const sessionId=' + sessionJson + ';(async()=>{const status=document.getElementById("status"),result=document.getElementById("result");if(!sessionId){status.textContent="Missing checkout session.";return;}for(let i=0;i<12;i++){const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({session_id:sessionId})});const j=await r.json().catch(()=>({}));if(r.ok&&j.token){status.innerHTML="<span class=\"ok\">Subscription active.</span>";result.innerHTML="<p>Your "+j.tier+" plan includes "+j.monthly_limit+" KeepGoing jobs per month.</p><p>Save this private activation token. ChatGPT asks for it when you connect KeepGoing:</p><code id=\"mcp\"></code><button id=\"copy\">Copy activation token</button><p><a href=\"/install\">Open installation instructions</a></p><p class=\"muted\">Keep the token private. Claiming again rotates it.</p>";document.getElementById("mcp").textContent=j.token;document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(j.token);return;}if(j.error!=="subscription_not_found"){status.textContent=j.error||"Could not activate subscription.";return;}await new Promise(r=>setTimeout(r,1500));}status.textContent="Payment completed, but activation is still processing. Refresh this page in a moment.";})().catch(()=>{document.getElementById("status").textContent="Could not confirm subscription.";});</script></body></html>';
  res.type("html").send(html);
});

app.get("/subscribe", async (req, res) => {
  if (paypalClientId && paypalClientSecret && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }

  const paypalReady = Boolean(paypalClientId && paypalClientSecret && paypalSetupComplete && paypalConfig.pro_plan_id && paypalConfig.business_plan_id);
  const cancelled = String(req.query?.cancelled || "") === "1";
  const returnedSubscriptionId = String(req.query?.subscription_id || "").trim();
  const returnedClaimId = String(req.query?.claim_id || "").trim();
  const canActivate = Boolean(/^I-[A-Z0-9]+$/i.test(returnedSubscriptionId) && /^kgc_[0-9a-f]{64}$/.test(returnedClaimId));

  const setupMessage = paypalReady
    ? '<p class="good">Secure PayPal subscription checkout is ready.</p>'
    : '<div class="notice"><strong>Checkout is being activated.</strong><br>The KeepGoing service is online, but new paid subscriptions are temporarily unavailable.</div>';
  const cancelMessage = cancelled
    ? '<div class="notice">PayPal checkout was cancelled. No KeepGoing subscription was activated.</div>'
    : "";
  const proAction = paypalReady
    ? '<form method="post" action="/paypal/start-subscription"><input type="hidden" name="tier" value="pro"><button class="checkout" type="submit">Continue with PayPal</button></form>'
    : '<span class="muted">Payment button appears when PayPal checkout is ready.</span>';
  const bizAction = paypalReady
    ? '<form method="post" action="/paypal/start-subscription"><input type="hidden" name="tier" value="business"><button class="checkout" type="submit">Continue with PayPal</button></form>'
    : '<span class="muted">Payment button appears when PayPal checkout is ready.</span>';

  const activationScript = canActivate
    ? '<script>const subscriptionId=' + JSON.stringify(returnedSubscriptionId) + ';const claimId=' + JSON.stringify(returnedClaimId) + ';(async()=>{const result=document.getElementById("kg-result");for(let i=0;i<20;i++){result.textContent="Activating subscription…";const r=await fetch("/paypal/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subscription_id:subscriptionId,claim_id:claimId})});const j=await r.json().catch(()=>({}));if(r.ok&&j.token){result.innerHTML="<strong>Subscription active.</strong><br>Save this private activation token:<code id=\"kg-mcp\"></code><button id=\"kg-copy\" type=\"button\">Copy activation token</button><p><a href=\"/install\">Open installation instructions</a></p>";document.getElementById("kg-mcp").textContent=j.token;document.getElementById("kg-copy").onclick=()=>navigator.clipboard.writeText(j.token);history.replaceState(null,"","/subscribe");return;}if(j.error==="subscription_not_active"&&(j.status==="APPROVED"||j.status==="APPROVAL_PENDING")){await new Promise(x=>setTimeout(x,1500));continue;}throw new Error(j.error||"Activation failed");}result.textContent="PayPal approved the subscription, but activation is still processing. Refresh this page in a moment.";})().catch(e=>{document.getElementById("kg-result").textContent=e.message||"Could not confirm subscription.";});</script>'
    : "";

  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0d1117"><title>KeepGoing direct subscriptions</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:36px;line-height:1.55}.wrap{max-width:900px;margin:auto}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:22px 0}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:24px}.price{font-size:34px;font-weight:700}.muted{color:#8b949e}.notice{background:#2d2405;border:1px solid #9e7b00;border-radius:12px;padding:14px;margin:18px 0}.good{color:#3fb950}a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:12px;border-radius:9px;margin:10px 0}.checkout{width:100%;border:0;border-radius:999px;background:#ffc439;color:#111;padding:13px 18px;font:700 16px system-ui;cursor:pointer;margin-top:10px}button{padding:10px 14px;margin-top:8px}#kg-result{margin:18px 0}</style></head><body><div class="wrap"><h1>KeepGoing direct subscriptions</h1><p>This is KeepGoing’s direct web checkout, separate from the ChatGPT plugin experience.</p>' + cancelMessage + setupMessage + '<div class="plans"><div class="card"><h2>Pro</h2><div class="price">£7.99<span style="font-size:16px">/mo</span></div><p>100 jobs/month · up to 3 hosted web tool calls per job.</p>' + proAction + '</div><div class="card"><h2>Business</h2><div class="price">£29<span style="font-size:16px">/mo</span></div><p>500 jobs/month · up to 5 hosted web tool calls per job.</p>' + bizAction + '</div></div><div id="kg-result"></div><p class="muted">You are redirected to PayPal to approve the subscription. KeepGoing never receives your PayPal password or full card details. After PayPal confirms an active subscription, KeepGoing issues a private activation token.</p><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds & cancellation</a> · <a href="/support">Support</a></p></div>' + activationScript + '</body></html>';
  res.type("html").send(html);
});
app.get("/", (_req, res) => {
  const socialImage = PUBLIC_BASE_URL + "/icon.png";
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1117"><meta name="description" content="KeepGoing keeps substantial AI jobs progressing without repeated continue prompts."><link rel="canonical" href="' + htmlEscape(PUBLIC_BASE_URL + "/") + '"><link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.json"><meta property="og:type" content="website"><meta property="og:site_name" content="KeepGoing"><meta property="og:title" content="KeepGoing — persistent AI work"><meta property="og:description" content="Durable AI jobs that keep progressing without repeated continue prompts."><meta property="og:url" content="' + htmlEscape(PUBLIC_BASE_URL + "/") + '"><meta property="og:image" content="' + htmlEscape(socialImage) + '"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="KeepGoing — persistent AI work"><meta name="twitter:description" content="Durable AI jobs that keep progressing without repeated continue prompts."><meta name="twitter:image" content="' + htmlEscape(socialImage) + '"><title>KeepGoing — persistent AI work</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"KeepGoing","applicationCategory":"ProductivityApplication","operatingSystem":"Web","description":"Durable AI jobs that keep progressing without repeated continue prompts."}</script><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:36px;line-height:1.55}.wrap{max-width:1040px;margin:auto}.hero{display:flex;gap:20px;align-items:center;margin-bottom:24px}.logo{width:92px;height:92px;border-radius:24px}.tag{color:#7ee7df;font-weight:700;letter-spacing:.04em}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.btn{display:inline-block;padding:11px 16px;border-radius:10px;background:#1f6feb;color:#fff;text-decoration:none;font-weight:700}.btn.secondary{background:#21262d;border:1px solid #30363d}.grid,.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin:22px 0}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:24px}.muted{color:#8b949e}.notice{background:#10253a;border:1px solid #1f6feb;border-radius:12px;padding:14px;margin:18px 0}a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:12px;border-radius:9px;margin:10px 0}h2{margin-top:34px}</style></head><body><div class="wrap"><div class="hero"><img class="logo" src="/icon.svg" alt="KeepGoing icon"><div><div class="tag">CONTINUE WITHOUT THE CHASING</div><h1>KeepGoing</h1><p>Persistent AI background jobs for substantial work, research and long-running tasks. KeepGoing preserves the same job so ChatGPT can resume, check and continue it instead of repeatedly restarting the work.</p><div class="actions"><a class="btn" href="/install">Connect existing account</a><a class="btn secondary" href="/status">Service status</a></div></div></div><div class="notice"><strong>Existing KeepGoing account required.</strong><br>Connect the app in ChatGPT and use your existing activation token. Purchasing and account upgrades are not part of the ChatGPT plugin experience.</div><h2>Built for work that takes more than one turn</h2><div class="grid"><div class="card"><h3>Keep the same job</h3><p>Stable job IDs let ChatGPT check, wait on and resume the same durable task instead of starting again.</p></div><div class="card"><h3>Continue automatically</h3><p>The watchdog can advance partial work server-side, within hard cost and safety limits.</p></div><div class="card"><h3>Recover in a new chat</h3><p>List your own active jobs later and carry on from the same durable state.</p></div></div><h2>Existing-account access</h2><div class="card"><p>KeepGoing uses the limits and features already attached to your existing account. If a requested feature is unavailable for your current entitlement, KeepGoing can explain that limitation without starting a purchase or upgrade flow in ChatGPT.</p></div><h2>Useful for</h2><div class="grid"><div class="card"><strong>Research & comparisons</strong><p>Longer evidence-gathering jobs that need multiple passes.</p></div><div class="card"><strong>Build & debugging work</strong><p>Structured objectives where the job should keep progressing until a real blocker appears.</p></div><div class="card"><strong>Operational follow-through</strong><p>Multi-step work where you want a stable checkpoint and clear completion state.</p></div></div><h2>Questions?</h2><p><a href="/faq">Read the FAQ</a> or <a href="/support">contact support</a>.</p><p class="muted" style="margin-top:26px"><a href="/install">Install</a> · <a href="/status">Status</a> · <a href="/faq">FAQ</a> · <a href="/changelog">Changelog</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds & cancellation</a> · <a href="/support">Support</a> · <a href="/security">Security</a></p></div></body></html>';
  res.type("html").send(html);
});

app.get("/icon.svg", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.type("image/svg+xml").send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#27f3df"/><stop offset="1" stop-color="#0798d8"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="#0d1117"/><path d="M196 82a91 91 0 1 0 20 66" fill="none" stroke="url(#g)" stroke-width="28" stroke-linecap="round"/><path d="M177 42l45 38-51 24z" fill="url(#g)"/><path d="M105 87l63 41-63 41z" fill="url(#g)"/></svg>');
});

app.get("/icon.png", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.type("png").sendFile(ICON_PNG_FILE);
});

app.get("/manifest.json", (_req, res) => {
  res.json({
    name: "KeepGoing",
    short_name: "KeepGoing",
    description: "Persistent AI jobs that continue without repeated continue prompts.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    icons: [{ src: "/icon.png", sizes: "256x256", type: "image/png" }, { src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  });
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nAllow: /\nDisallow: /subscribe\nDisallow: /oauth/\nDisallow: /billing/\nDisallow: /paypal/\nDisallow: /openai/\nDisallow: /mcp\nSitemap: " + PUBLIC_BASE_URL + "/sitemap.xml\n");
});

app.get("/sitemap.xml", (_req, res) => {
  const paths = ["/", "/install", "/faq", "/status", "/changelog", "/privacy", "/terms", "/refunds", "/support", "/security"];
  const urls = paths.map((path) => "<url><loc>" + htmlEscape(PUBLIC_BASE_URL + path) + "</loc></url>").join("");
  res.type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + "</urlset>");
});

app.get("/faq", (_req, res) => {
  res.type("html").send(infoPage("Frequently asked questions", [
    "<h2>What problem does KeepGoing solve?</h2><p>It gives substantial AI work a stable durable job so you do not have to repeatedly restart the same objective or type continue just to advance it.</p>",
    "<h2>Does it bypass ChatGPT limits or safeguards?</h2><p>No. KeepGoing works through normal OpenAI and ChatGPT permissions, plan limits and safety controls.</p>",
    "<h2>Can it create new ChatGPT messages by itself?</h2><p>No. The server-side job can continue supported work in the background, and ChatGPT can later retrieve the durable result or status.</p>",
    "<h2>What happens if information is genuinely missing?</h2><p>The job enters <code>input_required</code> instead of inventing a credential, approval or fact. You can then resume that same job.</p>",
    "<h2>Can I recover a job in another chat?</h2><p>Yes. <code>list_persistent_jobs</code> returns your own recent jobs, and status/result tools reuse the same job ID.</p>",
    "<h2>Is my activation token my ChatGPT password?</h2><p>No. KeepGoing never needs your ChatGPT password. Treat the activation token as a private KeepGoing credential.</p>",
    "<h2>What if my account does not include a feature?</h2><p>KeepGoing can explain that a feature is unavailable for your current entitlement. The ChatGPT plugin does not initiate purchases or upgrades.</p>"
  ].join("")));
});

app.get("/status", (_req, res) => {
  const html = infoPage("Service status", [
    "<p id=\"summary\">Checking KeepGoing…</p>",
    "<ul><li>API / engine: <strong id=\"engine\">checking</strong></li><li>Durable store: <strong id=\"store\">checking</strong></li><li>Account connection: <strong id=\"oauth\">checking</strong></li></ul>",
    "<p class=\"muted\">This public status page reports the plugin-facing service, durable store and account connection. The watchdog is the production continuation mechanism; the OpenAI webhook is optional.</p>",
    "<script>(async()=>{const e=id=>document.getElementById(id);try{const r=await fetch(\"/readiness\",{cache:\"no-store\"});const j=await r.json();e(\"summary\").textContent=j.ok?\"KeepGoing core service is operational.\":\"KeepGoing is currently degraded.\";e(\"engine\").textContent=j.engine_ready?\"operational\":\"degraded\";e(\"store\").textContent=j.durable_store_ready?\"operational\":\"degraded\";e(\"oauth\").textContent=j.oauth_ready?\"operational\":\"degraded\";}catch{e(\"summary\").textContent=\"Status check unavailable.\";}})();</script>"
  ].join(""));
  res.type("html").send(html);
});

app.get("/changelog", (_req, res) => {
  res.type("html").send(infoPage("Changelog", [
    "<h2>1.2.0-beta.22 — 29 September 2026</h2><ul><li>Added final OpenAI submission metadata directly to the plugin package: five positive tests, three negative tests, UK availability, commerce declaration and release notes.</li><li>Polished the public listing description and prepared the upload-ready package copy.</li></ul><h2>1.2.0-beta.21 — 29 September 2026</h2><ul><li>Hardened public-directory metadata and plugin-facing commerce boundaries for current OpenAI review requirements.</li><li>Added the required support URL, directory-length short description, accessible light/dark brand colors, and removed subscription-plan cards from the plugin website.</li><li>Added a complete submission-readiness checklist with reviewer tests and annotation justifications.</li></ul><h2>1.2.0-beta.20 — 29 September 2026</h2><ul><li>Hardened durable job startup against transient provider/session failures.</li><li>Initial Agent-session creation now uses a deterministic idempotency key, retries transient failures, recovers accepted sessions by metadata, and can revive a failed pre-turn reservation from the same client request without consuming quota twice.</li><li>The production startup command now runs the full regression suite before serving traffic.</li></ul><h2>1.2.0-beta.19 — 29 September 2026</h2><ul><li>Replaced the embedded PayPal JavaScript button flow with a server-side PayPal subscription approval redirect after live-browser verification found the embedded buttons were not rendering.</li><li>Added server-generated claim binding, validated PayPal approval URLs, cancellation return handling and post-approval activation recovery.</li></ul><h2>1.2.0-beta.18 — 29 September 2026</h2><ul><li>Cleared stale PayPal setup-error state whenever Live checkout is healthy.</li><li>Final commercial readiness/status cleanup after successful PayPal Live bootstrap.</li></ul><h2>1.2.0-beta.17 — 29 September 2026</h2><ul><li>Added a one-time secure PayPal Live bootstrap page so credentials no longer need to be pasted into chat or Render manually.</li><li>PayPal credentials are validated live, encrypted with KeepGoing's server key and persisted only in the protected billing config.</li><li>Stored PayPal credentials are loaded automatically after service restarts.</li></ul><h2>1.2.0-beta.16 — 29 September 2026</h2><ul><li>Removed unsupported automatic Agent-session webhook provisioning introduced in beta.15.</li><li>Promoted the proven watchdog recovery path to the production durability requirement.</li><li>OpenAI webhook support remains optional and can be enabled only when a compatible event stream is configured.</li><li>Readiness now reports <code>continuation_mode</code> and <code>watchdog_ready</code>.</li></ul><h2>1.2.0-beta.15 — 29 September 2026</h2><ul><li>Added managed OpenAI webhook provisioning using the existing project API key.</li><li>KeepGoing now creates or updates its Agents-session webhook and obtains/rotates the signing secret automatically when no manual secret is configured.</li><li>Readiness exposes only managed/ready/error booleans; the signing secret is never returned.</li></ul><h2>1.2.0-beta.14 — 29 September 2026</h2><ul><li>Added the official portable OpenAI plugin package manifest.</li><li>Bundled the KeepGoing PNG asset as both the plugin composer icon and logo.</li><li>Added the portable MCP package definition for the live KeepGoing endpoint.</li><li>Added CI validation for plugin package metadata and asset paths.</li></ul><h2>1.2.0-beta.13 — 29 September 2026</h2><ul><li>Restored implicit plain-language continuation for the authenticated owner/admin connection only.</li><li>Owner phrases such as <code>continue</code>, <code>keep going</code>, <code>finish it</code> and <code>until done</code> now strongly select <code>continue_until_done</code> without requiring the word KeepGoing.</li><li>Public/customer connections retain explicit KeepGoing intent requirements for directory compliance.</li></ul><h2>1.2.0-beta.12 — 29 September 2026</h2><ul><li>Clarified completion semantics so the execution model does not wait for a nonexistent KeepGoing control tool after the requested work is already done.</li><li>The server remains solely responsible for translating the model’s final <code>STATUS</code> marker into durable job state.</li><li>Added regression tests for this completion rule.</li></ul><h2>1.2.0-beta.11 — 29 September 2026</h2><ul><li>Added graceful SIGTERM/SIGINT shutdown so Render deploys stop the watchdog and drain active HTTP work cleanly.</li><li>Added bounded server request/header/keep-alive timeouts.</li><li>Added safe request IDs for support correlation.</li><li>Reduced detail in failed PayPal webhook verification logs and applied protected-error redaction consistently.</li></ul><h2>1.2.0-beta.10 — 29 September 2026</h2><ul><li>Added bounded timeouts to PayPal, billing, OAuth-ledger, subscription-auth and claim-backend requests.</li><li>Upstream stalls now fail promptly instead of tying up service requests indefinitely.</li></ul><h2>1.2.0-beta.9 — 29 September 2026</h2><ul><li>Added a strict CSP to the OAuth authorization flow.</li><li>Redacted upstream billing errors from customer-facing claim responses.</li><li>Sanitized PayPal bootstrap logging.</li></ul><h2>1.2.0-beta.8 — 29 September 2026</h2><ul><li>Fixed the OAuth connection page for new customers and removed stale sales markup from authorization.</li><li>Added a hosted 256×256 PNG icon for app and social previews.</li><li>Added <code>/.well-known/security.txt</code> and structured SoftwareApplication metadata.</li></ul><h2>1.2.0-beta.7 — 29 September 2026</h2><ul><li>Bound PayPal activation claims to a random checkout-specific <code>custom_id</code>.</li><li>A subscription ID alone can no longer issue or rotate a KeepGoing activation token.</li></ul><h2>1.2.0-beta.6</h2><ul><li>Separated direct web subscription checkout from the public ChatGPT plugin/listing experience.</li><li>Narrowed host context to a brief task-specific checkpoint and explicitly prohibited full transcripts/credentials.</li><li>Aligned MCP metadata versioning and privacy language with the deployed release.</li></ul><h2>1.2.0-beta.5</h2><ul><li>Owner-token configuration now fails closed if the environment value is missing.</li><li>OAuth and internal endpoints use stricter no-store/noindex handling.</li><li>Reduced public infrastructure fingerprinting and PayPal status detail exposure.</li></ul><h2>1.2.0-beta.4</h2><ul><li>Improved commercial landing page and onboarding.</li><li>Added FAQ, status, sitemap and robots routes.</li><li>Added richer social/search metadata.</li></ul>",
    "<h2>1.2.0-beta.3</h2><ul><li>Commercial branding and hosted icon/manifest.</li><li>Refunds & cancellation policy.</li><li>Truthful commercial-readiness blocker reporting.</li><li>PayPal activation hardening: access only after an ACTIVE subscription.</li></ul>",
    "<h2>1.2.0-beta.2</h2><ul><li>Added <code>continue_until_done</code>, host-context passthrough and stricter genuine-block-only stops.</li><li>Secure durable-store proxy and owner-canary rollout.</li></ul>"
  ].join("")));
});
function infoPage(title, body) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + htmlEscape(title) + ' — KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:28px;line-height:1.55}.wrap{max-width:780px;margin:auto}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:28px}a{color:#58a6ff}code{background:#0d1117;padding:2px 6px;border-radius:6px}.muted{color:#8b949e}h1,h2{line-height:1.2}</style></head><body><div class="wrap"><p><a href="/">← KeepGoing</a></p><div class="card"><h1>' + htmlEscape(title) + '</h1>' + body + '</div></div></body></html>';
}

app.get("/install", (_req, res) => {
  res.type("html").send(infoPage("Install KeepGoing", [
    "<p><strong>Connection endpoint:</strong> <code>" + htmlEscape(PUBLIC_BASE_URL + "/mcp") + "</code></p>",
    "<p>KeepGoing uses OAuth. Existing customers connect with their private activation token. Do not put the token in the MCP URL or paste it into a normal chat message.</p>",
    "<h2>Private beta / developer connection</h2>",
    "<ol><li>In an eligible ChatGPT account, create or connect a custom MCP app.</li><li>Use the endpoint shown above.</li><li>Select OAuth when prompted.</li><li>Complete the KeepGoing connection page with your activation token.</li><li>Scan the tools and confirm <code>continue_until_done</code>, <code>start_persistent_job</code>, <code>get_persistent_job</code>, <code>wait_for_persistent_job</code>, <code>list_persistent_jobs</code>, <code>resume_persistent_job</code> and <code>cancel_persistent_job</code>.</li><li>Try: <code>Use KeepGoing and finish this job until done.</code></li></ol>",
    "<p class=\"muted\">ChatGPT plan, workspace and plugin/app availability can affect whether custom MCP connections are available. The public Plugin Directory release will use the same hosted service after approval.</p>",
    "<h2>What KeepGoing does</h2><p>It runs supported work as a durable OpenAI job/session, stores the KeepGoing job ID and lets ChatGPT check, recover or resume that same job. The server-side watchdog can continue partial work within hard limits. It does not control ChatGPT's private reasoning, bypass product limits, or force a new chat turn after ChatGPT has already ended one.</p>"
  ].join("")));
});

app.get("/privacy", (_req, res) => {
  res.type("html").send(infoPage("Privacy policy", [
    "<p><strong>Last updated:</strong> 29 September 2026</p>",
    "<p>KeepGoing processes the minimum information needed to operate subscriptions and persistent jobs.</p>",
    "<h2>Information processed</h2>",
    "<ul><li>Subscriber email address where supplied by the payment provider, provider customer/subscription identifiers, plan and subscription status.</li><li>Monthly usage counters and plan limits.</li><li>KeepGoing activation tokens are stored by the billing backend only as SHA-256 hashes; short-lived OAuth access and refresh tokens are issued for ChatGPT connections.</li><li>The goal, definition of done, options and—only when needed—a brief task-specific checkpoint submitted for a persistent job are sent to OpenAI's API to run that job.</li><li>When codingWorkspace is explicitly enabled, the public GitHub repository locator/ref and the public repository contents cloned from that source are processed in an isolated OpenAI-hosted sandbox so the job can inspect, edit and test code. Beta.23 supports public repositories only and does not perform remote repository writes.</li><li>When workspaceFiles is explicitly used, only the selected task-relevant text files supplied for that job are sent to the hosted coding workspace. This handoff is size/path bounded and the file bodies are not stored in KeepGoing's durable job database.</li><li>KeepGoing does not independently retrieve your full ChatGPT history. The MCP context field is intentionally bounded and should never contain full chat transcripts, passwords, API keys, payment credentials or unrelated personal data.</li><li>Technical service logs needed for reliability, security and abuse prevention.</li></ul>",
    "<h2>Service providers</h2><p>Job requests are sent to OpenAI's API for execution. Payment providers process payment details; KeepGoing receives subscription/payment status and identifiers rather than full card details. Hosting and infrastructure providers may process technical request data as needed to operate the service.</p>",
    "<h2>Purpose</h2><p>We use this information to provide the service, enforce plan limits, process subscriptions, secure accounts, diagnose faults and prevent abuse.</p>",
    "<h2>Retention</h2><p>Active subscription and usage records are retained while the subscription is active. Revoked access-token hashes are retained for up to 24 months for support, fraud prevention and security. Inactive subscription/payment metadata is retained for up to six years for accounting, tax, billing reconciliation and dispute handling, or longer where law or an unresolved matter requires it. OAuth access tokens expire after one hour and refresh tokens after 30 days. OpenAI may temporarily retain provider-side application state needed to run, poll and recover durable work according to the applicable API product and account data controls. Hosting providers may retain technical logs according to their own policies.</p>",
    "<h2>Your choices</h2><p>Do not submit information you do not want processed by the service. You can cancel a subscription through the available billing provider. For account or privacy questions, contact <a href=\"mailto:info@thesmashroom.co.uk\">info@thesmashroom.co.uk</a>.</p>",
    "<p class=\"muted\">KeepGoing is in commercial beta. This policy will be updated if the data flow or providers materially change.</p>"
  ].join("")));
});

app.get("/terms", (_req, res) => {
  res.type("html").send(infoPage("Terms of service", [
    "<p><strong>Last updated:</strong> 28 September 2026</p>",
    "<p>KeepGoing is a subscription software service for persistent AI background jobs. By purchasing or using a paid plan you agree to these terms.</p>",
    "<h2>Plans and billing</h2><p>Paid plans renew monthly until cancelled. Current advertised limits are 100 jobs/month for Pro and 500 jobs/month for Business. A job is counted when a new persistent background job is started.</p>",
    "<h2>Cancellation</h2><p>You may cancel future renewal through the available billing provider. Any rights you have under applicable consumer law are not excluded. Where applicable law provides a cooling-off or cancellation right, that right continues to apply.</p>",
    "<h2>Usage limits</h2><p>Plans include a monthly number of new background jobs and reasonable per-job technical limits on generated tokens and hosted tool calls. These limits protect service reliability and predictable subscription pricing. Current limits are shown on the plan page and may be adjusted for future billing periods with appropriate notice.</p>",
    "<h2>Acceptable use</h2><p>You must not use KeepGoing for unlawful activity, to bypass platform safeguards, to attack or disrupt systems, or to access accounts or information without permission.</p>",
    "<h2>Service limitations</h2><p>KeepGoing depends on third-party services including ChatGPT/OpenAI, hosting and payment providers. Availability can therefore be affected by their outages, limits, plan rules or product changes. KeepGoing cannot guarantee that ChatGPT will continue making tool calls after a chat turn has ended.</p>",
    "<h2>Liability</h2><p>KeepGoing is provided as a productivity tool. You remain responsible for reviewing important outputs and actions. Nothing in these terms excludes liability that cannot legally be excluded.</p>",
    "<h2>Contact</h2><p>Questions about these terms: <a href=\"mailto:info@thesmashroom.co.uk\">info@thesmashroom.co.uk</a>.</p>"
  ].join("")));
});

app.get("/refunds", (_req, res) => {
  res.type("html").send(infoPage("Refunds & cancellation", [
    "<p><strong>Last updated:</strong> 29 September 2026</p>",
    "<p>Paid KeepGoing plans renew monthly until cancelled. You can cancel future renewals through the payment provider used for your subscription.</p>",
    "<h2>Refunds</h2><p>If KeepGoing is materially unavailable or does not provide the paid service described for reasons within our control, contact support and we will review a reasonable refund request. This does not limit any statutory rights you may have.</p>",
    "<h2>Cooling-off and consumer rights</h2><p>Where applicable law gives you cancellation, cooling-off or refund rights, those rights continue to apply and are not excluded by this policy.</p>",
    "<h2>How to request help</h2><p>Email <a href=\"mailto:info@thesmashroom.co.uk\">info@thesmashroom.co.uk</a> with the payment-provider transaction or subscription reference. Never send passwords, card details or activation tokens.</p>"
  ].join("")));
});

app.get("/support", (_req, res) => {
  res.type("html").send(infoPage("Support", [
    "<p>Email: <a href=\"mailto:info@thesmashroom.co.uk\">info@thesmashroom.co.uk</a></p>",
    "<h2>Before contacting support</h2><ol><li>Check that your subscription is active.</li><li>Reconnect KeepGoing if ChatGPT reports an expired connection.</li><li>Use the same job ID when checking a running job; do not start a duplicate.</li><li>Never email your activation token, ChatGPT password, payment password or API keys.</li></ol>",
    "<p class=\"muted\">For payment-account security, KeepGoing support will never ask for a PayPal, bank or ChatGPT password.</p>"
  ].join("")));
});

app.get("/security", (_req, res) => {
  res.type("html").send(infoPage("Security", [
    "<p>KeepGoing uses HTTPS with HSTS, OAuth authorization-code flow with PKCE for ChatGPT connections, single-use authorization codes backed by a server-only ledger, short-lived access tokens, refresh tokens, subscription validation, rate limiting on sensitive authorization/claim routes, no-store caching on sensitive routes and signed payment webhooks where configured.</p>",
    "<h2>Secrets</h2><p>Activation tokens and OAuth tokens are credentials. Keep them private. KeepGoing does not require your ChatGPT password.</p>",
    "<h2>Reporting a security issue</h2><p>Please email <a href=\"mailto:info@thesmashroom.co.uk\">info@thesmashroom.co.uk</a> with enough detail to reproduce the issue. Do not include live passwords, payment credentials or other people's personal information.</p>"
  ].join("")));
});

app.get("/billing/plans", async (_req, res) => {
  if (paypalClientId && paypalClientSecret && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }
  res.json({
    free: { price_gbp: 0, jobs_per_month: 3 },
    pro: { price_gbp: 7.99, jobs_per_month: 100, paypal_plan_id: paypalConfig.pro_plan_id || null },
    business: { price_gbp: 29, jobs_per_month: 500, paypal_plan_id: paypalConfig.business_plan_id || null },
    payment_provider: "paypal",
    paypal_mode: PAYPAL_MODE,
    paypal_configured: Boolean(paypalClientId && paypalClientSecret),
    paypal_ready: paypalSetupComplete,
    stripe_sandbox_available: Boolean(PRO_PRICE_ID && BUSINESS_PRICE_ID)
  });
});

app.get("/paypal/status", async (_req, res) => {
  if (paypalClientId && paypalClientSecret && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }
  res.json({
    configured: Boolean(paypalClientId && paypalClientSecret),
    ready: paypalSetupComplete,
    mode: PAYPAL_MODE,
    setup_error: Boolean(paypalSetupError && !paypalSetupComplete)
  });
});

app.get("/readiness", async (_req, res) => {
  if (paypalClientId && paypalClientSecret && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }
  const engineReady = Boolean(OPENAI_API_KEY);
  const billingBackendReady = Boolean(
    AUTH_URL &&
    CLAIM_URL &&
    BILLING_INGEST_URL &&
    BILLING_INGEST_TOKEN
  );
  const checkoutReady = Boolean(
    paypalClientId &&
    paypalClientSecret &&
    paypalSetupComplete
  );
  let durableStoreReady = !V12_ENABLED;
  if (V12_ENABLED && v12Configured()) {
    try {
      const runtime = getV12Runtime();
      durableStoreReady = Boolean(
        runtime.store?.healthCheck &&
        (await runtime.store.healthCheck()).ok
      );
    } catch {
      durableStoreReady = false;
    }
  }
  const durableOpsReady = !V12_ENABLED || Boolean(
    v12Configured() &&
    durableStoreReady
  );
  const oauthReady = Boolean(OAUTH_SECRET && OAUTH_CODE_URL);
  const commercialDurableReady = !V12_ENABLED || Boolean(
    v12Configured() &&
    durableStoreReady &&
    !V12_CANARY_ONLY
  );
  const continuationMode = V12_ENABLED
    ? (OPENAI_WEBHOOK_SECRET ? "watchdog+webhook" : "watchdog")
    : "legacy";
  const commercialBlockers = [];
  if (!engineReady) commercialBlockers.push("openai_api");
  if (!billingBackendReady) commercialBlockers.push("billing_backend");
  if (!checkoutReady) commercialBlockers.push("live_checkout");
  if (!oauthReady) commercialBlockers.push("oauth");
  if (V12_ENABLED && !v12Configured()) commercialBlockers.push("durable_engine");
  if (V12_ENABLED && !durableStoreReady) commercialBlockers.push("durable_store");
  if (V12_ENABLED && V12_CANARY_ONLY) commercialBlockers.push("v12_owner_canary_only");

  const sellReady = Boolean(
    engineReady &&
    billingBackendReady &&
    checkoutReady &&
    commercialDurableReady &&
    oauthReady
  );

  res.json({
    ok: engineReady && billingBackendReady && durableOpsReady,
    version: V12_ENABLED ? APP_VERSION : "1.1.0",
    engine_ready: engineReady,
    durable_engine_enabled: V12_ENABLED,
    durable_engine_ready: v12Configured(),
    durable_store_ready: durableStoreReady,
    openai_webhook_ready: Boolean(V12_ENABLED && OPENAI_WEBHOOK_SECRET),
    billing_backend_ready: billingBackendReady,
    checkout_ready: checkoutReady,
    oauth_ready: oauthReady,
    owner_canary_only: Boolean(V12_ENABLED && V12_CANARY_ONLY),
    commercial_durable_ready: commercialDurableReady,
    continuation_mode: continuationMode,
    watchdog_ready: Boolean(V12_ENABLED && v12Configured() && durableStoreReady),
    commercial_blockers: commercialBlockers,
    sell_ready: sellReady,
    payment_provider: "paypal",
    paypal_mode: PAYPAL_MODE,
    protected: true
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "KeepGoing MCP",
    version: V12_ENABLED ? APP_VERSION : "1.1.0",
    openaiConfigured: Boolean(OPENAI_API_KEY),
    durableEngineEnabled: V12_ENABLED,
    durableEngineReady: v12Configured(),
    openaiWebhookConfigured: Boolean(OPENAI_WEBHOOK_SECRET),
    protected: true,
    model: MODEL,
    paypalConfigured: Boolean(paypalClientId && paypalClientSecret),
    paypalReady: paypalSetupComplete,
    paypalMode: PAYPAL_MODE,
    oauthConfigured: Boolean(OAUTH_SECRET),
    oauthCodeLedgerConfigured: Boolean(OAUTH_CODE_URL)
  });
});

app.post("/mcp", async (req, res) => {
  const toolName = req.body?.params?.name;
  const isStart =
    req.body?.method === "tools/call" &&
    (toolName === "start_persistent_job" || toolName === "continue_until_done");
  const access = await authorise(req, isStart && !V12_ENABLED);
  if (!access.ok) {
    oauthChallenge(res, access.error === "oauth_token_invalid_scope" ? "insufficient_scope" : "invalid_token", access.error || "Authentication required");
    return res.status(access.status || 401).json({ error: access.error || "unauthorized", tier: access.tier, used: access.used, limit: access.limit });
  }

  // When v1.2 infrastructure is enabled in owner-only canary mode, ordinary
  // subscribers remain on v1.1 and must keep the legacy start-quota charge.
  if (isStart && V12_ENABLED && !v12ForAccess(access)) {
    const consumed = await validateCustomerToken(access._customer_token, true);
    if (!consumed.ok) {
      oauthChallenge(res, "invalid_token", consumed.error || "Subscription quota unavailable");
      return res.status(consumed.status || 401).json({
        error: consumed.error || "unauthorized",
        tier: consumed.tier,
        used: consumed.used,
        limit: consumed.limit
      });
    }
    const customerToken = access._customer_token;
    Object.assign(access, consumed, { _customer_token: customerToken });
  }

  if (access.ok && req.body?.id != null) {
    access._mcp_request_id = "mcp-" + digest(String(req.body.id));
  }
  const server = createMcpServer(access);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", async () => {
    try { await transport.close(); } catch {}
    try { await server.close(); } catch {}
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "mcp_error" });
  }
});

app.get("/mcp", async (req, res) => {
  const access = await authorise(req, false);
  if (!access.ok) {
    oauthChallenge(res, "invalid_token", access.error || "Authentication required");
    return res.status(access.status || 401).json({ error: access.error || "unauthorized" });
  }
  res.status(405).json({ error: "Use POST for stateless MCP" });
});

let watchdogTimer = null;
let shuttingDown = false;

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log("KeepGoing MCP " + (V12_ENABLED ? "v" + APP_VERSION : "v1.1.0") + " listening on " + PORT);

  if (V12_ENABLED) {
    try {
      const runtime = getV12Runtime();
      watchdogTimer = setInterval(() => {
        runtime.watchdog.runOnce().catch((error) => {
          console.error("keepgoing_v12_watchdog_error", safeLogError(error));
        });
      }, V12_WATCHDOG_INTERVAL_MS);
      watchdogTimer.unref();
      runtime.watchdog.runOnce().catch((error) => {
        console.error("keepgoing_v12_watchdog_startup_error", safeLogError(error));
      });
    } catch (error) {
      console.error("keepgoing_v12_startup_error", safeLogError(error));
    }
  }

  void (async () => {
    try {
      if (!paypalClientId || !paypalClientSecret) {
        await loadStoredPayPalCredentials();
      }
      if (paypalClientId && paypalClientSecret) {
        await ensurePayPalSetup();
        console.log("PayPal " + PAYPAL_MODE + " subscriptions ready");
      }
    } catch (error) {
      console.error("PayPal bootstrap failed:", safeLogError(error));
    }
  })();
});

httpServer.requestTimeout = 90_000;
httpServer.headersTimeout = 15_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("keepgoing_shutdown_start", signal);

  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  const forceExit = setTimeout(() => {
    console.error("keepgoing_shutdown_forced", signal);
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  httpServer.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error("keepgoing_shutdown_error", safeLogError(error));
      process.exitCode = 1;
      return;
    }
    console.log("keepgoing_shutdown_complete", signal);
    process.exitCode = 0;
  });
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));
