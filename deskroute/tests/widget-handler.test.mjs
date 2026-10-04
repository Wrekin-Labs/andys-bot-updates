// Run the real Edge handler against in-memory database/provider adapters. No network or live records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {canSendAutomatically} from '../backend/answer-policy.js';
import {literalGroundingCheck} from '../backend/literal-grounding.js';
import {SENSITIVE_TOPICS,sensitiveTopic,sensitiveTopicFromTags} from '../backend/sensitive-topics.js';
import {holdingCopy} from '../backend/holding-copy.js';
import {questionDate,datedKnowledge} from '../backend/dated-knowledge.js';

const visitorToken='qa-secret-token';
const visitorTokenHash=createHash('sha256').update(visitorToken).digest('hex');
const handlerSource=await readFile(new URL('../backend/cxroute-widget-chat.ts',import.meta.url),'utf8');
const source=stripTypeScriptTypes(handlerSource.replace(/^import .*;\s*$/gm,''));

function assertInjected(sourceText,context){
 const names=[...sourceText.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g)]
  .flatMap(m=>m[1].split(','))
  .map(s=>s.trim().split(/\s+as\s+/).pop())
  .filter(Boolean);
 const missing=names.filter(name=>!(name in context));
 if(missing.length)throw new Error('widget-handler harness missing injections: '+missing.join(', '));
}

async function exercise(question,facts,{provider='absent',reply,datedFacts=[],knowledgeFacts=datedFacts,assigned=true,budgetAllowed=true,budgetResult=null,conversationTags=[],conversationPriority='normal',rawBody=null,explode=false,expectedStatus=200,legacyUnsecured=false,visitorRateCount=1,ipRateCount=1,globalRateCount=1,isOpen=null}={}){
 const writes=[],calls=[];let handler,providerCalls=0;
 const conversation={id:'qa-conversation',brand_id:'qa-brand',assigned_user_id:assigned?'qa-agent':null,tags:conversationTags,priority:conversationPriority,visitor_token_hash:legacyUnsecured?null:visitorTokenHash};
 const records={
  cxroute_knowledge_facts:knowledgeFacts,
  cxroute_widget_configs:{id:'qa-widget',organisation_id:'qa-org',brand_id:'qa-brand',enabled:true,allowed_origins:['https://release.example'],offline_message:'We are closed right now. The team will reply when support reopens.'},
  cxroute_channel_ai_policies:{enabled:true,mode:'automatic',min_confidence:.9},
  cxroute_settings:{monthly_ai_call_hard_limit:10000},
  cxroute_conversations:conversation,
  cxroute_org_members:{user_id:'qa-agent',role:'owner'}
 };
 const admin={
  from(table){
   let operation='read',body;
   const query=new Proxy({}, {get(_,key){
    if(key==='then')return resolve=>{
      if(operation!=='read')writes.push({table,operation,body});
      resolve({data:operation==='read'?(records[table]??null):{id:table+'-fixture'},error:null});
    };
    return (...args)=>{if(['insert','update'].includes(key)){operation=key;body=args[0];}return query;};
   }});
   return query;
  },
  async rpc(name,p){
   calls.push({name,p});
   if(name==='cxroute_take_widget_rate_limit'){
    const bucket=String(p?.p_visitor_hash||'');
    if(bucket.startsWith('chat:visitor:'))return {data:visitorRateCount,error:null};
    if(bucket.startsWith('chat:ip:'))return {data:ipRateCount,error:null};
    if(bucket==='chat:global')return {data:globalRateCount,error:null};
    throw Error('Unexpected rate-limit bucket '+bucket);
   }
   if(name==='cxroute_is_open')return {data:isOpen,error:null};
   if(name==='cxroute_reserve_ai_call_v2')return {data:budgetResult??(budgetAllowed?'ok':'monthly'),error:null};
   if(name.startsWith('cxroute_search_approved_facts'))return {data:facts};
   if(name==='cxroute_record_knowledge_gap')return {data:'qa-gap'};
   throw Error('Unexpected RPC '+name);
  }
 };
 const context={
  Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEYS:'{"default":"test-only"}',OPENAI_API_KEY:provider==='absent'?undefined:'test-only'})[name]},serve:fn=>handler=fn},
  createClient:()=>{if(explode)throw Error('Fixture internal failure');return admin;},
  canSendAutomatically,
  literalGroundingCheck,
  SENSITIVE_TOPICS,
  sensitiveTopic,
  sensitiveTopicFromTags,
  holdingCopy,
  questionDate,
  datedKnowledge,
  crypto:webcrypto,
  TextEncoder,
  URL,
  Response,
  console,
  fetch:async()=>{
   providerCalls++;
   return provider==='failure'
    ?new Response('{"error":{"message":"Provider unavailable"}}',{status:503})
    :new Response(JSON.stringify({output_text:JSON.stringify(reply)}));
  }
 };
 assertInjected(handlerSource,context);
 runInNewContext(source,context);
 const response=await handler(new Request('https://fixture.invalid/widget',{
  method:'POST',
  headers:{Origin:'https://release.example','Content-Type':'application/json'},
  body:rawBody===null?JSON.stringify({widgetKey:'qa-key',conversationId:conversation.id,visitorToken,message:question}):rawBody
 }));
 assert.equal(response.status,expectedStatus);
 return {body:await response.json(),writes,calls,providerCalls};
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
test('AI budget exhaustion degrades to a safe approved fact without breaking chat',async()=>{const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};const r=await exercise('What is the price?',[price],{provider:'ready',reply,budgetAllowed:false});assert.equal(r.body.llmUsed,false);assert.equal(r.body.needsHuman,false);assert.equal(r.body.answer,price.fact_value);assert.ok(r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));const event=r.writes.find(w=>w.table==='cxroute_ai_events');assert.equal(event?.body?.outcome,'budget_exceeded');assert.equal(event?.body?.failed_gate,'budget_exceeded');});
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


