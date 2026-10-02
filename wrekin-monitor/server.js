const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.WREKIN_MONITOR_VERSION || '0.3.0';
const STARTED_AT = new Date().toISOString();

const WREKIN_CONTROL_URL = (process.env.WREKIN_CONTROL_URL || 'https://wrekin-cloud.onrender.com').replace(/\/$/, '');
const WREKIN_CONTROL_TOKEN = process.env.WREKIN_CONTROL_TOKEN || '';

const targets = [
  { key: 'control-plane', name: 'Wrekin Cloud', url: process.env.WREKIN_CLOUD_HEALTH || 'https://wrekin-cloud.onrender.com/health' },
  { key: 'runtime', name: 'Wrekin Runtime', url: process.env.WREKIN_RUNTIME_HEALTH || 'https://wrekin-runtime.onrender.com/health' }
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
function json(res,status,body){
  res.writeHead(status,secureHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(body,null,2));
}
function html(res,body){
  res.writeHead(200,{
    ...secureHeaders('text/html; charset=utf-8'),
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  res.end(body);
}

async function check(target) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),5000);
  try {
    const response = await fetch(target.url,{signal:controller.signal,headers:{'User-Agent':'Wrekin-Monitor/0.3'}});
    let body=null;
    try { body=await response.json(); } catch {}
    return {
      key:target.key,name:target.name,url:target.url,
      ok:response.ok && (!body || body.ok !== false),
      status_code:response.status,
      latency_ms:Date.now()-started,
      checked_at:new Date().toISOString(),
      service:body?.service || null,
      version:body?.version || null
    };
  } catch (error) {
    return {key:target.key,name:target.name,url:target.url,ok:false,status_code:null,latency_ms:Date.now()-started,checked_at:new Date().toISOString(),error:error.name==='AbortError'?'timeout':'unreachable'};
  } finally { clearTimeout(timer); }
}
async function checks(){ return Promise.all(targets.map(check)); }

