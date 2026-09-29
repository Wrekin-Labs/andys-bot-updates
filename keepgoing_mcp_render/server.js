import express from "express";
import crypto from "crypto";
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

const app = express();
const APP_VERSION = "1.2.0-beta.3";

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
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_BASE = PAYPAL_MODE === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";

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
      console.error("stripe_billing_ingest_error", String(error?.message || error));
      return res.status(500).json({ error: "billing_ingest_error" });
    }
  }
  return res.json({ received: true });
});

app.post("/paypal/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return res.status(503).send("PayPal not configured");
  try {
    await ensurePayPalSetup();
  } catch (error) {
    console.error("paypal_setup_error", String(error?.message || error));
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

  const verify = await fetch(PAYPAL_BASE + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: verifyBody
  });
  const verification = await verify.json().catch(() => ({}));
  if (!verify.ok || verification.verification_status !== "SUCCESS") {
    console.error("paypal_webhook_verify_failed", verify.status, verification);
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
      console.error("paypal_billing_ingest_error", String(error?.message || error));
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

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.set("trust proxy", 1);

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

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "DENY");
  res.set("Strict-Transport-Security", "max-age=31536000");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (
    req.path === "/mcp" ||
    req.path.startsWith("/billing/") ||
    req.path.startsWith("/paypal/") ||
    req.path.startsWith("/openai/")
  ) {
    res.set("Cache-Control", "no-store");
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
const TOKEN_HASH = process.env.KEEPGOING_OWNER_TOKEN_HASH || "300caf15b670e9aa648ffc6aa9f7249297566ff6b0ba37898ee4f2da7bd91697";

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

async function forwardBillingEvent(provider, type, object, tier) {
  if (!BILLING_INGEST_URL || !BILLING_INGEST_TOKEN) throw new Error("billing_ingest_not_configured");
  const response = await fetch(BILLING_INGEST_URL, {
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
  const response = await fetch(BILLING_CONFIG_URL, {
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
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PayPal credentials are not configured");
  const basic = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET).toString("base64");
  const response = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data?.error_description || data?.error || ("PayPal OAuth failed (" + response.status + ")"));
  return data.access_token;
}

async function paypalApi(path, init = {}) {
  const token = await paypalAccessToken();
  const response = await fetch(PAYPAL_BASE + path, {
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
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return false;
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
  const response = await fetch(OAUTH_CODE_URL, {
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
    const response = await fetch(AUTH_URL, {
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
    beforeCreateSession: async () => reserveJobQuota(access)
  });
}

async function listPersistentJobsCompat(access, limit = 20, activeOnly = true) {
  if (!v12ForAccess(access)) throw new Error("Durable job listing requires KeepGoing v1.2");
  return getV12Runtime().service.list(
    durableOwnerHash(access),
    { limit, activeOnly }
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
  const oauthSecuritySchemes = [{ type: "oauth2", scopes: [OAUTH_SCOPE] }];
  const oauthMeta = { securitySchemes: oauthSecuritySchemes };

  const server = new McpServer(
    { name: "KeepGoing", version: v12Access ? "1.2.0-beta.2" : "1.1.0" },
    { instructions: v12Access
      ? "Use KeepGoing whenever the user says or clearly means: keep going, continue until done, finish this, don't stop, complete the objective, or work autonomously to completion. Before starting, gather any relevant context already available in the conversation and, when useful and permitted, from connected ChatGPT tools/plugins; pass that context with the job. Prefer continue_until_done for these natural-language requests. Start one durable job and preserve its job_id. The server watchdog continues PARTIAL work without asking the user to type continue. Reuse the same job_id and never create duplicate jobs. Stop only for genuine required user input/approval, a safety/cost limit, cancellation, or completion."
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

  server.registerTool("start_persistent_job", {
    title: "Start persistent job",
    description: "Use for substantial work that should keep progressing until it completes or genuinely needs user input. If relevant prior-chat or connected-tool context is available, the host should gather it first and pass it in context. Do not ask the user to type continue merely to advance this job.",
    inputSchema: {
      goal: z.string().min(1).max(12000),
      definitionOfDone: z.string().min(1).max(4000).default("All requested work completed and verified"),
      mode: z.enum(["safe","balanced","max"]).default("balanced"),
      allowWeb: z.boolean().default(true),
      clientRequestId: z.string().min(1).max(200).optional(),
      context: z.string().max(20000).optional()
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
    description: "PRIMARY KeepGoing entrypoint when the user says continue, keep going, finish it, until done, don't stop, complete the objective, or equivalent. The host should first collect relevant context already available in the current conversation and, when useful and permitted, from connected ChatGPT tools/plugins, then pass it in context. Starts or idempotently recovers one durable job that keeps advancing server-side until completed or genuinely blocked by required user input/approval or a configured safety/cost limit. Never ask the user to type continue just to advance the same objective.",
    inputSchema: {
      goal: z.string().min(1).max(12000),
      definitionOfDone: z.string().min(1).max(4000).default("All requested work completed and verified"),
      mode: z.enum(["safe","balanced","max"]).default("max"),
      allowWeb: z.boolean().default(true),
      clientRequestId: z.string().min(1).max(200).optional(),
      context: z.string().max(20000).optional()
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
        description: "Use for substantial work that should keep progressing until it completes or genuinely needs user input. If relevant prior-chat or connected-tool context is available, the host should gather it first and pass it in context. Do not ask the user to type continue merely to advance this job.",
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", minLength: 1, maxLength: 12000 },
            definitionOfDone: { type: "string", minLength: 1, maxLength: 4000, default: "All requested work completed and verified" },
            mode: { type: "string", enum: ["safe", "balanced", "max"], default: "balanced" },
            allowWeb: { type: "boolean", default: true },
            clientRequestId: { type: "string", minLength: 1, maxLength: 200 },
            context: { type: "string", maxLength: 20000 }
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
        description: "PRIMARY entrypoint for 'continue', 'keep going', 'finish it', 'until done', 'don't stop', or equivalent. Gather relevant current-chat and connected-tool/plugin context first when useful, pass it in context, and keep the same durable job running until completion or a genuine required-user-input/safety stop. Never ask the user to type continue just to advance the same objective.",
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", minLength: 1, maxLength: 12000 },
            definitionOfDone: { type: "string", minLength: 1, maxLength: 4000, default: "All requested work completed and verified" },
            mode: { type: "string", enum: ["safe", "balanced", "max"], default: "max" },
            allowWeb: { type: "boolean", default: true },
            clientRequestId: { type: "string", minLength: 1, maxLength: 200 },
            context: { type: "string", maxLength: 20000 }
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

  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1117"><meta name="description" content="KeepGoing keeps substantial AI jobs progressing without repeated continue prompts."><link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.json"><title>KeepGoing — persistent AI work</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:36px}.wrap{max-width:980px;margin:auto}.hero{display:flex;gap:18px;align-items:center;margin-bottom:24px}.logo{width:86px;height:86px;border-radius:22px}.tag{color:#7ee7df;font-weight:700;letter-spacing:.02em}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:24px}.price{font-size:34px;font-weight:700}.muted{color:#8b949e}.notice{background:#2d2405;border:1px solid #9e7b00;border-radius:12px;padding:14px;margin:18px 0}.good{color:#3fb950}a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:12px;border-radius:9px;margin:10px 0}button{padding:10px 14px;margin-top:8px}#kg-result{margin-top:20px}</style>' + sdk + '</head><body><div class="wrap"><div class="hero"><img class="logo" src="/icon.svg" alt="KeepGoing icon"><div><div class="tag">CONTINUE WITHOUT THE CHASING</div><h1>KeepGoing</h1><p>Persistent AI background jobs for substantial work, research and long-running tasks. KeepGoing preserves the same job so ChatGPT can resume, check and continue it instead of repeatedly restarting the work.</p></div></div>' + setupMessage + '<div class="plans"><div class="card"><h2>Free</h2><div class="price">£0</div><p>3 jobs/month</p><p class="muted">Free access follows the paid beta.</p></div><div class="card"><h2>Pro</h2><div class="price">£7.99<span style="font-size:16px">/mo</span></div><p>100 jobs/month · up to 3 hosted web tool calls per job</p>' + proAction + '</div><div class="card"><h2>Business</h2><div class="price">£29<span style="font-size:16px">/mo</span></div><p>500 jobs/month · up to 5 hosted web tool calls per job</p>' + bizAction + '</div></div><div id="kg-result"></div><p class="muted" style="margin-top:26px"><a href="/install">Install</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds & cancellation</a> · <a href="/support">Support</a> · <a href="/security">Security</a></p></div>' + buttons + '</body></html>';
  res.type("html").send(html);
});

app.post("/oauth/authorize", async (req, res) => {
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
    const response = await fetch(CLAIM_URL, {
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
    return res.status(502).json({ error: String(error?.message || error) });
  }
});

app.post("/paypal/claim", async (req, res) => {
  const subscriptionId = String(req.body?.subscription_id || "");
  if (!subscriptionId) return res.status(400).json({ error: "subscription_id_required" });
  if (!CLAIM_URL || !BILLING_INGEST_TOKEN) return res.status(503).json({ error: "claim_not_configured" });
  try {
    await ensurePayPalSetup();
    const sub = await paypalApi("/v1/billing/subscriptions/" + encodeURIComponent(subscriptionId), { method: "GET" });
    const status = String(sub.status || "").toUpperCase();
    if (!["ACTIVE","APPROVED"].includes(status)) {
      return res.status(409).json({ error: "subscription_not_active", status });
    }
    const planId = String(sub.plan_id || "");
    const tier =
      planId === paypalConfig.business_plan_id ? "business" :
      planId === paypalConfig.pro_plan_id ? "pro" : "";
    if (!tier) return res.status(403).json({ error: "unknown_paypal_plan" });

    await forwardBillingEvent("paypal", "BILLING.SUBSCRIPTION.ACTIVATED", { ...sub, status: "ACTIVE" }, tier);

    const response = await fetch(CLAIM_URL, {
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
    return res.status(502).json({ error: String(error?.message || error) });
  }
});

app.get("/billing/success", (req, res) => {
  const sessionId = String(req.query.session_id || "");
  const sessionJson = JSON.stringify(sessionId);
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KeepGoing subscription</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}.card{max-width:680px;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:18px;width:100%;box-sizing:border-box}button,a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:14px;border-radius:10px;margin:14px 0}.ok{color:#3fb950}.muted{color:#8b949e}</style></head><body><div class="card"><h1>KeepGoing subscription</h1><p id="status">Confirming your Stripe subscription…</p><div id="result"></div><p><a href="/">Return to plans</a></p></div><script>const sessionId=' + sessionJson + ';(async()=>{const status=document.getElementById("status"),result=document.getElementById("result");if(!sessionId){status.textContent="Missing checkout session.";return;}for(let i=0;i<12;i++){const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({session_id:sessionId})});const j=await r.json().catch(()=>({}));if(r.ok&&j.token){status.innerHTML="<span class=\"ok\">Subscription active.</span>";result.innerHTML="<p>Your "+j.tier+" plan includes "+j.monthly_limit+" KeepGoing jobs per month.</p><p>Save this private activation token. ChatGPT asks for it when you connect KeepGoing:</p><code id=\"mcp\"></code><button id=\"copy\">Copy activation token</button><p><a href=\"/install\">Open installation instructions</a></p><p class=\"muted\">Keep the token private. Claiming again rotates it.</p>";document.getElementById("mcp").textContent=j.token;document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(j.token);return;}if(j.error!=="subscription_not_found"){status.textContent=j.error||"Could not activate subscription.";return;}await new Promise(r=>setTimeout(r,1500));}status.textContent="Payment completed, but activation is still processing. Refresh this page in a moment.";})().catch(()=>{document.getElementById("status").textContent="Could not confirm subscription.";});</script></body></html>';
  res.type("html").send(html);
});

app.get("/", async (_req, res) => {
  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }

  const paypalReady = Boolean(PAYPAL_CLIENT_ID && paypalConfig.pro_plan_id && paypalConfig.business_plan_id);
  const modeLabel = PAYPAL_MODE === "live" ? "PayPal live billing" : "PayPal sandbox billing";
  const sdk = paypalReady
    ? '<script src="https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(PAYPAL_CLIENT_ID) + '&currency=GBP&components=buttons&vault=true&intent=subscription"></script>'
    : '';
  const buttons = paypalReady
    ? '<script>function kgApprove(data){const result=document.getElementById("kg-result");result.textContent="Activating subscription…";fetch("/paypal/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subscription_id:data.subscriptionID})}).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{if(!ok||!j.token)throw new Error(j.error||"Activation failed");result.innerHTML="<strong>Subscription active.</strong><br>Save this private activation token:<code id=\"kg-mcp\"></code><button id=\"kg-copy\">Copy activation token</button><p><a href=\"/install\">Open installation instructions</a></p>";document.getElementById("kg-mcp").textContent=j.token;document.getElementById("kg-copy").onclick=()=>navigator.clipboard.writeText(j.token);}).catch(e=>{result.textContent=e.message;});}paypal.Buttons({createSubscription:(data,actions)=>actions.subscription.create({plan_id:' + JSON.stringify(paypalConfig.pro_plan_id) + '}),onApprove:kgApprove}).render("#paypal-pro");paypal.Buttons({createSubscription:(data,actions)=>actions.subscription.create({plan_id:' + JSON.stringify(paypalConfig.business_plan_id) + '}),onApprove:kgApprove}).render("#paypal-business");</script>'
    : '';

  const setupMessage = paypalReady
    ? '<p class="good">Secure subscription checkout is ready.</p>'
    : '<div class="notice"><strong>Checkout is being activated.</strong><br>The KeepGoing service is online, but new paid subscriptions are temporarily unavailable.</div>';

  const proAction = paypalReady ? '<div id="paypal-pro"></div>' : '<span class="muted">Payment button appears after PayPal credentials are added.</span>';
  const bizAction = paypalReady ? '<div id="paypal-business"></div>' : '<span class="muted">Payment button appears after PayPal credentials are added.</span>';

  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:36px}.wrap{max-width:980px;margin:auto}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:24px}.price{font-size:34px;font-weight:700}.muted{color:#8b949e}.notice{background:#2d2405;border:1px solid #9e7b00;border-radius:12px;padding:14px;margin:18px 0}.good{color:#3fb950}code{display:block;word-break:break-all;background:#0d1117;padding:12px;border-radius:9px;margin:10px 0}button{padding:10px 14px;margin-top:8px}#kg-result{margin-top:20px}</style>' + sdk + '</head><body><div class="wrap"><h1>KeepGoing</h1><p>Persistent AI background jobs for substantial model work and research. KeepGoing preserves the same background job so ChatGPT can resume and check it instead of repeatedly restarting the work.</p>' + setupMessage + '<div class="plans"><div class="card"><h2>Free</h2><div class="price">£0</div><p>3 jobs/month</p><p class="muted">Free account rollout follows the paid beta.</p></div><div class="card"><h2>Pro</h2><div class="price">£7.99<span style="font-size:16px">/mo</span></div><p>100 jobs/month · up to 3 web tool calls per job</p>' + proAction + '</div><div class="card"><h2>Business</h2><div class="price">£29<span style="font-size:16px">/mo</span></div><p>500 jobs/month · up to 5 web tool calls per job</p>' + bizAction + '</div></div><div id="kg-result"></div><p class="muted" style="margin-top:26px"><a href="/install">Install</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a> · <a href="/security">Security</a></p></div>' + buttons + '</body></html>';
  res.type("html").send(html);
});


app.get("/icon.svg", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.type("image/svg+xml").send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#27f3df"/><stop offset="1" stop-color="#0798d8"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="#0d1117"/><path d="M196 82a91 91 0 1 0 20 66" fill="none" stroke="url(#g)" stroke-width="28" stroke-linecap="round"/><path d="M177 42l45 38-51 24z" fill="url(#g)"/><path d="M105 87l63 41-63 41z" fill="url(#g)"/></svg>');
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
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  });
});

function infoPage(title, body) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + htmlEscape(title) + ' — KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:28px;line-height:1.55}.wrap{max-width:780px;margin:auto}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:28px}a{color:#58a6ff}code{background:#0d1117;padding:2px 6px;border-radius:6px}.muted{color:#8b949e}h1,h2{line-height:1.2}</style></head><body><div class="wrap"><p><a href="/">← KeepGoing</a></p><div class="card"><h1>' + htmlEscape(title) + '</h1>' + body + '</div></div></body></html>';
}

app.get("/install", (_req, res) => {
  res.type("html").send(infoPage("Install KeepGoing", [
    "<p><strong>Connection endpoint:</strong> <code>" + htmlEscape(PUBLIC_BASE_URL + "/mcp") + "</code></p>",
    "<p>KeepGoing uses OAuth. When ChatGPT opens the KeepGoing connection page, enter the private activation token issued after subscription. Do not put the token in the MCP URL.</p>",
    "<h2>Private beta / developer connection</h2>",
    "<ol><li>In an eligible ChatGPT account, create or connect a custom MCP app.</li><li>Use the endpoint shown above.</li><li>Select OAuth when prompted.</li><li>Complete the KeepGoing connection page with your activation token.</li><li>Scan the tools and confirm <code>start_persistent_job</code>, <code>get_persistent_job</code>, <code>wait_for_persistent_job</code>, and <code>cancel_persistent_job</code>.</li></ol>",
    "<p class=\"muted\">ChatGPT plan, workspace and plugin/app availability can affect whether custom MCP connections are available. The public Plugin Directory release will use the same hosted service after approval.</p>",
    "<h2>What KeepGoing does</h2><p>It runs supported work as an OpenAI background response, stores the job ID and lets ChatGPT poll or resume that same job. It does not control ChatGPT's private reasoning, bypass product limits, or force a new chat turn after ChatGPT has already ended one.</p>"
  ].join("")));
});

app.get("/privacy", (_req, res) => {
  res.type("html").send(infoPage("Privacy policy", [
    "<p><strong>Last updated:</strong> 28 September 2026</p>",
    "<p>KeepGoing processes the minimum information needed to operate subscriptions and persistent jobs.</p>",
    "<h2>Information processed</h2>",
    "<ul><li>Subscriber email address where supplied by the payment provider, provider customer/subscription identifiers, plan and subscription status.</li><li>Monthly usage counters and plan limits.</li><li>KeepGoing activation tokens are stored by the billing backend only as SHA-256 hashes; short-lived OAuth access and refresh tokens are issued for ChatGPT connections.</li><li>The goal, definition of done and options submitted for a persistent job are sent to OpenAI's API to run that job.</li><li>Technical service logs needed for reliability, security and abuse prevention.</li></ul>",
    "<h2>Service providers</h2><p>Job requests are sent to OpenAI's API for execution. Payment providers process payment details; KeepGoing receives subscription/payment status and identifiers rather than full card details. Hosting and infrastructure providers may process technical request data as needed to operate the service.</p>",
    "<h2>Purpose</h2><p>We use this information to provide the service, enforce plan limits, process subscriptions, secure accounts, diagnose faults and prevent abuse.</p>",
    "<h2>Retention</h2><p>Active subscription and usage records are retained while the subscription is active. Revoked access-token hashes are retained for up to 24 months for support, fraud prevention and security. Inactive subscription/payment metadata is retained for up to six years for accounting, tax, billing reconciliation and dispute handling, or longer where law or an unresolved matter requires it. OAuth access tokens expire after one hour and refresh tokens after 30 days. Because KeepGoing uses stored OpenAI Responses so a background job can be retrieved later, OpenAI currently documents a 30-day application-state retention period for those Responses, subject to the OpenAI account's applicable data controls. Hosting providers may retain technical logs according to their own policies.</p>",
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
  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }
  res.json({
    free: { price_gbp: 0, jobs_per_month: 3 },
    pro: { price_gbp: 7.99, jobs_per_month: 100, paypal_plan_id: paypalConfig.pro_plan_id || null },
    business: { price_gbp: 29, jobs_per_month: 500, paypal_plan_id: paypalConfig.business_plan_id || null },
    payment_provider: "paypal",
    paypal_mode: PAYPAL_MODE,
    paypal_configured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
    paypal_ready: paypalSetupComplete,
    paypal_setup_error: paypalSetupError || null,
    stripe_sandbox_available: Boolean(PRO_PRICE_ID && BUSINESS_PRICE_ID),
    stripe_portal_url: PORTAL_URL || null
  });
});

app.get("/paypal/status", async (_req, res) => {
  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && !paypalSetupComplete) {
    try { await ensurePayPalSetup(); } catch {}
  }
  res.json({
    configured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
    ready: paypalSetupComplete,
    mode: PAYPAL_MODE,
    product_id: paypalConfig.product_id || null,
    pro_plan_id: paypalConfig.pro_plan_id || null,
    business_plan_id: paypalConfig.business_plan_id || null,
    webhook_id: paypalConfig.webhook_id || null,
    error: paypalSetupError || null
  });
});

app.get("/readiness", async (_req, res) => {
  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && !paypalSetupComplete) {
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
    PAYPAL_CLIENT_ID &&
    PAYPAL_CLIENT_SECRET &&
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
    durableStoreReady &&
    (V12_CANARY_ONLY || OPENAI_WEBHOOK_SECRET)
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
    oauth_ready: Boolean(OAUTH_SECRET && OAUTH_CODE_URL),
    sell_ready: engineReady && billingBackendReady && checkoutReady && durableOpsReady && Boolean(OAUTH_SECRET && OAUTH_CODE_URL),
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
    paypalConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
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

app.listen(PORT, "0.0.0.0", () => {
  console.log("KeepGoing MCP " + (V12_ENABLED ? "v" + APP_VERSION : "v1.1.0") + " listening on " + PORT);

  if (V12_ENABLED) {
    try {
      const runtime = getV12Runtime();
      const watchdogTimer = setInterval(() => {
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

  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) {
    ensurePayPalSetup()
      .then(() => console.log("PayPal " + PAYPAL_MODE + " subscriptions ready"))
      .catch((error) => console.error("PayPal bootstrap failed:", String(error?.message || error)));
  }
});
