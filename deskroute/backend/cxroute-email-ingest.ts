
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import { isAllowedPushEndpoint, buildPushPayload, classifyPushResult, retryDelayMs } from "./push-dispatch.js";
import { verifyStripeSignature, isUuid, stripeTimestamp, invoiceSubscriptionId, mapStripeSubscriptionStatus } from "./stripe-webhook.js";

type Body={
  organisationId?:string;emailAccountId?:string;externalEventId?:string;providerThreadId?:string;
  providerMessageId?:string;internetMessageId?:string;inReplyTo?:string;referencesHeader?:string;
  fromEmail?:string;fromName?:string;subject?:string;text?:string;receivedAt?:string;
};
function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}


async function ensureVapid(admin:any){
  const read=async(name:string)=>{
    const r=await admin.rpc("cxroute_worker_get_secret",{p_name:name});
    return r.error?null:String(r.data||"").trim()||null;
  };
  let publicKey=await read("deskroute-vapid-public");
  let privateKey=await read("deskroute-vapid-private");
  if(!publicKey||!privateKey){
    const generated=webpush.generateVAPIDKeys();
    publicKey=generated.publicKey;
    privateKey=generated.privateKey;
    await admin.rpc("cxroute_worker_store_secret",{
      p_name:"deskroute-vapid-public",
      p_value:publicKey,
      p_description:"DeskRoute Web Push public VAPID key"
    });
    await admin.rpc("cxroute_worker_store_secret",{
      p_name:"deskroute-vapid-private",
      p_value:privateKey,
      p_description:"DeskRoute Web Push private VAPID key"
    });
  }
  return {publicKey,privateKey};
}

async function dispatchPush(admin:any,row:any,vapid:any){
  const sub=row.push_subscription||{};
  const endpoint=String(sub.endpoint||"");
  const notificationId=String(row.notification_id||"");
  const deviceId=String(row.device_id||"");
  const now=new Date().toISOString();

  if(!endpoint||!isAllowedPushEndpoint(endpoint)||!sub?.keys?.p256dh||!sub?.keys?.auth){
    await admin.from("cxroute_notification_receipts")
      .update({delivery_status:"failed",last_error:"Invalid push subscription",updated_at:now})
      .eq("notification_id",notificationId).eq("device_id",deviceId);
    await admin.from("cxroute_staff_devices")
      .update({enabled:false,push_disabled_reason:"invalid_subscription",updated_at:now})
      .eq("id",deviceId);
    return "failed";
  }

  webpush.setVapidDetails("mailto:info@thesmashroom.co.uk",vapid.publicKey,vapid.privateKey);
  const payload=buildPushPayload(row);

  try{
    const response=await webpush.sendNotification(sub,payload,{TTL:3600,urgency:"high"});
    const status=Number(response?.statusCode||201);
    await admin.from("cxroute_notification_receipts")
      .update({
        delivery_status:"delivered",
        delivered_at:now,
        response_code:status,
        last_error:null,
        next_attempt_at:null,
        updated_at:now
      })
      .eq("notification_id",notificationId).eq("device_id",deviceId);
    await admin.from("cxroute_staff_devices")
      .update({
        push_failure_count:0,
        push_last_success_at:now,
        push_disabled_reason:null,
        updated_at:now
      })
      .eq("id",deviceId);
    return "delivered";
  }catch(error){
    const status=Number((error as any)?.statusCode||0);
    const attempts=Number(row.attempts||1);
    const result=classifyPushResult(status,attempts);
    const lastError=String((error as any)?.message||"Push delivery failed").slice(0,300);

    await admin.from("cxroute_notification_receipts")
      .update({
        delivery_status:result.state,
        response_code:status||null,
        last_error:lastError,
        next_attempt_at:result.terminal?null:new Date(Date.now()+retryDelayMs(attempts)).toISOString(),
        updated_at:now
      })
      .eq("notification_id",notificationId).eq("device_id",deviceId);

    await admin.from("cxroute_staff_devices")
      .update({
        push_failure_count:attempts,
        ...(result.disableDevice
          ?{enabled:false,push_disabled_reason:"expired"}
          :{}),
        updated_at:now
      })
      .eq("id",deviceId);

    return result.state==="delivered"?"delivered":result.terminal?"failed":"retry";
  }
}


