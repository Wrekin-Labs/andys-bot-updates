// Exercise the real handler with the documented, already-verified middleware context.
// Authentication middleware and database RLS are not replaced or tested by these adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';

const source=stripTypeScriptTypes((await readFile(new URL('../backend/cxroute-onboard.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,''));
const owner='qa-owner',org='qa-org';
async function exercise(body,{identity={id:owner,email:'owner@example.invalid',role:'authenticated',appMetadata:{},userMetadata:{}},members=[{organisation_id:org,user_id:owner,role:'owner',display_name:'QA owner'}]}={}) {
 const queries=[];let handler;
 const records={
  cxroute_org_members:members,
  cxroute_organisations:[{id:org,name:'QA workspace'}],
  cxroute_business_profiles:[{organisation_id:org,display_name:'QA business'}],
  cxroute_settings:[{organisation_id:org,ai_mode:'approve'}],
  cxroute_staff_notifications:[
   {id:'mine',organisation_id:org,user_id:owner,read_at:null},
   {id:'other-user',organisation_id:org,user_id:'someone-else',read_at:null},
   {id:'other-org',organisation_id:'another-org',user_id:owner,read_at:null}
  ]
 };
 const supabase={from(table){
  const filters=[];let single=false;
  const query=new Proxy({}, {get(_,key){
   if(key==='then')return resolve=>{
    queries.push({table,filters});
    const rows=(records[table]||[]).filter(row=>filters.every(([field,value])=>Array.isArray(value)?value.includes(row[field]):row[field]===value));
    resolve({data:single?(rows[0]||null):rows,error:null});
   };
   return (...args)=>{
    if(['insert','upsert','update','delete'].includes(key))throw Error('Unexpected mutation');
    if(key==='eq'||key==='in')filters.push(args);
    if(key==='maybeSingle'||key==='single')single=true;
    return query;
   };
  }});return query;
 }};
 runInNewContext(source,{Deno:{serve:fn=>handler=fn},Response,URL,console,
  withSupabase:(config,fn)=>{assert.equal(config.auth,'user');return fn;}
 });
 const ctx={userClaims:identity,supabase,get supabaseAdmin(){throw Error('Read flow must use caller-scoped client');}};
 const response=await handler(new Request('https://fixture.invalid/onboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),ctx);
 return {status:response.status,body:await response.json(),queries};
}

test('valid middleware user identity loads the owner workspace after sign-in',async()=>{
 const r=await exercise({action:'me'});
 assert.equal(r.status,200);assert.equal(r.body.workspaces[0].id,org);assert.equal(r.body.workspaces[0].role,'owner');
 assert.deepEqual(r.queries.find(q=>q.table==='cxroute_org_members').filters,[['user_id',owner]]);
});
test('request-body identity cannot replace the verified caller identity',async()=>{
 const r=await exercise({action:'me',userId:'someone-else',organisationId:'another-org'});
 assert.equal(r.status,200);assert.deepEqual(r.body.workspaces.map(w=>w.id),[org]);
 assert.deepEqual(r.queries.find(q=>q.table==='cxroute_org_members').filters,[['user_id',owner]]);
});
test('missing verified identity is rejected before any database query',async()=>{
 for(const identity of [null,{}, {userMetadata:{id:owner}}]) {
  const r=await exercise({action:'me',userId:owner},{identity});
  assert.equal(r.status,401);assert.equal(r.queries.length,0);
 }
});
test('authenticated account without membership receives no workspace',async()=>{
 const r=await exercise({action:'me'},{members:[]});
 assert.equal(r.status,200);assert.deepEqual(r.body.workspaces,[]);assert.equal(r.queries.length,1);
});
test('notifications remain scoped to the verified user and their workspace',async()=>{
 const r=await exercise({action:'notifications',organisationId:org});
 assert.equal(r.status,200);assert.deepEqual(r.body.notifications.map(n=>n.id),['mine']);assert.equal(r.body.unread,1);
 const denied=await exercise({action:'notifications',organisationId:'another-org'});
 assert.equal(denied.status,403);assert.equal(denied.queries.length,1);
});
