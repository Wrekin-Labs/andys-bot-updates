const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3300);
const VERSION = process.env.WREKIN_APP_STUDIO_VERSION || '0.1.0';
const STARTED_AT = new Date().toISOString();

const MODULE_CATALOG = {
  bookings: { label: 'Bookings', description: 'Availability, slots and confirmations' },
  payments: { label: 'Payments', description: 'Checkout and payment status integration' },
  notifications: { label: 'Notifications', description: 'Booking, job and account alerts' },
  ai_assistant: { label: 'AI Assistant', description: 'Business-aware support and guidance' },
  analytics: { label: 'Analytics', description: 'Usage, conversion and operational reporting' },
  repair_jobs: { label: 'Repair Jobs', description: 'Repair intake, status, notes and tracking' },
  customer_accounts: { label: 'Customer Accounts', description: 'Customer sign-in and history' },
  content: { label: 'Content', description: 'Business pages, FAQs and service information' }
};

const APPS = [
  {
    slug: 'smashroom',
    name: 'The Smashroom',
    domain: 'www.thesmashroom.co.uk',
    startUrl: '/',
    display: 'standalone',
    theme: { primary: '#111111', accent: '#d71920', background: '#0b0b0b' },
    modules: ['bookings', 'payments', 'notifications', 'customer_accounts', 'content', 'ai_assistant', 'analytics'],
    status: 'demo-ready',
    notes: 'Demo #1 for the commercial multi-tenant app platform.'
  },
  {
    slug: 'electronic-repairs-uk',
    name: 'Electronic Repairs UK',
    domain: 'www.electronicrepairsuk.com',
    startUrl: '/',
    display: 'standalone',
    theme: { primary: '#0b1f33', accent: '#1f78d1', background: '#f5f7fa' },
    modules: ['repair_jobs', 'payments', 'notifications', 'customer_accounts', 'content', 'ai_assistant', 'analytics'],
    status: 'demo-ready',
    notes: 'Demo #2 for the commercial multi-tenant app platform.'
  }
];

function secureHeaders(type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  };
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...secureHeaders('application/json; charset=utf-8'), ...extraHeaders });
  res.end(JSON.stringify(body, null, 2));
}

function html(res, body) {
  res.writeHead(200, {
    ...secureHeaders('text/html; charset=utf-8'),
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100000) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

function validateHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function validateApp(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['app_required'];
  if (!input.slug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug)) errors.push('invalid_slug');
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) errors.push('invalid_name');
  if (!input.domain || typeof input.domain !== 'string' || !/^[a-z0-9.-]+$/i.test(input.domain)) errors.push('invalid_domain');
  if (!input.startUrl || typeof input.startUrl !== 'string' || !input.startUrl.startsWith('/')) errors.push('invalid_start_url');
  if (!input.theme || !validateHex(input.theme.primary) || !validateHex(input.theme.accent) || !validateHex(input.theme.background)) errors.push('invalid_theme');
  if (!Array.isArray(input.modules) || input.modules.some(key => !MODULE_CATALOG[key])) errors.push('invalid_modules');
  return errors;
}

function normaliseApp(input) {
  const errors = validateApp(input);
  if (errors.length) {
    const error = new Error('invalid_app');
    error.details = errors;
    throw error;
  }
  return {
    slug: input.slug,
    name: input.name.trim(),
    domain: input.domain.toLowerCase(),
    startUrl: input.startUrl,
    display: input.display === 'fullscreen' ? 'fullscreen' : 'standalone',
    theme: { ...input.theme },
    modules: [...new Set(input.modules)],
    status: input.status || 'preview',
    notes: input.notes || ''
  };
}

function findApp(slug) {
  return APPS.find(app => app.slug === slug) || null;
}

function publicApp(app) {
  return {
    slug: app.slug,
    name: app.name,
    domain: app.domain,
    url: `https://${app.domain}`,
    status: app.status,
    theme: app.theme,
    modules: app.modules.map(key => ({ key, ...MODULE_CATALOG[key] }))
  };
}

