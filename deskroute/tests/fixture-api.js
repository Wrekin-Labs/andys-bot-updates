// Synthetic preview data only. This adapter makes no network calls.
export const VERSION='6.1.0-rc.1 · DEMO';
const id=n=>`e6100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(10),brand=id(20),owner=id(1),agent=id(2),now=new Date().toISOString();
const row=(n,data)=>({id:id(n),organisation_id:org,brand_id:brand,created_at:new Date(Date.now()+n).toISOString(),updated_at:now,...data});
const db={
 brands:[row(20,{name:'North & Co · Demo',enabled:true,is_default:true,website_url:'https://example.com',support_email:'team@example.com'})],
 contacts:[row(31,{name:'Alex Morgan',email:'alex@example.com'}),row(32,{name:'Sam Patel',email:'sam@example.com'}),row(33,{name:'Taylor Green',email:'taylor@example.com'})],
 conversations:[row(41,{contact_id:id(31),channel:'website_chat',subject:'Can we arrange a booking outside normal hours?',status:'open',priority:'high',assigned_user_id:owner,tags:['ai-needs-human'],unread_count:1}),row(42,{contact_id:id(32),channel:'website_chat',subject:'What is your cancellation policy?',status:'pending',priority:'normal',assigned_user_id:agent,tags:[],unread_count:0}),row(43,{contact_id:id(33),channel:'email',subject:'Please update my booking details',status:'open',priority:'normal',tags:[],unread_count:0})],
 messages:[row(51,{conversation_id:id(41),body:'Can we arrange a booking outside your normal opening hours?',direction:'inbound',author_type:'customer'}),row(52,{conversation_id:id(41),body:'I’ll pass this to our team so they can check the options for you.',direction:'outbound',author_type:'ai'}),row(53,{conversation_id:id(41),body:'Please check availability before making a promise.',direction:'internal',author_type:'agent'}),row(54,{conversation_id:id(42),body:'What is your cancellation policy?',direction:'inbound',author_type:'customer'})],
 knowledge_facts:[row(61,{fact_key:'Opening hours',fact_value:'Monday to Friday, 09:00–17:00.',category:'hours',confidence:.98,review_status:'approved',source_label:'Website'}),row(62,{fact_key:'Cancellation policy',fact_value:'Please contact the team to discuss changes to your booking.',category:'policy',confidence:.95,review_status:'pending',source_label:'Website scan'})],
 knowledge_gaps:[row(63,{example_question:'Can we book outside normal hours?',reason:'No approved policy',status:'open',occurrences:3})],
 learning_suggestions:[row(64,{question:'Where can I find booking details?',proposed_answer:'Your booking confirmation contains the details. Contact the team if you need another copy.',status:'pending'})],
 routing_rules:[row(65,{name:'Route urgent website questions',enabled:false,sort_order:10,trigger_type:'inbound_message',conditions:{channel:'website_chat',body_contains:'urgent'},actions:{priority:'high',assigned_user_id:owner},stop_processing:false})],
 widget_configs:[row(66,{display_name:'Demo website',enabled:true,allowed_origins:['https://example.com'],public_key:'demo-only-no-live-widget'})],email_accounts:[],whatsapp_accounts:[],telegram_accounts:[],x_accounts:[],
 help_centers:[row(67,{title:'North & Co Help',subtitle:'Practical answers from the team',enabled:false,public_key:'demo-only-help-centre'})],
 help_articles:[row(68,{title:'How to manage your booking',slug:'manage-your-booking',body:'Contact our team with your booking reference. We will check the available options.',category:'Bookings',published:false,help_center_id:id(67),sort_order:0})],
 notification_preferences:[row(69,{user_id:owner,new_message:false,assignment:true,sla_breach:true,urgent_only:false})],
 staff_devices:[row(70,{user_id:owner,device_name:'Demo browser',platform:'web',last_seen_at:now,enabled:true,notification_mode:'poll'})],
 ai_drafts:[row(71,{conversation_id:id(41),proposed_reply:'Thanks for asking. I’m checking availability with the team and will update you here.',status:'pending',confidence:.75})],
 autosetup_runs:[row(72,{website_url:'https://example.com',scan_status:'completed',facts_proposed:2,detected_platform:'Website'})],subscriptions:[row(73,{plan_code:'pilot',status:'pilot'})],plans:[{code:'pilot',name:'Pilot',seat_limit:3,brand_limit:1,monthly_conversation_limit:100,monthly_ai_draft_limit:100}],
 audit_log:[row(74,{actor_type:'user',action:'internal_note_added',entity_type:'conversation'})],settings:[row(75,{ai_mode:'approve',auto_answer_min_confidence:.9})]
};
const notifications=[row(80,{title:'A customer needs your help',body_preview:'A question about booking outside normal hours.',conversation_id:id(41),read_at:null})];
const copy=x=>structuredClone(x);
const workspaces=[{id:org,name:'North & Co · DEMO',display_name:'Jamie',role:'owner',profile:{display_name:'North & Co · DEMO',timezone:'Europe/London'},settings:{ai_mode:'approve',auto_answer_min_confidence:.9}}];
const members=[{user_id:owner,display_name:'Jamie Ellis',role:'owner',assigned_count:1,last_seen_at:now},{user_id:agent,display_name:'Riley Chen',role:'agent',assigned_count:1,last_seen_at:now}];
function select(name,filters={}){return (db[name.replace('cxroute_','')]||[]).filter(r=>Object.entries(filters).every(([k,v])=>!String(v).startsWith('eq.')||String(r[k])===String(v).slice(3)));}
export class DeskRouteAPI {
 constructor(){this.session={user:{id:owner}};}
 clear(){this.session=null;}changeContext(){}
 async login(){this.session={user:{id:owner}};return this.session;}
 async logout(){this.clear();}
 async table(name,filters={},options={}){const key=name.replace('cxroute_','');db[key]??=[];if(options.method==='POST'){db[key].push(row(Math.floor(Math.random()*100000)+100,options.body));return null;}let result=select(name,filters);if(filters.order){const [field,direction]=filters.order.split(',')[0].split('.');result=[...result].sort((a,b)=>String(a[field]??'').localeCompare(String(b[field]??''))*(direction==='desc'?-1:1));}if(filters.limit)result=result.slice(0,Number(filters.limit));return copy(result);}
 async patch(name,organisationId,itemId,body,extra={}){const matches=select(name,{organisation_id:'eq.'+organisationId,...(itemId?{id:'eq.'+itemId}:{}),...extra});if(!matches.length)throw new Error('Nothing was changed. Refresh and try again.');matches.forEach(r=>Object.assign(r,body));return copy(matches);}
 async rpc(name,p){if(name==='cxroute_has_permission')return true;if(name==='cxroute_team_directory')return {members:copy(members)};if(name==='cxroute_business_brain_readiness')return {readiness_score:75,coverage_score:80,open_gaps:1,required_topics:['hours','pricing','services','policy','contact'],present_topics:['hours','services','policy','contact']};
 if(name==='cxroute_approve_learning_suggestion'){const s=db.learning_suggestions.find(s=>s.id===p.p_suggestion_id);s.status='approved';return {ok:true};}
 if(name==='cxroute_send_website_reply'){const previous=db.messages.find(m=>m.safe_metadata?.client_request_id===p.p_client_id);if(previous)return {ok:true,replayed:true};db.messages.push(row(100+db.messages.length,{conversation_id:p.p_conversation_id,direction:'outbound',author_type:'agent',body:p.p_body,safe_metadata:{client_request_id:p.p_client_id}}));if(p.p_draft_id)db.ai_drafts.find(d=>d.id===p.p_draft_id).status='sent';return {ok:true,delivery:'available_in_widget'};}
 if(name==='cxroute_add_internal_note'){const message=row(100+db.messages.length,{conversation_id:p.p_conversation_id,direction:'internal',author_type:'agent',body:p.p_body});db.messages.push(message);return message.id;}
 throw new Error('Demo does not implement '+name);}
 async onboard(action,organisationId,p={}){if(action==='me')return {workspaces:copy(workspaces)};if(action==='register_device')return {device:db.staff_devices[0]};if(action==='device_heartbeat')return {ok:true};if(action==='notifications')return {notifications:copy(notifications),unread:notifications.filter(n=>!n.read_at).length};if(action==='mark_notification_read'){notifications.find(n=>n.id===p.notificationId).read_at=new Date().toISOString();return {ok:true};}if(action==='analytics')return {analytics:{conversations:3,ai_containment_rate:50,human_queue:1,open_knowledge_gaps:1,human_replies:2,resolved_conversations:0,avg_first_response_minutes:4,pending_ai_drafts:db.ai_drafts.filter(d=>d.status==='pending').length}};throw new Error('Demo action unavailable');}
 async edge(name,p){if(name==='cxroute-website-scan'){db.knowledge_facts.push(row(90,{fact_key:'Scanned demo fact',fact_value:'Synthetic information for interface testing only.',category:'faq',confidence:.95,review_status:'pending',source_label:'Demo scan'}));return {factsProposed:1};}throw new Error('Demo makes no network requests');}
 async request(){return {title:'North & Co Help · DEMO',articles:copy(db.help_articles.filter(a=>a.published))};}
}

export function injectDemoMessage(body){db.messages.push(row(500,{conversation_id:id(41),body,direction:"inbound",author_type:"customer"}));}
