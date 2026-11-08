const {stripTypeScriptTypes} = require('node:module');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let passed=0;
function load(directory) {
  const fixtures = {};
  let calls=0;
  const db={from(table) {
    calls++;
    const q = new Proxy({}, {get(_,key) {
      if(key==='then') return (resolve,reject)=>Promise.resolve({data:fixtures[table] ?? null,error:null}).then(resolve,reject);
      return ()=>q;
    }});
    return q;
  },auth:{admin:{getUserById:async()=>({data:{user:{id:'fixture-user'}},error:null})}}};
  const ctx={console,URL,Request,Response,Headers,TextEncoder,crypto:globalThis.crypto,atob,setTimeout,clearTimeout,
    createClient:()=>db, authorizeSite:async()=>null, siteSubject:async()=>null, siteAccountRoute:async()=>new Response('',{status:401}),
    Deno:{env:{get:()=>undefined},serve:fn=>ctx.handler=fn}};
  vm.createContext(ctx);
  for(const filename of ['index.ts','site-auth.ts','site-config.ts']) {
    const source=readFileSync(path.join(root,'hosted',directory,filename),'utf8');
    stripTypeScriptTypes(source); // Parse every deployed file.
    if(filename==='index.ts') {
      const code=stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm,''));
      vm.runInContext(code+'\nglobalThis.inspect={authorize,resolveDevice,resolveOwnerDevice,advertisedTools};',ctx);
    }
  }
  return {ctx,fixtures,getCalls:()=>calls};
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  const baseline=load('recovered-live');
  const target=load('project-relay-mcp');
  await check('all 150 tool schemas preserved exactly',()=>{
    const old=JSON.stringify(baseline.ctx.inspect.advertisedTools());
    const current=JSON.stringify(target.ctx.inspect.advertisedTools());
    assert.equal(current,old);assert.equal(JSON.parse(current).length,150);
  });
  const rpc=async(method,params={})=>{
    const r=await target.ctx.handler(new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
    return {status:r.status,body:await r.json()};
  };
  await check('initialize reports 0.7.12',async()=>assert.equal((await rpc('initialize')).body.result.serverInfo.version,'0.7.12'));
  await check('unauthenticated device call denied without database access',async()=>{
    const before=target.getCalls();const result=(await rpc('tools/call',{name:'list_workstations',arguments:{}})).body.result;
    assert.equal(result.isError,true);assert.ok(result._meta['mcp/www_authenticate'].length);assert.equal(target.getCalls(),before);
  });
  await check('private Sites route rejects missing identity',async()=>{
    const r=await target.ctx.handler(new Request('https://relay.test/sites-mcp',{method:'POST',body:'{}'}));assert.equal(r.status,401);
  });
  const token={user_id:'fixture-user',client_id:'fixture',resource:'https://project-relay-mcp-gateway.onrender.com/mcp',scope:'relay:inspect',access_expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:null};
  const req=new Request('https://relay.test/mcp',{headers:{authorization:'Bearer fixture-token'}});
  target.fixtures.project_relay_accounts={status:'active',plan:'fixture'};
  baseline.fixtures.project_relay_accounts={status:'active',plan:'fixture'};
  await check('invalid expiry defect reproduced in deployed baseline',async()=>{
    baseline.fixtures.project_relay_oauth_tokens={...token,access_expires_at:'invalid'};
    assert.ok(await baseline.ctx.inspect.authorize(req));
  });
  for(const [name,override] of [['malformed expiry',{access_expires_at:'invalid'}],['expired token',{access_expires_at:'2000-01-01'}],['revoked token',{revoked_at:'2026-01-01'}],['wrong audience',{resource:'https://wrong.test'}],['wrong scope',{scope:'other'}]]){
    await check(name+' rejected',async()=>{target.fixtures.project_relay_oauth_tokens={...token,...override};assert.equal(await target.ctx.inspect.authorize(req),null);});
  }
  await check('valid token remains accepted',async()=>{target.fixtures.project_relay_oauth_tokens=token;assert.equal((await target.ctx.inspect.authorize(req)).kind,'oauth');});
  target.fixtures.project_relay_devices=[{id:'fixture-device',last_seen:'invalid',info:{}}];
  baseline.fixtures.project_relay_devices=target.fixtures.project_relay_devices;
  await check('invalid device timestamp defect reproduced in deployed baseline',async()=>assert.ok(await baseline.ctx.inspect.resolveDevice('fixture-device',{kind:'controller'})));
  await check('invalid device timestamp rejected',async()=>assert.rejects(target.ctx.inspect.resolveDevice('fixture-device',{kind:'controller'})));
  await check('stale device rejected',async()=>{target.fixtures.project_relay_devices[0].last_seen='2000-01-01';await assert.rejects(target.ctx.inspect.resolveDevice('fixture-device',{kind:'controller'}));});
  await check('fresh device accepted',async()=>{target.fixtures.project_relay_devices[0].last_seen=new Date().toISOString();assert.ok(await target.ctx.inspect.resolveDevice('fixture-device',{kind:'controller'}));});
  await check('controller cannot request owner control',async()=>assert.rejects(target.ctx.inspect.resolveOwnerDevice('fixture-device',{kind:'controller'})));
  console.log('HOSTED TESTS PASSED: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;});
