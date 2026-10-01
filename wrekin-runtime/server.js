const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.WREKIN_RUNTIME_VERSION || '0.1.0';
const NODE_NAME = process.env.WREKIN_NODE_NAME || os.hostname();
const PROVIDER = process.env.WREKIN_PROVIDER || 'bootstrap';
const REGION = process.env.WREKIN_REGION || 'unknown';
const STARTED_AT = new Date().toISOString();
const INSTANCE_ID = crypto.randomUUID();

const capabilities = [
  'health',
  'capabilities',
  'runtime-info',
  'deployment-readiness'
];

function headers(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  };
}
function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(payload);
}
function html(res, body) {
  res.writeHead(200, {
    ...headers('text/html; charset=utf-8'),
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  res.end(body);
}
function runtimeInfo() {
  return {
    service: 'wrekin-runtime-node',
    version: VERSION,
    instance_id: INSTANCE_ID,
    node_name: NODE_NAME,
    provider: PROVIDER,
    region: REGION,
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    cpus: os.cpus().length,
    total_memory_mb: Math.round(os.totalmem()/1024/1024),
    free_memory_mb: Math.round(os.freemem()/1024/1024),
    uptime_seconds: Math.floor(process.uptime()),
    started_at: STARTED_AT,
    capabilities
  };
}
function page() {
  const i = runtimeInfo();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#08111f"><title>Wrekin Runtime</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--line:#203650;--text:#eef5ff;--muted:#9cb0c8;--accent:#67e8f9;--green:#5ee39a}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07111f,#0a1424);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1050px;margin:auto;padding:30px 18px 56px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:.08em}.mark{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#67e8f9,#7c8cff);box-shadow:0 0 34px rgba(103,232,249,.18)}
h1{font-size:clamp(38px,7vw,68px);margin:26px 0 8px;letter-spacing:-.05em}.tag{font-size:21px;color:#bfd0e4}.lead{color:var(--muted);line-height:1.65;max-width:760px}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.pill{border:1px solid var(--line);border-radius:999px;padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.ok{color:var(--green);border-color:rgba(94,227,154,.35)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:28px}.card{background:rgba(13,27,45,.9);border:1px solid var(--line);border-radius:16px;padding:18px}.k{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.v{font-size:20px;margin-top:8px}.m{color:var(--muted);font-size:13px;margin-top:6px}
footer{margin-top:34px;border-top:1px solid var(--line);padding-top:18px;color:#8297b0;font-size:13px}
a{color:var(--accent)}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style></head>
<body><main class="wrap">
<div class="brand"><div class="mark"></div><span>WREKIN LABS</span></div>
<h1>Wrekin Runtime</h1><div class="tag">Run. Scale. Recover.</div>
<p class="lead">The first Wrekin Runtime node agent. This bootstrap node exposes safe health and capability information only. Workload execution will be added behind authenticated, auditable control-plane commands.</p>
<div class="pills"><span class="pill ok">node healthy</span><span class="pill">v${i.version}</span><span class="pill">${i.provider}</span><span class="pill">${i.region}</span></div>
<section class="grid">
<div class="card"><div class="k">Node</div><div class="v">${i.node_name}</div><div class="m">${i.instance_id}</div></div>
<div class="card"><div class="k">Platform</div><div class="v">${i.platform} / ${i.arch}</div><div class="m">${i.node_version}</div></div>
<div class="card"><div class="k">Capacity</div><div class="v">${i.cpus} CPU</div><div class="m">${i.free_memory_mb} MB free of ${i.total_memory_mb} MB</div></div>
<div class="card"><div class="k">Provider</div><div class="v">${i.provider}</div><div class="m">Region: ${i.region}</div></div>
<div class="card"><div class="k">Health</div><div class="v">Ready</div><div class="m"><a href="/health">/health</a></div></div>
<div class="card"><div class="k">Capabilities</div><div class="v">${capabilities.length}</div><div class="m"><a href="/api/capabilities">/api/capabilities</a></div></div>
</section>
<footer>Wrekin Runtime bootstrap • read-only control surface • <a href="/api/info">Runtime API</a></footer>
</main></body></html>`;
}

const server = http.createServer((req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') return json(res,405,{error:'method_not_allowed'});
  if (url.pathname === '/health') return json(res,200,{ok:true,service:'wrekin-runtime-node',version:VERSION,uptime_seconds:Math.floor(process.uptime())});
  if (url.pathname === '/api/info') return json(res,200,runtimeInfo());
  if (url.pathname === '/api/capabilities') return json(res,200,{service:'wrekin-runtime-node',version:VERSION,capabilities,execution_enabled:false,reason:'Bootstrap node is read-only until authenticated control-plane execution is implemented.'});
  if (url.pathname === '/ready') return json(res,200,{ready:true,requirements:{control_plane_auth:false,workload_execution:false,container_driver:false},stage:'bootstrap'});
  if (url.pathname === '/') return html(res,page());
  return json(res,404,{error:'not_found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Wrekin Runtime node v${VERSION} listening on ${PORT}`));
