// Regression coverage for the unchanged live v8 sync handler, using in-memory fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes((await readFile(new URL('../backend/cxroute-widget-sync.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,''));
const org='qa-org',brand='qa-brand',conversation='qa-conversation';
const fixtureMessages=[
 {id:'customer',direction:'inbound',author_type:'customer',body:'Can a person help?',created_at:'2026-10-03T15:00:00Z'},
 {id:'private',direction:'internal',author_type:'agent',body:'PRIVATE NOTE MUST NOT REACH THE VISITOR',created_at:'2026-10-03T15:01:00Z'},
 {id:'reply',direction:'outbound',author_type:'agent',body:'A staff member can help.',created_at:'2026-10-03T15:02:00Z'}
].map(m=>({...m,organisation_id:org,conversation_id:conversation,safe_metadata:{private_staff_id:'never-public'}}));
async function exercise(body={},overrides={}){
 let handler;const reads=[];
 const records={
  cxroute_widget_configs:[{public_key:'qa-widget',organisation_id:org,brand_id:brand,enabled:true,allowed_origins:['https://qa.example']}],
  cxroute_conversations:[{id:conversation,organisation_id:org,brand_id:brand,channel:'website_chat'}],
  cxroute_messages:fixtureMessages,
  ...overrides.records
 };
 const admin={from(table){
  const filters=[];let single=false,columns=null,ordering=null,limit=Infinity;
  const query=new Proxy({}, {get(_,key){
   if(key==='then')return resolve=>{
    reads.push(table);
    if(overrides.failTable===table)return resolve({data:null,error:{message:'Fixture query failure'}});
    let rows=(records[table]||[]).filter(row=>filters.every(([op,k,v])=>op==='eq'?row[k]===v:op==='in'?v.includes(row[k]):row[k]>v));
    if(ordering)rows=[...rows].sort((a,b)=>String(a[ordering]).localeCompare(String(b[ordering])));
    rows=rows.slice(0,limit).map(row=>columns?Object.fromEntries(columns.map(k=>[k,row[k]])):row);
    resolve({data:single?(rows[0]||null):rows,error:null});
   };
   return (...args)=>{
    if(key==='select')columns=args[0].split(',');
    else if(['eq','in','gt'].includes(key))filters.push([key,...args]);
    else if(key==='order')ordering=args[0];
    else if(key==='limit')limit=args[0];
    else if(key==='maybeSingle')single=true;
    else throw Error('Unexpected database operation '+key);
    return query;
   };
  }});return query;
 }};
 runInNewContext(source,{Deno:{serve:fn=>handler=fn,env:{get:name=>({SUPABASE_SECRET_KEYS:'{"default":"fixture-only"}',SUPABASE_URL:'https://fixture.invalid'})[name]}},createClient:()=>admin,Response});
 const response=await handler(new Request('https://fixture.invalid/sync',{method:'POST',headers:{Origin:overrides.origin||'https://qa.example','Content-Type':'application/json'},body:JSON.stringify({widgetKey:'qa-widget',conversationId:conversation,...body})}));
 return {status:response.status,body:await response.json(),reads};
}

test('visitor history contains customer and staff replies but no internal notes or staff metadata',async()=>{
 const r=await exercise({includeHistory:true});assert.equal(r.status,200);
 assert.deepEqual(r.body.messages.map(m=>m.id),['customer','reply']);
 assert.ok(!JSON.stringify(r.body).includes('PRIVATE NOTE'));assert.ok(!JSON.stringify(r.body).includes('never-public'));
 assert.ok(r.body.messages.every(m=>Object.keys(m).sort().join(',')==='author_type,body,created_at,direction,id'));
});
test('polling delivers the new staff reply and excludes inbound messages and private notes',async()=>{
 const r=await exercise({after:'2026-10-03T15:00:00Z'});assert.equal(r.status,200);
 assert.deepEqual(r.body.messages.map(m=>m.id),['reply']);
 const next=await exercise({after:'2026-10-03T15:02:00Z'});assert.deepEqual(next.body.messages,[]);
});
test('a different workspace cannot retrieve a conversation through this widget',async()=>{
 const r=await exercise({}, {records:{cxroute_conversations:[{id:conversation,organisation_id:'other-org',brand_id:brand,channel:'website_chat'}]}});
 assert.equal(r.status,404);assert.ok(!r.reads.includes('cxroute_messages'));
});
test('a branded widget cannot retrieve another brand conversation',async()=>{
 const r=await exercise({}, {records:{cxroute_conversations:[{id:conversation,organisation_id:org,brand_id:'other-brand',channel:'website_chat'}]}});
 assert.equal(r.status,404);assert.ok(!r.reads.includes('cxroute_messages'));
});
test('non-website conversations are not exposed through the visitor widget',async()=>{
 const r=await exercise({}, {records:{cxroute_conversations:[{id:conversation,organisation_id:org,brand_id:brand,channel:'email'}]}});
 assert.equal(r.status,404);assert.ok(!r.reads.includes('cxroute_messages'));
});
test('disabled widget and disallowed origin fail before messages are read',async()=>{
 const disabled=await exercise({}, {records:{cxroute_widget_configs:[]}});assert.equal(disabled.status,404);
 const wrongOrigin=await exercise({}, {origin:'https://other.example'});assert.equal(wrongOrigin.status,403);
 assert.ok(!disabled.reads.includes('cxroute_messages'));assert.ok(!wrongOrigin.reads.includes('cxroute_messages'));
});
test('database failure is reported rather than represented as an empty successful sync',async()=>{
 const r=await exercise({}, {failTable:'cxroute_messages'});assert.equal(r.status,500);assert.equal(r.body.messages,undefined);
});
