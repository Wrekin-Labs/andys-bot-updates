const http = require('http');
const os = require('os');
const { URL } = require('url');
const { WrekinWordPressManager } = require('./wordpress/manager');
const { WordPressRegistry } = require('./wordpress/registry');
const { versionPlan, verifyVersion } = require('./wordpress/operations');
const { publicSiteDiagnostic, probePath } = require('./wordpress/diagnostics');
const { planHostAction } = require('./wordpress/host-plan');
const { assertSafeWordPressUrl } = require('./wordpress/url-safety');

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.WREKIN_VERSION || '0.3.0';
const STARTED_AT = new Date().toISOString();

const modules = [
  { name: 'Wrekin Forge', key: 'forge', purpose: 'Source control, branches, reviews and CI', status: 'planned', foundation: 'Forgejo / Git' },
  { name: 'Wrekin Base', key: 'base', purpose: 'PostgreSQL, auth, storage, realtime and APIs', status: 'bootstrap', foundation: 'PostgreSQL / Supabase-compatible services' },
  { name: 'Wrekin Deploy', key: 'deploy', purpose: 'Builds, previews, releases, domains and TLS', status: 'running', foundation: 'Render bootstrap; Wrekin deploy control plane online' },
  { name: 'Wrekin Runtime', key: 'runtime', purpose: 'Web services, workers, cron and containers', status: 'running', foundation: 'Bootstrap node: wrekin-runtime.onrender.com' },
  { name: 'Wrekin Agents', key: 'agents', purpose: 'AI agents, triggers, tools, approvals and runs', status: 'planned', foundation: 'Wrekin orchestration' },
  { name: 'Wrekin Relay', key: 'relay', purpose: 'Authorised workstation and local software bridge', status: 'running', foundation: 'Project Relay' },
  { name: 'Wrekin Monitor', key: 'monitor', purpose: 'Health, logs, uptime, metrics and incidents', status: 'running', foundation: 'Health checks: wrekin-monitor.onrender.com' },
  { name: 'Wrekin Secrets', key: 'secrets', purpose: 'Scoped secrets, rotation and audit', status: 'bootstrap', foundation: 'Secret references + protected environment values' },
  { name: 'Wrekin Billing', key: 'billing', purpose: 'Plans, subscriptions, usage and payments', status: 'planned', foundation: 'Provider adapters' },
  { name: 'Wrekin WordPress', key: 'wordpress', purpose: 'WordPress inspection, safe updates, content edits, checks and rollback', status: 'running', foundation: 'Wrekin WordPress Manager' }
];

const registry = new WordPressRegistry();
const wordpressManager = new WrekinWordPressManager({
  auditSink: async event => {
    if (!registry.configured()) return;
    try {
      await registry.audit({
        action: event.type || 'wordpress.event',
        risk: event.risk || 'read',
        status: event.status || 'ok',
        checkpointId: event.checkpointId || null,
        details: event
      });
    } catch (error) {
      console.warn('wordpress audit sink failed:', error.message);
    }
  }
});

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length > 100000) throw new Error('body_too_large');
  return JSON.parse(raw);
}

function statusClass(status) {
  if (status === 'running') return 'ok';
  if (status === 'building' || status === 'bootstrap') return 'warn';
  return 'muted';
}

