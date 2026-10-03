// Actual AutoSetup handler with isolated database, DNS and website adapters; no live scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes((await readFile(new URL('../backend/cxroute-website-scan.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,''));
const user='qa-owner',org='qa-org',brand='qa-brand';
async function exercise({role='owner',websiteUrl='https://qa.example/',httpStatus=200,failFactWrite=false}={}){
 const writes=[],fetches=[];let handler;
 const client={from(table){
  let operation='read',body;
  const query=new Proxy({}, {get(_,key){
   if(key==='then')return resolve=>{
    if(operation!=='read')writes.push({table,operation,body});
    if(failFactWrite&&table==='cxroute_knowledge_facts'&&operation==='insert')return resolve({data:null,error:{message:'Fixture write failure'}});
    const rows={cxroute_org_members:{organisation_id:org,role},cxroute_brands:{id:brand,website_url:websiteUrl,enabled:true},cxroute_autosetup_runs:{id:'qa-run'},cxroute_source_connections:{id:'qa-connection'},cxroute_source_items:{id:'qa-source'},cxroute_knowledge_facts:[]};
    resolve({data:rows[table]??null,error:null});
   };
   return (...args)=>{if(['insert','update','delete','upsert'].includes(key)){operation=key;body=args[0];}return query;};
  }});return query;
 },async rpc(){return {data:{ready:false},error:null};}};
 runInNewContext(source,{
  Deno:{serve:fn=>handler=fn,resolveDns:async(_host,type)=>type==='A'?['203.0.113.10']:[]},
  withSupabase:(config,fn)=>{assert.equal(config.auth,'user');return fn;},
  URL,Response,AbortController,setTimeout,clearTimeout,TextDecoder,
  fetch:async url=>{fetches.push(String(url));return new Response('<html><head><title>QA Business</title></head><body><p>Contact: info@example.invalid</p><p>Rehearsal room hire is £20 per hour.</p></body></html>',{status:httpStatus,headers:{'content-type':'text/html'}});}
 });
 const response=await handler(new Request('https://fixture.invalid/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organisationId:org,brandId:brand,websiteUrl})}),{userClaims:{id:user,email:'owner@example.invalid',role:'authenticated'},supabase:client,supabaseAdmin:client});
 return {status:response.status,body:await response.json(),writes,fetches};
}
test('authorized AutoSetup records the verified actor and keeps extracted knowledge pending review',async()=>{
 const r=await exercise();assert.equal(r.status,200);assert.equal(r.body.pagesScanned,1);assert.ok(r.body.factsProposed>0);
 const facts=r.writes.find(w=>w.table==='cxroute_knowledge_facts'&&w.operation==='insert').body;
 assert.ok(facts.every(f=>f.review_status==='pending'&&f.organisation_id===org&&f.brand_id===brand));
 const audit=r.writes.find(w=>w.table==='cxroute_audit_log').body;
 assert.equal(audit.actor_user_id,user);assert.equal(audit.action,'website_autosetup_scan');
});
test('staff without owner/admin role cannot start website scanning or write source data',async()=>{
 const r=await exercise({role:'agent'});assert.equal(r.status,403);assert.equal(r.fetches.length,0);assert.equal(r.writes.length,0);
});
test('private website URL is rejected before a network request or knowledge insertion',async()=>{
 const r=await exercise({websiteUrl:'http://localhost/'});assert.equal(r.status,400);assert.equal(r.fetches.length,0);
 assert.ok(!r.writes.some(w=>w.table==='cxroute_knowledge_facts'));assert.ok(r.writes.some(w=>w.body?.scan_status==='error'));
});
test('failed website fetch cannot be recorded as a completed scan',async()=>{
 const r=await exercise({httpStatus:503});assert.equal(r.status,400);
 assert.ok(!r.writes.some(w=>w.body?.scan_status==='complete'));assert.ok(r.writes.some(w=>w.body?.scan_status==='error'));
});
test('failure to save proposed facts reports failure without a success audit',async()=>{
 const r=await exercise({failFactWrite:true});assert.equal(r.status,400);
 assert.ok(!r.writes.some(w=>w.table==='cxroute_audit_log'));assert.ok(!r.writes.some(w=>w.body?.scan_status==='complete'));
});