async function handleStripeWebhook(req:Request,admin:any){
  const raw=await req.text();
  const signature=req.headers.get("stripe-signature")||"";

  let event:any;
  try{event=JSON.parse(raw);}catch{return json({error:"Invalid payload"},400);}
  const secretName=Boolean(event?.livemode)
    ?"deskroute-stripe-live-webhook-secret"
    :"deskroute-stripe-test-webhook-secret";
  const secretResult=await admin.rpc("cxroute_billing_get_secret",{p_name:secretName});
  const webhookSecret=secretResult.error?null:String(secretResult.data||"");
  if(!webhookSecret) return json({error:"Webhook not configured"},503);
  if(!(await verifyStripeSignature(raw,signature,webhookSecret))) return json({error:"Invalid signature"},400);

  const eventId=String(event?.id||"");
  const eventType=String(event?.type||"");
  if(!eventId||!eventType) return json({error:"Invalid event"},400);

  const existing=await admin.from("cxroute_billing_events").select("event_id").eq("event_id",eventId).maybeSingle();
  if(existing.data) return json({ok:true,duplicate:true});

  const object=event?.data?.object||{};
  let organisationId:string|null=null;
  let subscriptionId:string|null=null;

  if(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(eventType)){
    organisationId=isUuid(object?.client_reference_id)?String(object.client_reference_id):null;
    subscriptionId=typeof object?.subscription==="string"?object.subscription:null;
    const planCode=String(object?.metadata?.deskroute_plan_code||"");
    if(organisationId&&planCode&&["starter","growth","pro","beta"].includes(planCode)){
      const paid=["paid","no_payment_required"].includes(String(object?.payment_status||""));
      await admin.from("cxroute_subscriptions").upsert({
        organisation_id:organisationId,
        plan_code:planCode,
        status:paid?"active":"past_due",
        billing_provider:"stripe",
        external_customer_id:typeof object?.customer==="string"?object.customer:null,
        external_subscription_id:subscriptionId,
        updated_at:new Date().toISOString()
      },{onConflict:"organisation_id"});
    }
  }

  if(eventType.startsWith("customer.subscription.")){
    subscriptionId=typeof object?.id==="string"?object.id:null;
    if(subscriptionId){
      const update:any={
        status:mapStripeSubscriptionStatus(object?.status),
        current_period_start:stripeTimestamp(object?.current_period_start),
        current_period_end:stripeTimestamp(object?.current_period_end),
        cancel_at_period_end:Boolean(object?.cancel_at_period_end),
        updated_at:new Date().toISOString()
      };
      const planCode=String(object?.metadata?.deskroute_plan_code||"");
      if(["starter","growth","pro","beta"].includes(planCode)) update.plan_code=planCode;
      await admin.from("cxroute_subscriptions").update(update).eq("external_subscription_id",subscriptionId);
    }
  }

  if(eventType==="invoice.paid"||eventType==="invoice.payment_failed"){
    subscriptionId=invoiceSubscriptionId(object);
    if(subscriptionId){
      await admin.from("cxroute_subscriptions")
        .update({status:eventType==="invoice.paid"?"active":"past_due",updated_at:new Date().toISOString()})
        .eq("external_subscription_id",subscriptionId);
    }
  }

  await admin.from("cxroute_billing_events").insert({
    event_id:eventId,
    event_type:eventType,
    livemode:Boolean(event?.livemode),
    safe_metadata:{organisation_id:organisationId,subscription_id:subscriptionId}
  });
  return json({ok:true});
}