function page() {
  const cards = modules.map(m => `
    <article class="card">
      <div class="row">
        <div>
          <div class="eyebrow">${m.key.toUpperCase()}</div>
          <h3>${m.name}</h3>
        </div>
        <span class="pill ${statusClass(m.status)}">${m.status}</span>
      </div>
      <p>${m.purpose}</p>
      <div class="foundation">${m.foundation}</div>
    </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1020">
<title>Wrekin Cloud</title>
<style>
:root{--bg:#07111f;--panel:#0d1a2c;--line:#1f3350;--text:#edf4ff;--muted:#9fb0c7;--accent:#67e8f9;--green:#5ee39a;--amber:#f7c66b}
*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(180deg,#07111f 0,#0a1424 100%);color:var(--text)}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 56px}.hero{padding:34px 0 22px;border-bottom:1px solid var(--line);margin-bottom:28px}
.brand{display:flex;align-items:center;gap:14px}.mark{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#67e8f9,#7c8cff);box-shadow:0 0 42px rgba(103,232,249,.2)}
h1{font-size:clamp(36px,7vw,72px);line-height:.95;margin:18px 0 10px;letter-spacing:-.04em}.tag{font-size:clamp(18px,3vw,28px);color:#b9c7dc;margin:0 0 16px}.lead{max-width:760px;color:var(--muted);font-size:17px;line-height:1.7}
.meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.pill.ok{border-color:rgba(94,227,154,.4);color:var(--green);background:rgba(94,227,154,.07)}.pill.warn{border-color:rgba(247,198,107,.4);color:var(--amber);background:rgba(247,198,107,.07)}.pill.muted{color:#8da0b8}
h2{font-size:24px;margin:30px 0 14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{background:rgba(13,26,44,.9);border:1px solid var(--line);border-radius:18px;padding:18px;min-height:185px;box-shadow:0 10px 30px rgba(0,0,0,.12)}
.row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--accent);font-weight:700}.card h3{margin:6px 0 0;font-size:20px}.card p{color:var(--muted);line-height:1.55;margin:16px 0}.foundation{font-size:12px;color:#8ea0b8;border-top:1px solid var(--line);padding-top:12px}
.flow{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;align-items:center;margin:18px 0}.step{padding:12px 8px;border:1px solid var(--line);background:var(--panel);border-radius:12px;text-align:center;font-size:12px;color:#c9d5e7}.arrow{text-align:center;color:#56708f}
.footer{margin-top:34px;padding-top:22px;border-top:1px solid var(--line);color:#7f93ad;font-size:13px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
a{color:var(--accent)}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.flow{grid-template-columns:1fr 1fr}.arrow{display:none}}
@media(max-width:560px){.grid{grid-template-columns:1fr}.hero{padding-top:18px}.wrap{padding-left:16px;padding-right:16px}.flow{grid-template-columns:1fr}}
</style>
</head>
<body>
<main class="wrap">
<section class="hero">
  <div class="brand"><div class="mark"></div><strong>WREKIN LABS</strong></div>
  <h1>Wrekin Cloud</h1>
  <p class="tag">Build. Deploy. Automate.</p>
  <p class="lead">A unified control plane for source code, backend services, deployment, runtime infrastructure, AI agents, WordPress management, monitoring, remote execution and commercial operations.</p>
  <div class="meta">
    <span class="pill ok">control plane online</span>
    <span class="pill">v${VERSION}</span>
    <span class="pill ${registry.configured() ? 'ok' : 'warn'}">WP registry ${registry.configured() ? 'online' : 'unconfigured'}</span>
  </div>
</section>

<section>
  <h2>One project, one operating surface</h2>
  <div class="flow">
    <div class="step">Code</div><div class="arrow">&rarr;</div>
    <div class="step">Database</div><div class="arrow">&rarr;</div>
    <div class="step">Build</div><div class="arrow">&rarr;</div>
    <div class="step">Deploy</div>
  </div>
  <div class="grid">${cards}</div>
</section>

<footer class="footer">
  <span>Wrekin Labs &bull; Wrekin Cloud</span>
  <span><a href="/health">Health</a> &middot; <a href="/api/status">Status API</a> &middot; <a href="/api/wordpress/capabilities">WordPress API</a></span>
</footer>
</main>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/wordpress/capabilities') {
    return json(res, 200, {
      service: 'wrekin-wordpress-manager',
      version: '0.3.0',
      registry: { configured: registry.configured(), mode: registry.mode() },
      capabilities: wordpressManager.capabilities()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/wordpress/registry/status') {
    return json(res, 200, { configured: registry.configured(), mode: registry.mode() });
  }

  if (req.method === 'GET' && url.pathname === '/api/wordpress/sites') {
    if (!registry.configured()) return json(res, 503, { error: 'registry_not_configured' });
    try {
      return json(res, 200, await registry.listSites());
    } catch (error) {
      return json(res, 502, { error: error.message || 'registry_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/sites') {
    if (!registry.configured()) return json(res, 503, { error: 'registry_not_configured' });
    try {
      const body = await readJson(req);
      const baseUrl = assertSafeWordPressUrl(body.baseUrl);
      const result = await registry.addSite({
        name: String(body.name || '').trim(),
        baseUrl,
        credentialRef: body.credentialRef || null,
        relayDevice: body.relayDevice || null,
        metadata: body.metadata || {}
      });
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error.message || 'site_registration_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/inspect') {
    try {
      const body = await readJson(req);
      const result = await wordpressManager.inspectSite({ baseUrl: body.site });
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error.message || 'inspection_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/check') {
    try {
      const body = await readJson(req);
      const diagnostic = await publicSiteDiagnostic(body.site);
      const paths = Array.isArray(body.paths) ? body.paths.slice(0, 20) : [];
      const probes = [];
      for (const path of paths) probes.push(await probePath(body.site, path));
      return json(res, 200, { diagnostic, probes });
    } catch (error) {
      return json(res, 400, { error: error.message || 'diagnostic_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/plan') {
    try {
      const body = await readJson(req);
      return json(res, 200, wordpressManager.plan(body.action, body.payload || {}));
    } catch (error) {
      return json(res, 400, { error: error.message || 'invalid_request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/update/plan') {
    try {
      const body = await readJson(req);
      return json(res, 200, versionPlan(body.kind, body.slug, body.fromVersion, body.toVersion));
    } catch (error) {
      return json(res, 400, { error: error.message || 'update_plan_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/update/verify') {
    try {
      const body = await readJson(req);
      return json(res, 200, verifyVersion(body.plan, body.actualVersion));
    } catch (error) {
      return json(res, 400, { error: error.message || 'verification_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/host/plan') {
    try {
      const body = await readJson(req);
      return json(res, 200, planHostAction(body.action, body.args || {}));
    } catch (error) {
      return json(res, 400, { error: error.message || 'host_plan_failed' });
    }
  }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'wrekin-cloud-control-plane',
      version: VERSION,
      started_at: STARTED_AT,
      uptime_seconds: Math.floor(process.uptime()),
      hostname: os.hostname()
    });
  }

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      service: 'wrekin-cloud-control-plane',
      version: VERSION,
      generated_at: new Date().toISOString(),
      modules,
      wordpress: {
        registryConfigured: registry.configured(),
        registryMode: registry.mode()
      }
    });
  }

  if (url.pathname === '/') {
    return html(res, page());
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wrekin Cloud control plane v${VERSION} listening on ${PORT}`);
});