test('sensitive safeguarding bypasses AI, learning gaps, and notification preview',async()=>{
 const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};
 const r=await exercise('I want to die',[price],{provider:'ready',reply,assigned:false});
 assert.equal(r.body.needsHuman,true);
 assert.equal(r.body.knowledgeGapId,null);
 assert.equal(r.providerCalls,0);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
 assert.ok(!r.calls.some(c=>c.name==='cxroute_record_knowledge_gap'));
 assert.ok(!r.writes.some(w=>w.table==='cxroute_ai_drafts'));
 assert.ok(!r.writes.some(w=>w.table==='cxroute_learning_suggestions'));
 const update=r.writes.find(w=>w.table==='cxroute_conversations'&&w.operation==='update'&&w.body.tags);
 assert.ok(update.body.tags.includes('sensitive-safeguarding'));
 assert.ok(update.body.tags.includes('ai-needs-human'));
 assert.equal(update.body.priority,'urgent');
 const notice=r.writes.find(w=>w.table==='cxroute_staff_notifications');
 assert.equal(notice.body.title,'Urgent: a customer may need support now');
 assert.equal(notice.body.body_preview,null);
 const event=r.writes.find(w=>w.table==='cxroute_ai_events');
 assert.equal(event.body.failed_gate,'sensitive_topic');
 assert.equal(Object.hasOwn(event.body,'message'),false);
 assert.match(r.body.answer,/emergency services|999/);
});

test('sensitive payment dispute never direct-fact replies and is high priority',async()=>{
 const r=await exercise('You charged me twice',[price],{provider:'absent',assigned:false});
 assert.equal(r.body.needsHuman,true);
 assert.notEqual(r.body.answer,price.fact_value);
 const update=r.writes.find(w=>w.table==='cxroute_conversations'&&w.operation==='update'&&w.body.tags);
 assert.equal(update.body.priority,'high');
 assert.ok(update.body.tags.includes('sensitive-payment_dispute'));
 assert.match(r.body.answer,/No changes have been made/);
});

test('sensitive status is sticky and never lowers an existing urgent priority',async()=>{
 const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};
 const r=await exercise('What is the current price?',[price],{
  provider:'ready',reply,assigned:false,
  conversationTags:['sensitive-legal'],
  conversationPriority:'urgent'
 });
 assert.equal(r.body.needsHuman,true);
 assert.equal(r.providerCalls,0);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
 assert.ok(!r.calls.some(c=>c.name==='cxroute_record_knowledge_gap'));
 const update=r.writes.find(w=>w.table==='cxroute_conversations'&&w.operation==='update'&&w.body.tags);
 assert.equal(update.body.priority,'urgent');
 assert.ok(update.body.tags.includes('sensitive-legal'));
});


test('malformed chat JSON stays a 400 validation error',async()=>{
 const r=await exercise('',[],{rawBody:'{',expectedStatus:400});
 assert.equal(r.body.error,'Invalid request');
});
test('unexpected chat exceptions surface as 500 internal errors',async()=>{
 const r=await exercise('Hello',[],{explode:true,expectedStatus:500});
 assert.equal(r.body.error,'Internal error');
});