Deno.serve(async(req:Request)=>{
  if(req.method==="POST"&&req.headers.has("stripe-signature")){
    const serviceKey=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"];
    const url=Deno.env.get("SUPABASE_URL");
    if(!url||!serviceKey) return json({error:"Server configuration unavailable"},503);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    return handleStripeWebhook(req,admin);
  }
  const preview=await req.clone().json().catch(()=>null) as any;
  const expected=Deno.env.get("CXROUTE_EMAIL_INGEST_TOKEN");
  const supplied=req.headers.get("x-cxroute-ingest-token");
  if(req.method==="POST"&&(
    preview?.action==="cxroute_internal_push_dispatch_v1"||
    preview?.action==="cxroute_internal_push_init_v1"
  )){
    const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"];
    const url=Deno.env.get("SUPABASE_URL");
    if(!url||!secret) return json({error:"Server configuration unavailable"},503);
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    if(preview?.action==="cxroute_internal_push_dispatch_v1"){
      const worker=await admin.rpc("cxroute_worker_get_secret",{p_name:"deskroute-worker-secret"});
      const storedToken=worker.error?"":String(worker.data||"");
      const authorised=Boolean(supplied)&&(
        (Boolean(expected)&&supplied===expected)||
        (Boolean(storedToken)&&supplied===storedToken)
      );
      if(!authorised) return json({error:"Unauthorised"},401);
    }

    const vapid=await ensureVapid(admin);

    if(preview.action==="cxroute_internal_push_init_v1"){
      if(expected){
        await admin.rpc("cxroute_worker_store_secret",{
          p_name:"deskroute-worker-secret",
          p_value:expected,
          p_description:"DeskRoute internal notification worker token"
        });
      }
      return json({ok:true,vapidPublicKey:vapid.publicKey},200);
    }

    const claim=await admin.rpc("cxroute_claim_push_receipts",{p_limit:50});
    if(claim.error) return json({error:"Could not claim notifications"},500);
    const rows=Array.isArray(claim.data)?claim.data:[];
    const counts={delivered:0,retry:0,failed:0};
    for(const row of rows){
      const state=await dispatchPush(admin,row,vapid);
      counts[state as keyof typeof counts]++;
    }
    return json({ok:true,claimed:rows.length,...counts},200);
  }

  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  if(!expected||!supplied||supplied!==expected) return json({error:"Unauthorised"},401);

  try{
    const body=await req.json() as Body;
    const organisationId=String(body.organisationId||"").trim();
    const emailAccountId=String(body.emailAccountId||"").trim();
    const externalEventId=String(body.externalEventId||"").trim();
    const providerMessageId=String(body.providerMessageId||"").trim()||null;
    const internetMessageId=String(body.internetMessageId||"").trim();
    const fromEmail=String(body.fromEmail||"").trim().toLowerCase();
    const subject=String(body.subject||"").trim().slice(0,500);
    const text=String(body.text||"").trim().slice(0,20000);

    if(!organisationId||!emailAccountId||!externalEventId||!internetMessageId||!fromEmail||!text)
      return json({error:"Missing required email fields"},400);

    const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"];
    const url=Deno.env.get("SUPABASE_URL");
    if(!url||!secret) return json({error:"Server configuration unavailable"},503);
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:account}=await admin.from("cxroute_email_accounts")
      .select("id,organisation_id,brand_id,provider,email_address,status")
      .eq("id",emailAccountId).eq("organisation_id",organisationId).maybeSingle();
    if(!account||account.status!=="connected") return json({error:"Email account is not connected"},404);

    const {data:existingEvent}=await admin.from("cxroute_email_events").select("id")
      .eq("email_account_id",emailAccountId).eq("external_event_id",externalEventId).maybeSingle();
    if(existingEvent) return json({ok:true,duplicate:true},200);

    const {data:existingMessage}=await admin.from("cxroute_email_links").select("conversation_id")
      .eq("email_account_id",emailAccountId).eq("internet_message_id",internetMessageId).maybeSingle();
    if(existingMessage){
      await admin.from("cxroute_email_events").insert({
        organisation_id:organisationId,email_account_id:emailAccountId,
        external_event_id:externalEventId,event_type:"duplicate_message"
      });
      return json({ok:true,duplicate:true,conversationId:existingMessage.conversation_id},200);
    }

    let contactId="";
    const {data:contact}=await admin.from("cxroute_contacts").select("id")
      .eq("organisation_id",organisationId).eq("email",fromEmail).maybeSingle();
    if(contact) contactId=contact.id;
    else{
      const created=await admin.from("cxroute_contacts").insert({
        organisation_id:organisationId,name:String(body.fromName||"").trim()||fromEmail,email:fromEmail
      }).select("id").single();
      if(created.error||!created.data) return json({error:"Could not create contact"},500);
      contactId=created.data.id;
    }

    let conversationId="";
    const providerThreadId=String(body.providerThreadId||"").trim();
    if(providerThreadId){
      const {data:thread}=await admin.from("cxroute_email_links").select("conversation_id")
        .eq("email_account_id",emailAccountId).eq("provider_thread_id",providerThreadId)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(thread) conversationId=thread.conversation_id;
    }

    if(!conversationId){
      const created=await admin.from("cxroute_conversations").insert({
        organisation_id:organisationId,
        brand_id:account.brand_id||null,
        contact_id:contactId,
        channel:"email",
        subject:subject||"(no subject)",
        status:"open"
      }).select("id").single();
      if(created.error||!created.data) return json({error:"Could not create conversation"},500);
      conversationId=created.data.id;
    }

    const inbound=await admin.from("cxroute_messages").insert({
      organisation_id:organisationId,conversation_id:conversationId,direction:"inbound",
      body:text,author_type:"customer",external_message_id:internetMessageId,
      created_at:body.receivedAt?new Date(String(body.receivedAt)).toISOString():new Date().toISOString()
    }).select("id").single();
    if(inbound.error||!inbound.data) return json({error:"Could not save message"},500);

    await admin.from("cxroute_email_links").insert({
      organisation_id:organisationId,email_account_id:emailAccountId,conversation_id:conversationId,
      provider_thread_id:providerThreadId||null,provider_message_id:providerMessageId,
      internet_message_id:internetMessageId,
      in_reply_to:body.inReplyTo?String(body.inReplyTo):null,
      references_header:body.referencesHeader?String(body.referencesHeader):null
    });

    await admin.from("cxroute_email_events").insert({
      organisation_id:organisationId,email_account_id:emailAccountId,
      external_event_id:externalEventId,event_type:"message_received"
    });

    const {data:matches}=await admin.rpc("cxroute_search_approved_facts",{
      p_organisation_id:organisationId,p_query:`${subject}\n${text}`,p_limit:5
    });
    const best=Array.isArray(matches)&&matches.length?matches[0]:null;
    const relevance=Number(best?.relevance??0);

    let draftId:string|null=null;
    if(best&&relevance>=0.015){
      const draft=await admin.from("cxroute_ai_drafts").insert({
        organisation_id:organisationId,conversation_id:conversationId,inbound_message_id:inbound.data.id,
        proposed_reply:String(best.fact_value),confidence:Number(best.confidence||0),
        knowledge_fact_ids:[best.id],status:"pending"
      }).select("id").single();
      draftId=draft.data?.id??null;
    }

    await admin.from("cxroute_conversations").update({updated_at:new Date().toISOString()}).eq("id",conversationId);
    await admin.from("cxroute_audit_log").insert({
      organisation_id:organisationId,actor_type:"connector",action:"email_received",
      entity_type:"conversation",entity_id:conversationId,
      safe_metadata:{provider:account.provider,brand_id:account.brand_id||null,draft_created:Boolean(draftId),relevance}
    });

    return json({ok:true,duplicate:false,conversationId,messageId:inbound.data.id,draftId,provider:account.provider},201);
  }catch(error){
    return json({error:error instanceof Error?error.message:"Email ingest failed"},400);
  }
});
