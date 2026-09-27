import express from "express";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PRO_PRICE_ID = process.env.KEEPGOING_PRO_PRICE_ID || "price_1UJy24B86Ss16l9WEsqSRxh1";
const BUSINESS_PRICE_ID = process.env.KEEPGOING_BUSINESS_PRICE_ID || "price_1UJy26B86Ss16l9W8id4FSsw";
const BILLING_INGEST_URL = process.env.KEEPGOING_BILLING_INGEST_URL || "";
const BILLING_INGEST_TOKEN = process.env.KEEPGOING_BILLING_INGEST_TOKEN || "";
const CLAIM_URL = process.env.KEEPGOING_CLAIM_URL || "";
const AUTH_URL = process.env.KEEPGOING_AUTH_URL || "";
const BILLING_CONFIG_URL = process.env.KEEPGOING_CONFIG_URL || "";
const PORTAL_URL = process.env.KEEPGOING_PORTAL_URL || "";

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
  webhook_id: ""
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

app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 10000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TOKEN_HASH = "300caf15b670e9aa648ffc6aa9f7249297566ff6b0ba37898ee4f2da7bd91697";

function digest(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
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
    throw new Error(issue);
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
          home_url: "https://keepgoing-mcp.onrender.com"
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

    if (!paypalConfig.webhook_id) {
      const webhook = await paypalApi("/v1/notifications/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "https://keepgoing-mcp.onrender.com/paypal/webhook",
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

async function authorise(req, consume = false) {
  const token = requestToken(req);
  if (!token) return { ok: false, error: "token_required" };
  if (digest(token) === TOKEN_HASH) return { ok: true, admin: true, tier: "owner", remaining: null };
  if (!AUTH_URL) return { ok: false, error: "billing_auth_not_configured" };
  try {
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, consume })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.allowed) return { ok: false, status: response.status, ...data };
    return { ok: true, admin: false, ...data };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
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

async function startJob({ goal, definitionOfDone, mode, allowWeb }) {
  const body = {
    model: MODEL,
    input: jobPrompt(goal, definitionOfDone, mode),
    background: true,
    store: true
  };
  if (allowWeb) body.tools = [{ type: "web_search" }];
  const data = await openai("/responses", { method: "POST", body: JSON.stringify(body) });
  return {
    job_id: data.id,
    status: data.status,
    model: data.model || MODEL,
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

function createMcpServer() {
  const server = new McpServer(
    { name: "KeepGoing", version: "0.7.0" },
    { instructions: "Use KeepGoing for substantial model-only work or research that should continue as a background response instead of stopping at a normal chat-turn boundary. Start one job, preserve its job_id, then call wait_for_persistent_job. If should_continue_polling is true, call wait_for_persistent_job again with the same job_id without asking the user to type continue. Reuse the same job_id and never create duplicate jobs just to keep working. KeepGoing does not automatically control other ChatGPT plugins, desktops, payments, or private accounts." }
  );

  server.registerTool("start_persistent_job", {
    description: "Start a persistent OpenAI background job so substantial model work or research can continue without repeated continue prompts.",
    inputSchema: {
      goal: z.string().min(1).max(12000),
      definitionOfDone: z.string().min(1).max(4000).default("All requested work completed and verified"),
      mode: z.enum(["safe","balanced","max"]).default("balanced"),
      allowWeb: z.boolean().default(true)
    }
  }, async (args) => {
    try {
      const result = await startJob(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("get_persistent_job", {
    description: "Check the current state and output of an existing KeepGoing job. Keep polling the same job_id until it completes or needs the user.",
    inputSchema: { job_id: z.string().min(1).max(200) }
  }, async ({ job_id }) => {
    try {
      const result = await getJob(job_id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("wait_for_persistent_job", {
    description: "Wait and poll an existing KeepGoing job for up to 25 seconds. If should_continue_polling is true, call this tool again with the same job_id automatically instead of asking the user to type continue.",
    inputSchema: {
      job_id: z.string().min(1).max(200),
      wait_seconds: z.number().int().min(1).max(25).default(20)
    }
  }, async ({ job_id, wait_seconds }) => {
    try {
      const result = await waitForJob(job_id, wait_seconds);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  server.registerTool("cancel_persistent_job", {
    description: "Cancel a KeepGoing background job.",
    inputSchema: { job_id: z.string().min(1).max(200) }
  }, async ({ job_id }) => {
    try {
      const result = await cancelJob(job_id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error) }] };
    }
  });

  return server;
}

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
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KeepGoing subscription</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}.card{max-width:680px;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:18px;width:100%;box-sizing:border-box}button,a{color:#58a6ff}code{display:block;word-break:break-all;background:#0d1117;padding:14px;border-radius:10px;margin:14px 0}.ok{color:#3fb950}.muted{color:#8b949e}</style></head><body><div class="card"><h1>KeepGoing subscription</h1><p id="status">Confirming your Stripe subscription…</p><div id="result"></div><p><a href="/">Return to plans</a></p></div><script>const sessionId=' + sessionJson + ';(async()=>{const status=document.getElementById("status"),result=document.getElementById("result");if(!sessionId){status.textContent="Missing checkout session.";return;}for(let i=0;i<12;i++){const r=await fetch("/billing/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({session_id:sessionId})});const j=await r.json().catch(()=>({}));if(r.ok&&j.token){const mcp=location.origin+"/mcp?token="+encodeURIComponent(j.token);status.innerHTML="<span class=\"ok\">Subscription active.</span>";result.innerHTML="<p>Your "+j.tier+" plan includes "+j.monthly_limit+" KeepGoing jobs per month.</p><p>Copy this private MCP address into ChatGPT:</p><code id=\"mcp\"></code><button id=\"copy\">Copy MCP address</button><p class=\"muted\">Keep this address private. Claiming again rotates the token.</p>";document.getElementById("mcp").textContent=mcp;document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(mcp);return;}if(j.error!=="subscription_not_found"){status.textContent=j.error||"Could not activate subscription.";return;}await new Promise(r=>setTimeout(r,1500));}status.textContent="Payment completed, but activation is still processing. Refresh this page in a moment.";})().catch(()=>{document.getElementById("status").textContent="Could not confirm subscription.";});</script></body></html>';
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
    ? '<script>function kgApprove(data){const result=document.getElementById("kg-result");result.textContent="Activating subscription…";fetch("/paypal/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subscription_id:data.subscriptionID})}).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{if(!ok||!j.token)throw new Error(j.error||"Activation failed");const mcp=location.origin+"/mcp?token="+encodeURIComponent(j.token);result.innerHTML="<strong>Subscription active.</strong><br>Your private MCP address:<code id=\"kg-mcp\"></code><button id=\"kg-copy\">Copy MCP address</button>";document.getElementById("kg-mcp").textContent=mcp;document.getElementById("kg-copy").onclick=()=>navigator.clipboard.writeText(mcp);}).catch(e=>{result.textContent=e.message;});}paypal.Buttons({createSubscription:(data,actions)=>actions.subscription.create({plan_id:' + JSON.stringify(paypalConfig.pro_plan_id) + '}),onApprove:kgApprove}).render("#paypal-pro");paypal.Buttons({createSubscription:(data,actions)=>actions.subscription.create({plan_id:' + JSON.stringify(paypalConfig.business_plan_id) + '}),onApprove:kgApprove}).render("#paypal-business");</script>'
    : '';

  const setupMessage = paypalReady
    ? '<p class="good">' + modeLabel + ' is configured.</p>'
    : '<div class="notice"><strong>PayPal setup pending.</strong><br>Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to Render Environment. KeepGoing will then create the PayPal product, both monthly plans and the webhook automatically.</div>';

  const proAction = paypalReady ? '<div id="paypal-pro"></div>' : '<span class="muted">Payment button appears after PayPal credentials are added.</span>';
  const bizAction = paypalReady ? '<div id="paypal-business"></div>' : '<span class="muted">Payment button appears after PayPal credentials are added.</span>';

  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KeepGoing</title><style>body{font-family:system-ui;background:#0d1117;color:#fff;margin:0;padding:36px}.wrap{max-width:980px;margin:auto}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.card{background:#161b22;border:1px solid #30363d;border-radius:18px;padding:24px}.price{font-size:34px;font-weight:700}.muted{color:#8b949e}.notice{background:#2d2405;border:1px solid #9e7b00;border-radius:12px;padding:14px;margin:18px 0}.good{color:#3fb950}code{display:block;word-break:break-all;background:#0d1117;padding:12px;border-radius:9px;margin:10px 0}button{padding:10px 14px;margin-top:8px}#kg-result{margin-top:20px}</style>' + sdk + '</head><body><div class="wrap"><h1>KeepGoing</h1><p>Persistent AI background jobs. Start the job once and KeepGoing keeps checking it without repeated “continue” prompts.</p>' + setupMessage + '<div class="plans"><div class="card"><h2>Free</h2><div class="price">£0</div><p>3 jobs/month</p><p class="muted">Free account rollout follows the paid beta.</p></div><div class="card"><h2>Pro</h2><div class="price">£7.99<span style="font-size:16px">/mo</span></div><p>100 jobs/month</p>' + proAction + '</div><div class="card"><h2>Business</h2><div class="price">£29<span style="font-size:16px">/mo</span></div><p>500 jobs/month</p>' + bizAction + '</div></div><div id="kg-result"></div></div>' + buttons + '</body></html>';
  res.type("html").send(html);
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "KeepGoing MCP",
    version: "0.7.0",
    openaiConfigured: Boolean(OPENAI_API_KEY),
    protected: true,
    model: MODEL,
    paypalConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
    paypalReady: paypalSetupComplete,
    paypalMode: PAYPAL_MODE
  });
});

app.post("/mcp", async (req, res) => {
  const isStart = req.body?.method === "tools/call" && req.body?.params?.name === "start_persistent_job";
  const access = await authorise(req, isStart);
  if (!access.ok) return res.status(access.status || 401).json({ error: access.error || "unauthorized", tier: access.tier, used: access.used, limit: access.limit });
  const server = createMcpServer();
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
  if (!access.ok) return res.status(access.status || 401).json({ error: access.error || "unauthorized" });
  res.status(405).json({ error: "Use POST for stateless MCP" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("KeepGoing MCP v0.7.0 listening on " + PORT);
  if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) {
    ensurePayPalSetup()
      .then(() => console.log("PayPal " + PAYPAL_MODE + " subscriptions ready"))
      .catch((error) => console.error("PayPal bootstrap failed:", String(error?.message || error)));
  }
});
