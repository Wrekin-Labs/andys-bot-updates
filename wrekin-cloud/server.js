const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const { WrekinWordPressManager } = require('./wordpress/manager');
const { WordPressRegistry } = require('./wordpress/registry');
const { WordPressSecretStore } = require('./wordpress/secret-store');
const { WrekinConnectorClient } = require('./wordpress/connector-client');
const { versionPlan, verifyVersion } = require('./wordpress/operations');
const { publicSiteDiagnostic, probePath } = require('./wordpress/diagnostics');
const { simplePerformanceAudit, pageSpeedAudit } = require('./wordpress/performance');
const { backupPlan, restoreGuard } = require('./wordpress/backups');
const { planHostAction } = require('./wordpress/host-plan');
const { assertSafeWordPressUrl } = require('./wordpress/url-safety');

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.WREKIN_VERSION || '0.5.0';
const STARTED_AT = new Date().toISOString();
const CONTROL_TOKEN = process.env.WREKIN_CONTROL_TOKEN || '';

const modules = [
  { name: 'Wrekin Forge', key: 'forge', purpose: 'Source control, branches, reviews and CI', status: 'planned', foundation: 'Forgejo / Git' },
  { name: 'Wrekin Base', key: 'base', purpose: 'PostgreSQL, auth, storage, realtime and APIs', status: 'bootstrap', foundation: 'PostgreSQL / Supabase-compatible services' },
  { name: 'Wrekin Deploy', key: 'deploy', purpose: 'Builds, previews, releases, domains and TLS', status: 'running', foundation: 'Render bootstrap; Wrekin deploy control plane online' },
  { name: 'Wrekin Runtime', key: 'runtime', purpose: 'Web services, workers, cron and containers', status: 'running', foundation: 'Bootstrap node: wrekin-runtime.onrender.com' },
  { name: 'Wrekin App Studio', key: 'app-studio', purpose: 'Multi-tenant branded apps, PWA generation and module configuration', status: 'building', foundation: 'App Studio v0.1 with Smashroom and ERUK demo tenants' },
  { name: 'Wrekin Agents', key: 'agents', purpose: 'AI agents, triggers, tools, approvals and runs', status: 'planned', foundation: 'Wrekin orchestration' },
  { name: 'Wrekin Relay', key: 'relay', purpose: 'Authorised workstation and local software bridge', status: 'running', foundation: 'Project Relay' },
  { name: 'Wrekin Monitor', key: 'monitor', purpose: 'Health, logs, uptime, metrics and incidents', status: 'running', foundation: 'Health checks: wrekin-monitor.onrender.com' },
  { name: 'Wrekin Secrets', key: 'secrets', purpose: 'Scoped secrets, rotation and audit', status: 'running', foundation: 'Supabase Vault + secret references' },
  { name: 'Wrekin Billing', key: 'billing', purpose: 'Plans, subscriptions, usage and payments', status: 'planned', foundation: 'Provider adapters' },
  { name: 'Wrekin WordPress', key: 'wordpress', purpose: 'WordPress inspection, safe updates, content edits, checks and rollback', status: 'running', foundation: 'Wrekin WordPress Manager + site connector' }
];

const registry = new WordPressRegistry();
const secretStore = new WordPressSecretStore();

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

