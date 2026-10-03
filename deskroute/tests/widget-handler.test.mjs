// Run the real Edge handler against in-memory database/provider adapters. No network or live records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {canSendAutomatically} from '../backend/answer-policy.js';
import {literalGroundingCheck} from '../backend/literal-grounding.js';
import {questionDate,datedKnowledge} from '../backend/dated-knowledge.js';
const source=stripTypeScriptTypes((await readFile(new URL('../backend/cxroute-widget-chat.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,''));
async function exercise(question,facts,{provider='absent',reply,datedFacts=[],knowledgeFacts=datedFacts,assigned=true}={}){
 const writes=[],calls=[];let handler;
 const conversation={id:'qa-conversation',brand_id:'qa-brand',assigned_user_id:assigned?'qa-agent':null,tags:[]};
 const records={cxroute_knowledge_facts:knowledgeFacts,cxroute_widget_configs:{id:'qa-widget',organisation_id:'qa-org',brand_id:'qa-brand',enabled:true,allowed_origins:['https://release.example']},cxroute_channel_ai_policies:{enabled:true,mode:'automatic',min_confidence:.9},cxroute_conversations:conversation,cxroute_org_members:{user_id:'qa-agent',role:'owner'}};
 const admin={
  from(table){
   let operation='read',body;
   const query=new Proxy({}, {get(_,key){
    if(key==='then')return resolve=>{if(operation!=='read')writes.push({table,operation,body});resolve({data:operation==='read'?(records[table]??null):{id:table+'-fixture'},error:null});};
    return (...args)=>{if(['insert','update'].includes(key)){operation=key;body=args[0];}return query;};
   }});return query;
  },
  async rpc(name,p){calls.push({name,p});if(name==='cxroute_take_widget_rate_limit')return {data:1};if(name.startsWith('cxroute_search_approved_facts'))return {data:facts};if(name==='cxroute_record_knowledge_gap')return {data:'qa-gap'};throw Error('Unexpected RPC '+name);}
 };
 runInNewContext(source,{Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEYS:'{"default":"test-only"}',OPENAI_API_KEY:provider==='absent'?undefined:'test-only'})[name]},serve:fn=>handler=fn},createClient:()=>admin,canSendAutomatically,literalGroundingCheck,questionDate,datedKnowledge,crypto:webcrypto,TextEncoder,URL,Response,console,fetch:async()=>provider==='failure'?new Response('{"error":{"message":"Provider unavailable"}}',{status:503}):new Response(JSON.stringify({output_text:JSON.stringify(reply)}))});
 const response=await handler(new Request('https://fixture.invalid/widget',{method:'POST',headers:{Origin:'https://release.example','Content-Type':'application/json'},body:JSON.stringify({widgetKey:'qa-key',conversationId:conversation.id,message:question})}));
 assert.equal(response.status,200);return {body:await response.json(),writes,calls};
}
const price={id:'price',fact_key:'rehearsal_price_current',fact_value:'Rehearsal room hire is £15 per hour until 31 October 2026.',confidence:.99,relevance:1.04};
const rule={id:'rule',fact_key:'booking_guard',fact_value:'DeskRoute may answer questions about rehearsal rooms and booking rules, but must not claim availability.',confidence:.99,relevance:.301379};
for(const [question,fact] of [['What is the rehearsal room price from 1 November 2026?',price],['Can you confirm the exact doorway width for wheelchair access to room 2?',rule]]){
 test('captured live regression: '+question,async()=>{
  const r=await exercise(question,[fact]);assert.equal(r.body.needsHuman,true);assert.equal(r.body.assignedUserId,'qa-agent');assert.equal(r.body.knowledgeGapId,'qa-gap');assert.notEqual(r.body.answer,fact.fact_value);
  if(question.includes('November')) assert.ok(!r.writes.some(w=>w.table==='cxroute_ai_drafts'));
  else assert.ok(r.writes.some(w=>w.table==='cxroute_ai_drafts'&&w.body.status==='pending'));
  assert.ok(r.writes.some(w=>w.table==='cxroute_conversations'&&w.body.tags?.includes('ai-needs-human')));
  assert.ok(r.writes.some(w=>w.table==='cxroute_staff_notifications'));
  assert.ok(r.writes.filter(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound').every(w=>w.body.author_type==='system'&&w.body.body!==fact.fact_value));
 });
}
test('AI outage still answers a strong customer-safe approved fact',async()=>{const r=await exercise('What is the price?',[price],{provider:'failure'});assert.equal(r.body.needsHuman,false);assert.equal(r.body.answer,price.fact_value);assert.ok(r.writes.some(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound'&&w.body.body===price.fact_value));});
const recording={id:'recording',organisation_id:'qa-org',brand_id:'qa-brand',review_status:'approved',fact_key:'recording_bookings_status',fact_value:'Recording studio bookings are currently paused.',category:'services',confidence:.99,valid_from:null,valid_until:null};
test('recording question falls back to approved brand knowledge when search RPC misses it',async()=>{
 const r=await exercise('What days do u do recording',[],{knowledgeFacts:[recording]});
 assert.equal(r.body.needsHuman,false);assert.equal(r.body.answer,recording.fact_value);assert.equal(r.body.source?.factId,'recording');
 assert.ok(r.writes.some(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound'&&w.body.body===recording.fact_value));
});
test('first human handoff creates a staff notification',async()=>{
 const r=await exercise('Is a lift available?',[],{assigned:false});
 assert.equal(r.body.needsHuman,true);assert.equal(r.body.assignedUserId,'qa-agent');
 assert.ok(r.writes.some(w=>w.table==='cxroute_staff_notifications'&&w.body.user_id==='qa-agent'));
});
test('unknown question with no approved facts creates a gap and human assignment',async()=>{const r=await exercise('Is a lift available?',[]);assert.equal(r.body.needsHuman,true);assert.equal(r.body.knowledgeGapId,'qa-gap');assert.equal(r.body.assignedUserId,'qa-agent');});
test('validated grounded answer still reaches the visitor',async()=>{const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};const r=await exercise('What is the current price?',[price],{provider:'ready',reply});assert.equal(r.body.needsHuman,false);assert.equal(r.body.answer,price.fact_value);assert.ok(r.writes.some(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound'&&w.body.author_type==='ai'));const event=r.writes.find(w=>w.table==='cxroute_ai_events');assert.equal(event?.body?.outcome,'auto_answered');assert.equal(Object.hasOwn(event?.body||{},'message'),false);});
test('fabricated literal in a grounded-looking model answer is never auto-sent',async()=>{const reply={answer:'Rehearsal room hire is £20 per hour.',grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};const r=await exercise('What is the current price?',[price],{provider:'ready',reply});assert.equal(r.body.needsHuman,true);assert.ok(r.writes.some(w=>w.table==='cxroute_ai_drafts'&&w.body.proposed_reply.includes('£20')));assert.ok(!r.writes.some(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound'&&w.body.author_type==='ai'));});

test('November question drafts the November price and retains human review even with a confident provider',async()=>{
 const future={...price,id:'november',organisation_id:'qa-org',brand_id:'qa-brand',review_status:'approved',category:'pricing',fact_key:'rehearsal_price_from_2026_11_01',fact_value:'From 1 November 2026 rehearsal room hire is £16 per hour.',valid_from:'2026-11-01T00:00:00Z',valid_until:null};
 const reply={answer:future.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['november']};
 for(const provider of ['absent','ready']){
  const r=await exercise('What is the rehearsal room price from 1 November 2026?',[price],{provider,reply,datedFacts:[future]});
  assert.equal(r.body.needsHuman,true);assert.equal(r.body.knowledgeGapId,'qa-gap');
  assert.ok(r.writes.some(w=>w.table==='cxroute_ai_drafts'&&w.body.proposed_reply.includes('£16')));
  assert.ok(!r.calls.some(c=>c.name.startsWith('cxroute_search_approved_facts')));
  assert.ok(r.writes.filter(w=>w.table==='cxroute_messages'&&w.body.direction==='outbound').every(w=>w.body.author_type==='system'));
 }
});
test('ambiguous future question never drafts the current price',async()=>{
 const r=await exercise('What will it cost next November?',[price]);
 assert.equal(r.body.needsHuman,true);assert.equal(r.body.knowledgeGapId,'qa-gap');
 assert.ok(!r.writes.some(w=>w.table==='cxroute_ai_drafts'));assert.ok(!r.calls.some(c=>c.name.startsWith('cxroute_search_approved_facts')));
});