test('legacy unsecured chat conversation cannot be claimed by conversation id',async()=>{
 const r=await exercise('Hello',[],{legacyUnsecured:true,expectedStatus:403});
 assert.equal(r.body.reset,true);
 assert.equal(r.body.error,'Conversation access denied');
});


test('chat rate limiting uses separate visitor, IP and global buckets',async()=>{
 const r=await exercise('Is a lift available?',[]);
 const buckets=r.calls
  .filter(c=>c.name==='cxroute_take_widget_rate_limit')
  .map(c=>String(c.p.p_visitor_hash));
 assert.equal(buckets.length,3);
 assert.ok(buckets.some(x=>x.startsWith('chat:visitor:')));
 assert.ok(buckets.some(x=>x.startsWith('chat:ip:')));
 assert.ok(buckets.includes('chat:global'));
});

test('visitor chat abuse is rate limited without reaching AI',async()=>{
 const r=await exercise('What is the price?',[price],{
  provider:'ready',
  visitorRateCount:31,
  expectedStatus:429
 });
 assert.match(r.body.error,/Too many messages/);
 assert.equal(r.providerCalls,0);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
});

test('rotating user agent cannot bypass the per-IP chat limit',async()=>{
 const r=await exercise('What is the price?',[price],{
  provider:'ready',
  ipRateCount:121,
  expectedStatus:429
 });
 assert.match(r.body.error,/Too many messages/);
 assert.equal(r.providerCalls,0);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
});

test('global traffic guard keeps chat available and suppresses paid AI',async()=>{
 const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};
 const r=await exercise('What is the price?',[price],{
  provider:'ready',
  reply,
  globalRateCount:301
 });
 assert.equal(r.body.needsHuman,false);
 assert.equal(r.body.answer,price.fact_value);
 assert.equal(r.providerCalls,0);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
 const event=r.writes.find(w=>w.table==='cxroute_ai_events');
 assert.equal(event.body.failed_gate,'rate_guard');
 assert.equal(event.body.error_code,'global_rate_guard');
 assert.ok(r.writes.some(w=>w.table==='cxroute_audit_log'&&w.body.action==='widget_global_ai_guard'));
});

test('global traffic guard hands unknown questions to a person without teaching the flood',async()=>{
 const r=await exercise('Can you tell me the secret back door width?',[],{
  provider:'ready',
  globalRateCount:350
 });
 assert.equal(r.body.needsHuman,true);
 assert.equal(r.providerCalls,0);
 assert.equal(r.body.knowledgeGapId,null);
 assert.ok(!r.calls.some(c=>c.name==='cxroute_reserve_ai_call_v2'));
 assert.ok(!r.calls.some(c=>c.name==='cxroute_record_knowledge_gap'));
 assert.ok(r.writes.some(w=>w.table==='cxroute_staff_notifications'));
});


test('daily AI cap degrades to a safe direct fact and records the reason',async()=>{
 const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};
 const r=await exercise('What is the price?',[price],{provider:'ready',reply,budgetResult:'daily'});
 assert.equal(r.body.needsHuman,false);
 assert.equal(r.body.answer,price.fact_value);
 assert.equal(r.providerCalls,0);
 const call=r.calls.find(c=>c.name==='cxroute_reserve_ai_call_v2');
 assert.equal(call.p.p_conversation_id,'qa-conversation');
 const event=r.writes.find(w=>w.table==='cxroute_ai_events');
 assert.equal(event.body.outcome,'budget_exceeded');
 assert.equal(event.body.failed_gate,'budget_exceeded');
 assert.equal(event.body.error_code,'budget_daily');
});

test('per-conversation AI cap degrades without another provider call',async()=>{
 const reply={answer:price.fact_value,grounded:true,needs_human:false,confidence:.99,used_fact_ids:['price']};
 const r=await exercise('What is the price?',[price],{provider:'ready',reply,budgetResult:'conversation'});
 assert.equal(r.body.needsHuman,false);
 assert.equal(r.body.answer,price.fact_value);
 assert.equal(r.providerCalls,0);
 const event=r.writes.find(w=>w.table==='cxroute_ai_events');
 assert.equal(event.body.error_code,'budget_conversation');
});


test('closed-hours human handoff uses the configured offline message',async()=>{
 const r=await exercise('Is there somewhere to park?',[],{isOpen:false});
 assert.equal(r.body.needsHuman,true);
 assert.equal(r.body.answer,'We are closed right now. The team will reply when support reopens.');
 assert.ok(r.calls.some(c=>c.name==='cxroute_is_open'));
});