function controlAuthorized(req) {
  if (!CONTROL_TOKEN) return false;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7));
  const expected = Buffer.from(CONTROL_TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function requireControl(req, res) {
  if (controlAuthorized(req)) return true;
  json(res, CONTROL_TOKEN ? 401 : 503, { error: CONTROL_TOKEN ? 'unauthorized' : 'control_auth_not_configured' });
  return false;
}

function statusClass(status) {
  if (status === 'running') return 'ok';
  if (status === 'building' || status === 'bootstrap') return 'warn';
  return 'muted';
}

async function page() {
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

  let wpSiteCards = '<article class="card"><div class="eyebrow">WORDPRESS</div><h3>No registered sites</h3><p>Pair WordPress sites to manage them from Wrekin Cloud.</p></article>';
  if (registry.configured()) {
    try {
      const registered = await registry.listSites();
      const sites = Array.isArray(registered && registered.sites) ? registered.sites : [];
      if (sites.length) {
        wpSiteCards = sites.map(site => {
          const paired = Boolean(site.credential_ref);
          const installed = Boolean(site.metadata && site.metadata.connector_installed);
          const label = paired ? 'paired' : (installed ? 'connector installed' : 'monitor-only');
          const cls = paired ? 'ok' : 'warn';
          return `
            <article class="card">
              <div class="row">
                <div>
                  <div class="eyebrow">WORDPRESS SITE</div>
                  <h3>${site.name}</h3>
                </div>
                <span class="pill ${cls}">${label}</span>
              </div>
              <p>${site.base_url}</p>
              <div class="foundation">Relay: ${site.relay_device || 'not assigned'} &middot; Status: ${site.status || 'unknown'}</div>
            </article>`;
        }).join('');
      }
    } catch (error) {
      wpSiteCards = '<article class="card"><div class="eyebrow">WORDPRESS</div><h3>Registry unavailable</h3><p>Wrekin Cloud could not load the WordPress registry.</p></article>';
    }
  }

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
    <span class="pill ${secretStore.configured() ? 'ok' : 'warn'}">WP secrets ${secretStore.configured() ? 'online' : 'unconfigured'}</span>
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

<section>
  <h2>WordPress fleet</h2>
  <p class="lead">Registered WordPress sites. Monitor-only sites are checked publicly; paired sites can use the signed Wrekin Connector for maintenance operations.</p>
  <div class="grid">${wpSiteCards}</div>
</section>

<footer class="footer">
  <span>Wrekin Labs &bull; Wrekin Cloud</span>
  <span><a href="/health">Health</a> &middot; <a href="/api/status">Status API</a> &middot; <a href="/api/wordpress/capabilities">WordPress API</a></span>
</footer>
</main>
</body>
</html>`;
}

async function connectorFromBody(body) {
  const baseUrl = assertSafeWordPressUrl(body.baseUrl);
  const credentialRef = String(body.credentialRef || '');
  if (!credentialRef.startsWith('wrekin/wp/')) throw new Error('credential_ref_required');
  const secret = await secretStore.get(credentialRef);
  return new WrekinConnectorClient({ baseUrl, secret });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/wordpress/capabilities') {
    return json(res, 200, {
      service: 'wrekin-wordpress-manager',
      version: '0.5.0',
      controlAuthConfigured: Boolean(CONTROL_TOKEN),
      registry: { configured: registry.configured(), mode: registry.mode() },
      secrets: { configured: secretStore.configured() },
      capabilities: wordpressManager.capabilities()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/wordpress/registry/status') {
    return json(res, 200, {
      configured: registry.configured(),
      mode: registry.mode(),
      secretsConfigured: secretStore.configured()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/pairing/complete') {
    try {
      const body = await readJson(req);
      const baseUrl = assertSafeWordPressUrl(body.baseUrl);
      const code = String(body.code || '').trim().toUpperCase();
      const connectorSecret = String(body.connectorSecret || '');
      if (!code || code.length < 6) return json(res, 400, { error: 'invalid_pairing_code' });
      if (connectorSecret.length < 20) return json(res, 400, { error: 'invalid_connector_secret' });
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      await registry.consumePairing(baseUrl, codeHash);
      const credentialRef = 'wrekin/wp/' + crypto.createHash('sha256').update(baseUrl).digest('hex').slice(0, 32);
      await secretStore.set(credentialRef, connectorSecret);
      const siteResult = await registry.addSite({
        name: String(body.name || new URL(baseUrl).hostname),
        baseUrl,
        credentialRef,
        relayDevice: body.relayDevice || null,
        metadata: { ...(body.metadata || {}), mode: 'paired', pairedAt: new Date().toISOString() }
      });
      try {
        await registry.audit({
          action: 'connector.paired',
          risk: 'write',
          status: 'ok',
          details: { baseUrl, credentialRef }
        });
      } catch {}
      return json(res, 200, {
        ok: true,
        paired: true,
        site: siteResult && siteResult.site ? siteResult.site : siteResult,
        credentialRef
      });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || 'pairing_failed' });
    }
  }

  if (url.pathname.startsWith('/api/wordpress/') && !requireControl(req, res)) {
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/pairing/start') {
    try {
      if (!registry.configured()) return json(res, 503, { error: 'registry_not_configured' });
      const body = await readJson(req);
      const baseUrl = assertSafeWordPressUrl(body.baseUrl);
      const code = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const result = await registry.createPairing(baseUrl, codeHash);
      return json(res, 200, {
        ok: true,
        code,
        baseUrl,
        expiresAt: result.expires_at || result.expiresAt || null
      });
    } catch (error) {
      return json(res, 400, { error: error.message || 'pairing_start_failed' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/wordpress/audit') {
    if (!registry.configured()) return json(res, 503, { error: 'registry_not_configured' });
    try {
      const siteId = url.searchParams.get('siteId') || null;
      const limit = Number(url.searchParams.get('limit') || 50);
      return json(res, 200, await registry.listAudit({ siteId, limit }));
    } catch (error) {
      return json(res, 502, { error: error.message || 'audit_read_failed' });
    }
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
      let credentialRef = body.credentialRef || null;
      if (body.connectorSecret) {
        if (!secretStore.configured()) return json(res, 503, { error: 'secret_store_not_configured' });
        credentialRef = credentialRef || ('wrekin/wp/' + crypto.randomUUID());
        await secretStore.set(credentialRef, String(body.connectorSecret));
      }
      const result = await registry.addSite({
        name: String(body.name || '').trim(),
        baseUrl,
        credentialRef,
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

  if (req.method === 'POST' && url.pathname === '/api/wordpress/performance') {
    try {
      const body = await readJson(req);
      const site = assertSafeWordPressUrl(body.site);
      const path = typeof body.path === 'string' ? body.path : '/';
      const simple = await simplePerformanceAudit(site, path);
      const pageSpeed = body.pageSpeed === true
        ? await pageSpeedAudit(site, path, { strategy: body.strategy === 'desktop' ? 'desktop' : 'mobile' })
        : { configured: false, reason: 'not_requested' };
      return json(res, 200, { simple, pageSpeed });
    } catch (error) {
      return json(res, 400, { error: error.message || 'performance_audit_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/backup/plan') {
    try {
      const body = await readJson(req);
      return json(res, 200, backupPlan(body.capabilities || {}, body.action || 'create'));
    } catch (error) {
      return json(res, 400, { error: error.message || 'backup_plan_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wordpress/backup/restore-guard') {
    try {
      const body = await readJson(req);
      return json(res, 200, restoreGuard(body));
    } catch (error) {
      return json(res, 409, { error: error.message || 'restore_guard_failed' });
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

  if (req.method === 'POST' && url.pathname.startsWith('/api/wordpress/connector/')) {
    try {
      const body = await readJson(req);
      const connector = await connectorFromBody(body);
      const action = url.pathname.slice('/api/wordpress/connector/'.length);
      let result;
      if (action === 'status') result = await connector.status();
      else if (action === 'plugins') result = await connector.plugins();
      else if (action === 'themes') result = await connector.themes();
      else if (action === 'cron') result = await connector.cron();
      else if (action === 'forms') result = await connector.forms();
      else if (action === 'mail') result = await connector.mail();
      else if (action === 'backup-capabilities') result = await connector.backupCapabilities();
      else if (action === 'cache-purge') result = await connector.cachePurge(body.approved === true);
      else if (action === 'mail-test') result = await connector.mailTest(body.to, body.approved === true);
      else if (action === 'core-update-plan') result = await connector.coreUpdatePlan();
      else if (action === 'core-update') result = await connector.coreUpdate(body.approved === true);
      else if (action === 'plugin-update-plan') result = await connector.pluginUpdatePlan(body.file);
      else if (action === 'plugin-update') result = await connector.pluginUpdate(body.file, body.approved === true);
      else if (action === 'theme-update-plan') result = await connector.themeUpdatePlan(body.slug);
      else if (action === 'theme-update') result = await connector.themeUpdate(body.slug, body.approved === true);
      else return json(res, 404, { error: 'connector_action_not_found' });

      if (registry.configured()) {
        try {
          await registry.audit({
            action: 'connector.' + action,
            risk: action.includes('update') || action === 'cache-purge' ? 'write' : 'read',
            status: 'ok',
            details: { baseUrl: body.baseUrl, credentialRef: body.credentialRef }
          });
        } catch {}
      }
      return json(res, 200, result);
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || 'connector_failed', details: error.data || undefined });
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
        controlAuthConfigured: Boolean(CONTROL_TOKEN),
        registryConfigured: registry.configured(),
        registryMode: registry.mode(),
        secretsConfigured: secretStore.configured()
      }
    });
  }

  if (url.pathname === '/') {
    return html(res, await page());
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wrekin Cloud control plane v${VERSION} listening on ${PORT}`);
});