async function controlFetch(path, options={}) {
  if (!WREKIN_CONTROL_TOKEN) throw new Error('wordpress_monitor_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),8000);
  try {
    const response = await fetch(WREKIN_CONTROL_URL + path, {
      ...options,
      signal: controller.signal,
      headers: {
        authorization: 'Bearer ' + WREKIN_CONTROL_TOKEN,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data={};
    try { data=text?JSON.parse(text):{}; } catch {}
    if (!response.ok) throw new Error('control_http_' + response.status);
    return data;
  } finally { clearTimeout(timer); }
}

async function wordpressChecks() {
  if (!WREKIN_CONTROL_TOKEN) return { configured:false, sites:[] };
  try {
    const registry = await controlFetch('/api/wordpress/sites');
    const sites = Array.isArray(registry?.sites) ? registry.sites.slice(0,20) : [];
    const out = [];
    for (const site of sites) {
      const started = Date.now();
      try {
        const result = await controlFetch('/api/wordpress/check', {
          method:'POST',
          body:JSON.stringify({ site: site.base_url, paths:['/'] })
        });
        let connectorInstalled = false;
        let connectorStatus = null;
        try {
          const connectorResponse = await fetch(site.base_url.replace(/\/$/, '') + '/wp-json/wrekin/v1/status', {
            method:'GET',
            redirect:'manual',
            headers:{accept:'application/json'}
          });
          connectorStatus = connectorResponse.status;
          let connectorBody = {};
          try { connectorBody = await connectorResponse.json(); } catch {}
          connectorInstalled =
            (connectorResponse.status === 401 && connectorBody?.code === 'wrekin_unauthorized') ||
            connectorResponse.ok;
        } catch {}

        let signed = null;
        if (site.credential_ref) {
          try {
            const connectorBody = JSON.stringify({ baseUrl: site.base_url, credentialRef: site.credential_ref });
            const [statusInfo, backupInfo, mailInfo] = await Promise.all([
              controlFetch('/api/wordpress/connector/status', { method:'POST', body:connectorBody }),
              controlFetch('/api/wordpress/connector/backup-capabilities', { method:'POST', body:connectorBody }),
              controlFetch('/api/wordpress/connector/mail', { method:'POST', body:connectorBody })
            ]);
            signed = {
              ok:true,
              connector_version:statusInfo?.connector_version || null,
              wordpress_version:statusInfo?.wordpress_version || null,
              php_version:statusInfo?.php_version || null,
              backup_providers:Array.isArray(backupInfo?.providers) ? backupInfo.providers : [],
              mailer:mailInfo?.mailer || null,
              wp_mail_smtp_active:Boolean(mailInfo?.wp_mail_smtp_active),
              using_php_mail:Boolean(mailInfo?.using_php_mail)
            };
          } catch (error) {
            signed = { ok:false, error:error.message };
          }
        }

        out.push({
          id:site.id,
          name:site.name,
          url:site.base_url,
          ok:Boolean(result?.diagnostic?.ok) && (!result?.probes?.length || result.probes.every(x=>x.ok)) && (!signed || signed.ok),
          status_code:result?.diagnostic?.status ?? null,
          latency_ms:Date.now()-started,
          wp_rest_reachable:Boolean(result?.diagnostic?.wpRestReachable),
          connector_installed:connectorInstalled,
          connector_paired:Boolean(site.credential_ref),
          connector_status_code:connectorStatus,
          signed_connector:signed,
          rollout:{
            installed_version:site?.metadata?.installed_connector_version || null,
            recommended_version:site?.metadata?.recommended_connector_version || null,
            pairing_state:site?.metadata?.pairing_state || null,
            upgrade_state:site?.metadata?.upgrade_state || null,
            last_signed_diagnostics_at:site?.metadata?.last_signed_diagnostics_at || null
          },
          checked_at:new Date().toISOString()
        });
      } catch (error) {
        out.push({
          id:site.id,
          name:site.name,
          url:site.base_url,
          ok:false,
          status_code:null,
          latency_ms:Date.now()-started,
          wp_rest_reachable:false,
          checked_at:new Date().toISOString(),
          error:error.message
        });
      }
    }
    return { configured:true, sites:out };
  } catch (error) {
    return { configured:true, error:error.message, sites:[] };
  }
}

function page(){
return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#08111f"><title>Wrekin Monitor</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--line:#203650;--text:#eef5ff;--muted:#9cb0c8;--accent:#67e8f9;--green:#5ee39a;--red:#ff8f8f;--amber:#f7c66b}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07111f,#0a1424);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:30px 18px 56px}
.brand{display:flex;gap:12px;align-items:center;font-weight:800;letter-spacing:.08em}.mark{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#67e8f9,#7c8cff)}
h1{font-size:clamp(38px,7vw,68px);margin:26px 0 8px;letter-spacing:-.05em}.tag{font-size:21px;color:#bfd0e4}.lead{color:var(--muted);line-height:1.65;max-width:760px}
h2{margin-top:34px;font-size:22px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}.card{background:rgba(13,27,45,.9);border:1px solid var(--line);border-radius:16px;padding:18px}.k{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.state{font-size:24px;margin-top:8px}.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.m{color:var(--muted);font-size:13px;margin-top:7px;line-height:1.5}
footer{margin-top:34px;border-top:1px solid var(--line);padding-top:18px;color:#8297b0;font-size:13px}a{color:var(--accent)}
@media(max-width:620px){.grid{grid-template-columns:1fr}}
</style></head><body><main class="wrap">
<div class="brand"><div class="mark"></div><span>WREKIN LABS</span></div>
<h1>Wrekin Monitor</h1><div class="tag">See it before users do.</div>
<p class="lead">Infrastructure and WordPress health monitoring for Wrekin Cloud. Checks are bounded and never expose site credentials.</p>
<h2>Wrekin infrastructure</h2>
<div id="grid" class="grid"><div class="card"><div class="k">Checking</div><div class="state">Loading...</div></div></div>
<h2>WordPress sites</h2>
<div id="wpgrid" class="grid"><div class="card"><div class="k">Checking</div><div class="state">Loading...</div></div></div>
<footer>Wrekin Monitor v${VERSION} | <a href="/health">Self health</a> | <a href="/api/checks">Checks API</a> | <a href="/api/wordpress">WordPress API</a></footer>
<script>
function renderCard(x){
  var cls=x.ok?'ok':'bad';
  var state=x.ok?'Healthy':'Degraded';
  var code=(x.status_code===null||x.status_code===undefined)?'-':x.status_code;
  var extra=x.wp_rest_reachable===undefined?'':('<br>WP REST '+(x.wp_rest_reachable?'reachable':'unreachable'));
  if(x.connector_installed!==undefined){
    extra += '<br>Wrekin Connector '+(x.connector_installed?(x.connector_paired?'paired':'installed / not paired'):'not installed');
    if(x.signed_connector){
      extra += '<br>Signed '+(x.signed_connector.ok?'OK':'failed');
      if(x.signed_connector.connector_version) extra += ' · v'+x.signed_connector.connector_version;
      if(Array.isArray(x.signed_connector.backup_providers) && x.signed_connector.backup_providers.length) extra += '<br>Backup '+x.signed_connector.backup_providers.map(function(p){return p.provider}).join(', ');
      if(x.signed_connector.wp_mail_smtp_active) extra += '<br>Mail '+(x.signed_connector.using_php_mail?'PHP mail':'SMTP/provider');
    }
    if(x.rollout){
      if(x.rollout.upgrade_state) extra += '<br>Rollout '+x.rollout.upgrade_state.replaceAll('_',' ');
      if(x.rollout.recommended_version && x.rollout.installed_version && x.rollout.recommended_version!==x.rollout.installed_version) extra += ' · '+x.rollout.installed_version+' → '+x.rollout.recommended_version;
      if(x.rollout.pairing_state) extra += '<br>'+x.rollout.pairing_state.replaceAll('_',' ');
    }
  }
  return '<article class="card"><div class="k">'+x.name+'</div><div class="state '+cls+'">'+state+'</div><div class="m">HTTP '+code+' | '+x.latency_ms+' ms'+extra+'<br>'+new Date(x.checked_at).toLocaleString()+'</div></article>';
}
async function refresh(){
  var grid=document.getElementById('grid'), wpgrid=document.getElementById('wpgrid');
  try{
    var r=await fetch('/api/checks',{cache:'no-store'}); var data=await r.json();
    grid.innerHTML=data.checks.map(renderCard).join('');
  }catch(e){grid.innerHTML='<div class="card"><div class="k">Monitor</div><div class="state bad">Check failed</div></div>';}
  try{
    var wr=await fetch('/api/wordpress',{cache:'no-store'}); var wd=await wr.json();
    if(!wd.configured) wpgrid.innerHTML='<div class="card"><div class="k">WordPress</div><div class="state warn">Not configured</div></div>';
    else if(!wd.sites.length) wpgrid.innerHTML='<div class="card"><div class="k">WordPress</div><div class="state warn">No sites</div></div>';
    else wpgrid.innerHTML=wd.sites.map(renderCard).join('');
  }catch(e){wpgrid.innerHTML='<div class="card"><div class="k">WordPress</div><div class="state bad">Check failed</div></div>';}
}
refresh(); setInterval(refresh,30000);
</script></main></body></html>`;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method!=='GET') return json(res,405,{error:'method_not_allowed'});
  if(url.pathname==='/health') return json(res,200,{ok:true,service:'wrekin-monitor',version:VERSION,started_at:STARTED_AT,uptime_seconds:Math.floor(process.uptime()),wordpress_monitor_configured:Boolean(WREKIN_CONTROL_TOKEN)});
  if(url.pathname==='/api/checks'){
    const result=await checks(); const ok=result.every(x=>x.ok);
    return json(res,ok?200:207,{ok,service:'wrekin-monitor',version:VERSION,checked_at:new Date().toISOString(),checks:result});
  }
  if(url.pathname==='/api/wordpress'){
    const result=await wordpressChecks();
    const ok=!result.configured || result.sites.every(x=>x.ok);
    return json(res,ok?200:207,{ok,service:'wrekin-monitor-wordpress',version:VERSION,checked_at:new Date().toISOString(),...result});
  }
  if(url.pathname==='/') return html(res,page());
  return json(res,404,{error:'not_found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Wrekin Monitor v${VERSION} listening on ${PORT}`));