function buildManifest(app) {
  const safe = normaliseApp(app);
  return {
    id: `/${safe.slug}`,
    name: safe.name,
    short_name: safe.name.length <= 18 ? safe.name : safe.name.slice(0, 18),
    start_url: safe.startUrl,
    scope: '/',
    display: safe.display,
    background_color: safe.theme.background,
    theme_color: safe.theme.primary,
    description: `${safe.name} app`,
    icons: [
      { src: '/app-icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/app-icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
}

function buildInstallConfig(app) {
  const safe = normaliseApp(app);
  return {
    app: publicApp(safe),
    integration: {
      mode: 'website-embed',
      manifest_path: `/.well-known/wrekin-app/${safe.slug}/manifest.webmanifest`,
      bootstrap_script: `https://app-studio.wrekin.invalid/embed/${safe.slug}.js`,
      service_worker_scope: '/',
      requires_owner_action: ['publish generated manifest/icons', 'connect production domain', 'configure live providers']
    },
    modules: safe.modules.map(key => ({
      key,
      enabled: true,
      state: ['content', 'analytics'].includes(key) ? 'ready-for-integration' : 'connector-required'
    }))
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function page() {
  const cards = APPS.map(app => {
    const modules = app.modules.map(key => `<span class="chip">${escapeHtml(MODULE_CATALOG[key].label)}</span>`).join('');
    return `<article class="card">
      <div class="row"><div><div class="eyebrow">TENANT</div><h2>${escapeHtml(app.name)}</h2></div><span class="status">${escapeHtml(app.status)}</span></div>
      <p class="domain">${escapeHtml(app.domain)}</p>
      <div class="chips">${modules}</div>
      <div class="actions">
        <a href="/preview/${encodeURIComponent(app.slug)}">Phone preview</a>
        <a href="/api/apps/${encodeURIComponent(app.slug)}">Config</a>
        <a href="/api/apps/${encodeURIComponent(app.slug)}/manifest.webmanifest">Manifest</a>
        <a href="/api/apps/${encodeURIComponent(app.slug)}/install-config">Install config</a>
      </div>
    </article>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#07111f"><title>Wrekin App Studio</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--line:#203650;--text:#eef5ff;--muted:#9cb0c8;--accent:#67e8f9;--green:#5ee39a}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07111f,#0a1424);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1100px;margin:auto;padding:30px 18px 60px}.brand{display:flex;gap:12px;align-items:center;font-weight:800;letter-spacing:.08em}.mark{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#67e8f9,#7c8cff)}
h1{font-size:clamp(38px,7vw,68px);margin:28px 0 8px;letter-spacing:-.05em}.lead{color:var(--muted);line-height:1.65;max-width:780px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:28px}.card{background:rgba(13,27,45,.92);border:1px solid var(--line);border-radius:18px;padding:20px}
.row{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.eyebrow{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.15em}.card h2{margin:7px 0 0}.status{font-size:12px;color:var(--green);border:1px solid rgba(94,227,154,.35);border-radius:999px;padding:6px 9px}
.domain{color:var(--muted)}.chips{display:flex;gap:7px;flex-wrap:wrap;margin:18px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:6px 9px;color:#c8d5e7;font-size:12px}
.actions{display:flex;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px}.actions a{color:var(--accent);text-decoration:none;font-size:13px}
.note{margin-top:28px;padding:16px;border:1px solid var(--line);border-radius:14px;color:var(--muted);line-height:1.6}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
</style></head><body><main class="wrap">
<div class="brand"><div class="mark"></div><span>WREKIN LABS</span></div>
<h1>App Studio</h1>
<p class="lead">Multi-tenant app configuration and PWA generation for branded customer apps. The first two demo tenants are connected here as safe read-only configurations.</p>
<div class="grid">${cards}</div>
<div class="note">v${VERSION} · No production credentials or live payment actions are stored here. Provider connections are added later per tenant.</div>
</main></body></html>`;
}

function phonePreviewPage(app) {
  const safe = normaliseApp(app);
  const labels = {
    bookings: 'Book a room',
    repair_jobs: 'Track a repair',
    customer_accounts: 'My account',
    ai_assistant: 'Ask AI',
    payments: 'Payments',
    notifications: 'Alerts',
    content: 'Services',
    analytics: 'Insights'
  };
  const tiles = safe.modules
    .filter(key => key !== 'analytics')
    .slice(0, 6)
    .map(key => `<div class="tile"><div class="tileIcon">${escapeHtml(MODULE_CATALOG[key].label.slice(0,1))}</div><strong>${escapeHtml(labels[key] || MODULE_CATALOG[key].label)}</strong><span>${escapeHtml(MODULE_CATALOG[key].description)}</span></div>`)
    .join('');
  const primaryAction = safe.modules.includes('bookings')
    ? 'Book rehearsal'
    : safe.modules.includes('repair_jobs')
      ? 'Start a repair'
      : 'Get started';

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${safe.theme.primary}"><title>${escapeHtml(safe.name)} app preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e9edf3;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#111}.stage{min-height:100vh;display:grid;place-items:center;padding:22px}
.phone{width:min(390px,100%);min-height:780px;background:${safe.theme.background};border-radius:34px;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.28);border:8px solid #111;position:relative}
.top{padding:16px 20px 10px;background:${safe.theme.primary};color:#fff}.statusline{display:flex;justify-content:space-between;font-size:11px;opacity:.85}.brand{display:flex;justify-content:space-between;align-items:center;margin-top:20px}.brand strong{font-size:20px}.avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.16)}
.hero{padding:24px 20px 26px;background:${safe.theme.primary};color:#fff}.hero p{margin:0 0 8px;opacity:.78;font-size:13px}.hero h1{margin:0;font-size:32px;letter-spacing:-.04em;line-height:1.05}.hero button{margin-top:20px;width:100%;border:0;border-radius:14px;padding:15px 16px;background:${safe.theme.accent};color:#fff;font-weight:800;font-size:15px}
.body{padding:20px;background:#f7f8fa;min-height:500px}.sectionTitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.sectionTitle strong{font-size:17px}.sectionTitle span{font-size:12px;color:#687386}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tile{background:#fff;border:1px solid #e4e8ee;border-radius:16px;padding:15px;min-height:142px;display:flex;flex-direction:column;gap:7px}.tileIcon{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:${safe.theme.primary};color:#fff;font-weight:800}.tile strong{font-size:14px}.tile span{font-size:11px;line-height:1.45;color:#687386}
.notice{margin-top:14px;border-radius:16px;padding:14px;background:#fff;border:1px solid #e4e8ee}.notice b{font-size:13px}.notice p{font-size:11px;color:#687386;line-height:1.5;margin:5px 0 0}
.nav{position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e4e8ee;display:grid;grid-template-columns:repeat(4,1fr);padding:10px 6px 14px;font-size:10px;text-align:center;color:#596579}.nav .active{color:${safe.theme.accent};font-weight:800}
.back{position:fixed;top:16px;left:16px;background:#111;color:#fff;padding:9px 12px;border-radius:999px;text-decoration:none;font-size:12px}
@media(max-width:520px){.stage{padding:0}.phone{width:100%;min-height:100vh;border:0;border-radius:0}.back{display:none}}
</style></head><body><a class="back" href="/">← App Studio</a><main class="stage"><section class="phone">
<div class="top"><div class="statusline"><span>9:41</span><span>5G · 100%</span></div><div class="brand"><strong>${escapeHtml(safe.name)}</strong><div class="avatar">A</div></div></div>
<div class="hero"><p>Welcome back</p><h1>Everything you need,<br>in one place.</h1><button>${escapeHtml(primaryAction)}</button></div>
<div class="body"><div class="sectionTitle"><strong>Quick access</strong><span>Preview</span></div><div class="grid">${tiles}</div>
<div class="notice"><b>AI help is built in</b><p>The assistant will use the business knowledge base and enabled modules once production connectors are linked.</p></div></div>
<nav class="nav"><div class="active">Home</div><div>Activity</div><div>Messages</div><div>Account</div></nav>
</section></main></body></html>`;
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const previewMatch = url.pathname.match(/^\/preview\/([a-z0-9-]+)$/);
    if (req.method === 'GET' && previewMatch) {
      const app = findApp(previewMatch[1]);
      if (!app) return json(res, 404, { error: 'app_not_found' });
      return html(res, phonePreviewPage(app));
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'wrekin-app-studio',
        version: VERSION,
        started_at: STARTED_AT,
        tenant_count: APPS.length,
        uptime_seconds: Math.floor(process.uptime())
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/apps') {
      return json(res, 200, { service: 'wrekin-app-studio', version: VERSION, apps: APPS.map(publicApp) });
    }

    if (req.method === 'POST' && url.pathname === '/api/preview') {
      try {
        const body = await readJson(req);
        const app = normaliseApp(body);
        return json(res, 200, { app: publicApp(app), manifest: buildManifest(app), install: buildInstallConfig(app) });
      } catch (error) {
        return json(res, 400, { error: error.message || 'invalid_request', details: error.details || [] });
      }
    }

    const match = url.pathname.match(/^\/api\/apps\/([a-z0-9-]+)(\/manifest\.webmanifest|\/install-config)?$/);
    if (req.method === 'GET' && match) {
      const app = findApp(match[1]);
      if (!app) return json(res, 404, { error: 'app_not_found' });
      if (match[2] === '/manifest.webmanifest') {
        return json(res, 200, buildManifest(app), { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      }
      if (match[2] === '/install-config') return json(res, 200, buildInstallConfig(app));
      return json(res, 200, publicApp(app));
    }

    if (req.method === 'GET' && url.pathname === '/') return html(res, page());
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    return json(res, 404, { error: 'not_found' });
  });
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`Wrekin App Studio v${VERSION} listening on ${PORT}`);
  });
}

module.exports = {
  VERSION,
  MODULE_CATALOG,
  APPS,
  validateApp,
  normaliseApp,
  buildManifest,
  buildInstallConfig,
  publicApp,
  createServer
};
