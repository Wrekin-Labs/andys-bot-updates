const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.WREKIN_MONITOR_VERSION || '0.1.1';
const STARTED_AT = new Date().toISOString();

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
    const response = await fetch(target.url,{signal:controller.signal,headers:{'User-Agent':'Wrekin-Monitor/0.1'}});
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

function page(){
return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#08111f"><title>Wrekin Monitor</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--line:#203650;--text:#eef5ff;--muted:#9cb0c8;--accent:#67e8f9;--green:#5ee39a;--red:#ff8f8f}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07111f,#0a1424);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:980px;margin:auto;padding:30px 18px 56px}
.brand{display:flex;gap:12px;align-items:center;font-weight:800;letter-spacing:.08em}.mark{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#67e8f9,#7c8cff)}
h1{font-size:clamp(38px,7vw,68px);margin:26px 0 8px;letter-spacing:-.05em}.tag{font-size:21px;color:#bfd0e4}.lead{color:var(--muted);line-height:1.65;max-width:760px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:28px}.card{background:rgba(13,27,45,.9);border:1px solid var(--line);border-radius:16px;padding:18px}.k{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.state{font-size:24px;margin-top:8px}.ok{color:var(--green)}.bad{color:var(--red)}.m{color:var(--muted);font-size:13px;margin-top:7px;line-height:1.5}
footer{margin-top:34px;border-top:1px solid var(--line);padding-top:18px;color:#8297b0;font-size:13px}a{color:var(--accent)}
@media(max-width:620px){.grid{grid-template-columns:1fr}}
</style></head><body><main class="wrap">
<div class="brand"><div class="mark"></div><span>WREKIN LABS</span></div>
<h1>Wrekin Monitor</h1><div class="tag">See it before users do.</div>
<p class="lead">Bootstrap observability for Wrekin Cloud. It performs bounded public health checks and reports availability and latency without storing credentials.</p>
<div id="grid" class="grid"><div class="card"><div class="k">Checking</div><div class="state">Loading...</div></div></div>
<footer>Wrekin Monitor v${VERSION} | <a href="/health">Self health</a> | <a href="/api/checks">Checks API</a></footer>
<script>
async function refresh(){
  var grid=document.getElementById('grid');
  try{
    var r=await fetch('/api/checks',{cache:'no-store'});
    var data=await r.json();
    grid.innerHTML=data.checks.map(function(x){
      var cls=x.ok?'ok':'bad';
      var state=x.ok?'Healthy':'Degraded';
      var code=(x.status_code===null||x.status_code===undefined)?'-':x.status_code;
      var service=x.service||x.key;
      var version=x.version?(' v'+x.version):'';
      return '<article class="card"><div class="k">'+x.name+'</div><div class="state '+cls+'">'+state+'</div><div class="m">HTTP '+code+' | '+x.latency_ms+' ms<br>'+service+version+'<br>'+new Date(x.checked_at).toLocaleString()+'</div></article>';
    }).join('');
  }catch(e){
    grid.innerHTML='<div class="card"><div class="k">Monitor</div><div class="state bad">Check failed</div></div>';
  }
}
refresh(); setInterval(refresh,30000);
</script></main></body></html>`;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method!=='GET') return json(res,405,{error:'method_not_allowed'});
  if(url.pathname==='/health') return json(res,200,{ok:true,service:'wrekin-monitor',version:VERSION,started_at:STARTED_AT,uptime_seconds:Math.floor(process.uptime())});
  if(url.pathname==='/api/checks'){
    const result=await checks(); const ok=result.every(x=>x.ok);
    return json(res,ok?200:207,{ok,service:'wrekin-monitor',version:VERSION,checked_at:new Date().toISOString(),checks:result});
  }
  if(url.pathname==='/') return html(res,page());
  return json(res,404,{error:'not_found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Wrekin Monitor v${VERSION} listening on ${PORT}`));
