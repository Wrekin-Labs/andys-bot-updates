
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";
import { isAllowedPushEndpoint } from "./push-dispatch.js";

type Body = {
  action?: "create"|"me"|"health"|"notifications"|"register_device"|"device_heartbeat"|"mark_notification_read"|"analytics"|"push_config"|"test_push";
  displayName?: string;
  websiteUrl?: string;
  supportEmail?: string;
  industry?: string;
  timezone?: string;
  aiMode?: "suggest"|"approve"|"automatic";
  planCode?: "starter"|"growth"|"pro";
  organisationId?: string;
  brandId?: string;
  installationId?: string;
  deviceName?: string;
  platform?: "web"|"android"|"ios"|"windows"|"macos"|"linux";
  appVersion?: string;
  notificationMode?: "poll"|"webpush"|"fcm"|"apns";
  pushToken?: string;
  pushSubscription?: Record<string,unknown>;
  deviceId?: string;
  notificationId?: string;
  days?: number;
};

Deno.serve(withSupabase({ auth:"user" }, async (req, ctx) => {
  if (req.method !== "POST") return Response.json({error:"Method not allowed"},{status:405});

  const body = await req.json().catch(()=>null) as Body|null;
  const action = String(body?.action || "create");
  // withSupabase exposes the verified JWT subject as userClaims.id.
  const userId = ctx.userClaims?.id;
  if (!userId) return Response.json({error:"Unauthorised"},{status:401});

  if (action === "me") {
    const { data: memberships, error } = await ctx.supabase
      .from("cxroute_org_members")
      .select("organisation_id,role,member_email,display_name,created_at")
      .eq("user_id",userId)
      .order("created_at",{ascending:true});

    if (error) return Response.json({error:"Could not load workspaces"},{status:500});
    const ids=(memberships||[]).map((m:any)=>m.organisation_id);
    if(!ids.length) return Response.json({workspaces:[]});

    const [{data:orgs},{data:profiles},{data:settings},{data:widgets},{data:emailAccounts},{data:socialAccounts}] = await Promise.all([
      ctx.supabase.from("cxroute_organisations").select("id,name,created_at").in("id",ids),
      ctx.supabase.from("cxroute_business_profiles").select("organisation_id,display_name,website_url,support_email,industry,timezone").in("organisation_id",ids),
      ctx.supabase.from("cxroute_settings").select("organisation_id,ai_mode,auto_answer_min_confidence").in("organisation_id",ids),
      ctx.supabase.from("cxroute_widget_configs").select("organisation_id,id,public_key,display_name,enabled,allowed_origins").in("organisation_id",ids),
      ctx.supabase.from("cxroute_email_accounts").select("organisation_id,id,provider,email_address,status").in("organisation_id",ids),
      ctx.supabase.from("cxroute_social_accounts").select("organisation_id,id,provider,profile_url,status,knowledge_enabled,messaging_enabled").in("organisation_id",ids)
    ]);

    const byId=new Map<string,any>();
    for(const id of ids) byId.set(id,{id,emailAccounts:[],socialAccounts:[],widgets:[]});
    for(const m of memberships||[]) Object.assign(byId.get(m.organisation_id),{role:m.role,member_email:m.member_email,display_name:m.display_name});
    for(const o of orgs||[]) Object.assign(byId.get(o.id),{name:o.name,created_at:o.created_at});
    for(const p of profiles||[]) Object.assign(byId.get(p.organisation_id),{profile:p});
    for(const s of settings||[]) Object.assign(byId.get(s.organisation_id),{settings:s});
    for(const w of widgets||[]) byId.get(w.organisation_id)?.widgets.push(w);
    for(const e of emailAccounts||[]) byId.get(e.organisation_id)?.emailAccounts.push(e);
    for(const s of socialAccounts||[]) byId.get(s.organisation_id)?.socialAccounts.push(s);

    return Response.json({workspaces:ids.map(id=>byId.get(id))});
  }


  if (action === "register_device") {
    const organisationId=String(body?.organisationId||"");
    const installationId=String(body?.installationId||"").trim();
    const platform=String(body?.platform||"").trim();
    const notificationMode=String(body?.notificationMode||"poll").trim();
    const allowedModes=["poll","webpush","fcm","apns"];
    const pushSubscription=(body?.pushSubscription&&typeof body.pushSubscription==="object") ? body.pushSubscription : {};
    const allowedPlatforms=["web","android","ios","windows","macos","linux"];

    if(notificationMode==="webpush"){
      const endpoint=String((pushSubscription as any)?.endpoint||"");
      const p256dh=String((pushSubscription as any)?.keys?.p256dh||"");
      const auth=String((pushSubscription as any)?.keys?.auth||"");
      if(!isAllowedPushEndpoint(endpoint)||!p256dh||!auth){
        return Response.json({error:"Invalid Web Push subscription"},{status:400});
      }
    }

    if(!organisationId||!installationId||!allowedPlatforms.includes(platform)||!allowedModes.includes(notificationMode)){
      return Response.json({error:"organisationId, installationId, platform and notification mode are required"},{status:400});
    }

    const {data:membership}=await ctx.supabase
      .from("cxroute_org_members")
      .select("role")
      .eq("organisation_id",organisationId)
      .eq("user_id",userId)
      .maybeSingle();

    if(!membership) return Response.json({error:"Not authorised"},{status:403});

    const row={
      organisation_id:organisationId,
      user_id:userId,
      installation_id:installationId.slice(0,200),
      device_name:String(body?.deviceName||"").trim().slice(0,160)||null,
      platform,
      app_version:String(body?.appVersion||"").trim().slice(0,80)||null,
      notification_mode:String(body?.notificationMode||"poll").trim(),
      push_token:String(body?.pushToken||"").trim().slice(0,4096)||null,
      push_subscription:(body?.pushSubscription&&typeof body.pushSubscription==="object")
        ?body.pushSubscription:{},
      enabled:true,
      last_seen_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    };

    const {data:device,error}=await ctx.supabase
      .from("cxroute_staff_devices")
      .upsert(row,{onConflict:"organisation_id,user_id,installation_id"})
      .select("id,organisation_id,user_id,installation_id,device_name,platform,app_version,notification_mode,enabled,last_seen_at")
      .single();

    if(error||!device) return Response.json({error:"Could not register device"},{status:500});
    return Response.json({ok:true,device});
  }

  if (action === "device_heartbeat") {
    const deviceId=String(body?.deviceId||"");
    if(!deviceId) return Response.json({error:"deviceId required"},{status:400});

    const {data:device,error}=await ctx.supabase
      .from("cxroute_staff_devices")
      .update({last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("id",deviceId)
      .eq("user_id",userId)
      .select("id,last_seen_at,enabled")
      .maybeSingle();

    if(error||!device) return Response.json({error:"Device not found"},{status:404});
    return Response.json({ok:true,device});
  }

  if (action === "push_config") {
    const organisationId=String(body?.organisationId||"");
    if(!organisationId) return Response.json({error:"organisationId required"},{status:400});

    const {data:membership}=await ctx.supabase
      .from("cxroute_org_members")
      .select("role")
      .eq("organisation_id",organisationId)
      .eq("user_id",userId)
      .maybeSingle();
    if(!membership) return Response.json({error:"Not authorised"},{status:403});

    const base=Deno.env.get("SUPABASE_URL");
    const workerToken=Deno.env.get("CXROUTE_EMAIL_INGEST_TOKEN");
    if(!base||!workerToken) return Response.json({error:"Push service is not configured"},{status:503});

    const response=await fetch(base+"/functions/v1/cxroute-email-ingest",{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "x-cxroute-ingest-token":workerToken
      },
      body:JSON.stringify({action:"cxroute_internal_push_init_v1"})
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.vapidPublicKey) return Response.json({error:"Push service is unavailable"},{status:503});
    return Response.json({ok:true,vapidPublicKey:String(data.vapidPublicKey)});
  }

  if (action === "test_push") {
    const organisationId=String(body?.organisationId||"");
    if(!organisationId) return Response.json({error:"organisationId required"},{status:400});

    const {data:membership}=await ctx.supabase
      .from("cxroute_org_members")
      .select("role")
      .eq("organisation_id",organisationId)
      .eq("user_id",userId)
      .maybeSingle();
    if(!membership) return Response.json({error:"Not authorised"},{status:403});

    const created=await ctx.supabaseAdmin
      .from("cxroute_staff_notifications")
      .insert({
        organisation_id:organisationId,
        user_id:userId,
        conversation_id:null,
        kind:"system",
        title:"DeskRoute test alert",
        body_preview:null
      })
      .select("id")
      .single();

    if(created.error||!created.data) return Response.json({error:"Could not create test alert"},{status:500});

    const base=Deno.env.get("SUPABASE_URL");
    if(base){
      try{
        EdgeRuntime.waitUntil(
          fetch(base+"/functions/v1/cxroute-email-ingest",{
            method:"POST",
            headers:{
              "content-type":"application/json",
              "x-cxroute-ingest-token":Deno.env.get("CXROUTE_EMAIL_INGEST_TOKEN")||""
            },
            body:JSON.stringify({action:"cxroute_internal_push_dispatch_v1"})
          }).catch(()=>null)
        );
      }catch{}
    }

    return Response.json({ok:true,notificationId:created.data.id});
  }

  if (action === "notifications") {
    const organisationId=String(body?.organisationId||"");
    if(!organisationId) return Response.json({error:"organisationId required"},{status:400});

    const {data:membership}=await ctx.supabase
      .from("cxroute_org_members")
      .select("role")
      .eq("organisation_id",organisationId)
      .eq("user_id",userId)
      .maybeSingle();

    if(!membership) return Response.json({error:"Not authorised"},{status:403});

    const {data:items,error}=await ctx.supabase
      .from("cxroute_staff_notifications")
      .select("id,conversation_id,kind,title,body_preview,read_at,created_at")
      .eq("organisation_id",organisationId)
      .eq("user_id",userId)
      .order("created_at",{ascending:false})
      .limit(100);

    if(error) return Response.json({error:"Could not load notifications"},{status:500});

    return Response.json({
      notifications:items||[],
      unread:(items||[]).filter((x:any)=>!x.read_at).length
    });
  }

  if (action === "mark_notification_read") {
    const notificationId=String(body?.notificationId||"");
    const deviceId=String(body?.deviceId||"");
    if(!notificationId) return Response.json({error:"notificationId required"},{status:400});

    const now=new Date().toISOString();
    const {data:item,error}=await ctx.supabase
      .from("cxroute_staff_notifications")
      .update({read_at:now})
      .eq("id",notificationId)
      .eq("user_id",userId)
      .select("id,conversation_id,read_at")
      .maybeSingle();

    if(error||!item) return Response.json({error:"Notification not found"},{status:404});

    if(deviceId){
      await ctx.supabase
        .from("cxroute_notification_receipts")
        .update({delivery_status:"opened",opened_at:now,updated_at:now})
        .eq("notification_id",notificationId)
        .eq("device_id",deviceId);
    }

    return Response.json({ok:true,notification:item});
  }

  if (action === "analytics") {
    const organisationId=String(body?.organisationId||"");
    const brandId=String(body?.brandId||"").trim()||null;
    const days=Math.max(1,Math.min(Number(body?.days||30),365));

    if(!organisationId) return Response.json({error:"organisationId required"},{status:400});

    const {data,error}=await ctx.supabase.rpc("cxroute_support_analytics",{
      p_organisation_id:organisationId,
      p_brand_id:brandId,
      p_days:days
    });

    if(error) return Response.json({error:"Could not load analytics"},{status:400});
    return Response.json({analytics:data});
  }

  if (action === "health") {
    const organisationId=String(body?.organisationId||"");
    if(!organisationId) return Response.json({error:"organisationId required"},{status:400});

    const {data:membership}=await ctx.supabase
      .from("cxroute_org_members")
      .select("role")
      .eq("organisation_id",organisationId)
      .maybeSingle();
    if(!membership) return Response.json({error:"Not authorised"},{status:403});

    const count=async(table:string,extra?:(q:any)=>any)=>{
      let q=ctx.supabase.from(table).select("*",{count:"exact",head:true}).eq("organisation_id",organisationId);
      if(extra) q=extra(q);
      const {count,error}=await q;
      return {count:count??0,ok:!error};
    };
    const adminCount=async(table:string,extra?:(q:any)=>any)=>{
      let q=ctx.supabaseAdmin.from(table).select("*",{count:"exact",head:true}).eq("organisation_id",organisationId);
      if(extra) q=extra(q);
      const {count,error}=await q;
      return {count:count??0,ok:!error};
    };

    const now=new Date().toISOString();
    const in24h=new Date(Date.now()+24*60*60*1000).toISOString();

    const [
      pendingFacts,pendingDrafts,knowledgeGaps,learningSuggestions,humanQueue,openConversations,sources,emailAccounts,
      unreadConversations,urgentConversations,firstResponseBreaches,resolutionBreaches,
      connectedEmailAccounts,connectedSocials,expiringConnectors,
      renewalDueConnectors,reauthConnectors,degradedConnectors,
      providerEventErrors,teamMembers,pendingTeamInvites
    ]=await Promise.all([
      count("cxroute_knowledge_facts",q=>q.eq("review_status","pending")),
      count("cxroute_ai_drafts",q=>q.eq("status","pending")),
      count("cxroute_knowledge_gaps",q=>q.eq("status","open")),
      count("cxroute_learning_suggestions",q=>q.eq("status","pending")),
      count("cxroute_conversations",q=>q.eq("assigned_user_id",userId).contains("tags",["ai-needs-human"]).in("status",["open","pending"])),
      count("cxroute_conversations",q=>q.in("status",["open","pending"])),
      count("cxroute_source_connections"),
      count("cxroute_email_accounts"),
      count("cxroute_conversations",q=>q.gt("unread_count",0).in("status",["open","pending"])),
      count("cxroute_conversations",q=>q.eq("priority","urgent").in("status",["open","pending"])),
      count("cxroute_conversations",q=>q.is("first_response_at",null).lt("first_response_due_at",now).in("status",["open","pending"])),
      count("cxroute_conversations",q=>q.lt("resolution_due_at",now).in("status",["open","pending"])),
      count("cxroute_email_accounts",q=>q.eq("status","connected")),
      count("cxroute_social_accounts",q=>q.eq("status","connected")),
      adminCount("cxroute_connector_sync_state",q=>q.not("expires_at","is",null).lt("expires_at",in24h)),
      adminCount("cxroute_connector_sync_state",q=>q.eq("state","renewal_due")),
      adminCount("cxroute_connector_sync_state",q=>q.eq("state","reauthorization_required")),
      adminCount("cxroute_connector_sync_state",q=>q.eq("state","degraded")),
      adminCount("cxroute_provider_events",q=>q.eq("status","error")),
      adminCount("cxroute_org_members"),
      adminCount("cxroute_team_invites",q=>q.eq("status","pending"))
    ]);

    const [{data:widgets,error:widgetError},{data:latestRun},{data:defaultBrand}] = await Promise.all([
      ctx.supabase.from("cxroute_widget_configs").select("id,enabled").eq("organisation_id",organisationId),
      ctx.supabase.from("cxroute_autosetup_runs")
        .select("id,website_url,detected_platform,platform_confidence,install_method,scan_status,widget_status,facts_proposed,socials_discovered,last_error,completed_at,created_at")
        .eq("organisation_id",organisationId)
        .order("created_at",{ascending:false})
        .limit(1)
        .maybeSingle(),
      ctx.supabase.from("cxroute_brands")
        .select("id,name,is_default")
        .eq("organisation_id",organisationId)
        .eq("enabled",true)
        .order("is_default",{ascending:false})
        .order("created_at",{ascending:true})
        .limit(1)
        .maybeSingle()
    ]);

    let businessBrainReadiness:any=null;
    if(defaultBrand?.id){
      const readiness=await ctx.supabase.rpc("cxroute_business_brain_readiness",{
        p_organisation_id:organisationId,
        p_brand_id:defaultBrand.id
      });
      if(!readiness.error){
        businessBrainReadiness={
          brandId:defaultBrand.id,
          brandName:defaultBrand.name,
          ...readiness.data
        };
      }
    }

    const checks={
      database:[
        pendingFacts,pendingDrafts,knowledgeGaps,learningSuggestions,humanQueue,openConversations,sources,emailAccounts,
        unreadConversations,urgentConversations,firstResponseBreaches,resolutionBreaches,
        connectedEmailAccounts,connectedSocials,expiringConnectors,
        renewalDueConnectors,reauthConnectors,degradedConnectors,
        providerEventErrors,teamMembers,pendingTeamInvites
      ].every(x=>x.ok),
      widgetConfig:!widgetError && (widgets||[]).some((w:any)=>w.enabled),
      tenantAccess:true
    };

    return Response.json({
      ok:Object.values(checks).every(Boolean),
      checks,
      counts:{
        pendingFacts:(pendingFacts.count+knowledgeGaps.count+learningSuggestions.count),
        pendingFactsOnly:pendingFacts.count,
        pendingDrafts:pendingDrafts.count,
        knowledgeGaps:knowledgeGaps.count,
        learningSuggestions:learningSuggestions.count,
        humanQueue:humanQueue.count,
        openConversations:openConversations.count,
        unreadConversations:unreadConversations.count,
        urgentConversations:urgentConversations.count,
        firstResponseBreaches:firstResponseBreaches.count,
        resolutionBreaches:resolutionBreaches.count,
        sources:sources.count,
        emailAccounts:emailAccounts.count,
        connectedEmailAccounts:connectedEmailAccounts.count,
        connectedSocials:connectedSocials.count,
        expiringConnectors:expiringConnectors.count,
        renewalDueConnectors:renewalDueConnectors.count,
        reauthorizationRequired:reauthConnectors.count,
        degradedConnectors:degradedConnectors.count,
        providerEventErrors:providerEventErrors.count,
        teamMembers:teamMembers.count,
        pendingTeamInvites:pendingTeamInvites.count
      },
      latestAutoSetup:latestRun||null,
      businessBrain:businessBrainReadiness,
      role:membership.role
    });
  }

  const displayName=String(body?.displayName||"").trim();
  if(!displayName) return Response.json({error:"Business name is required"},{status:400});
  const websiteUrl=String(body?.websiteUrl||"").trim()||null;
  const supportEmail=String(body?.supportEmail||"").trim().toLowerCase()||null;
  const industry=String(body?.industry||"").trim()||null;
  const timezone=String(body?.timezone||"Europe/London").trim();
  const aiMode=["suggest","approve","automatic"].includes(String(body?.aiMode))
    ? String(body?.aiMode) : "approve";
  const planCode=["starter","growth","pro"].includes(String(body?.planCode))
    ? String(body?.planCode) : "starter";

  let organisationId="";
  try{
    const org=await ctx.supabaseAdmin.from("cxroute_organisations").insert({name:displayName}).select("id,name").single();
    if(org.error||!org.data) throw new Error("Could not create workspace");
    organisationId=org.data.id;

    const ownerEmail=String((ctx.userClaims as any)?.email||"").trim().toLowerCase()||null;
    const ownerName=String((ctx.userClaims as any)?.name||(ctx.userClaims as any)?.user_metadata?.full_name||"").trim()||null;
    const member=await ctx.supabaseAdmin.from("cxroute_org_members").insert({
      organisation_id:organisationId,user_id:userId,role:"owner",
      member_email:ownerEmail,display_name:ownerName
    });
    if(member.error) throw new Error("Could not create workspace owner");

    const profile=await ctx.supabaseAdmin.from("cxroute_business_profiles").insert({
      organisation_id:organisationId,display_name:displayName,website_url:websiteUrl,
      support_email:supportEmail,industry,timezone
    });
    if(profile.error) throw new Error("Could not create business profile");

    const brand=await ctx.supabaseAdmin.from("cxroute_brands").insert({
      organisation_id:organisationId,
      name:displayName,
      code:"default",
      website_url:websiteUrl,
      support_email:supportEmail,
      locale:"en-GB",
      enabled:true,
      is_default:true
    }).select("id,name,code,website_url,support_email,enabled,is_default").single();
    if(brand.error||!brand.data) throw new Error("Could not create default brand");

    const settings=await ctx.supabaseAdmin.from("cxroute_settings").insert({
      organisation_id:organisationId,ai_mode:aiMode
    });
    if(settings.error) throw new Error("Could not create AI settings");

    const trialStart=new Date();
    const trialEnd=new Date(trialStart.getTime()+14*24*60*60*1000);
    const subscription=await ctx.supabaseAdmin.from("cxroute_subscriptions").insert({
      organisation_id:organisationId,
      plan_code:planCode,
      status:"trialing",
      billing_provider:null,
      current_period_start:trialStart.toISOString(),
      current_period_end:trialEnd.toISOString()
    });
    if(subscription.error) throw new Error("Could not create trial subscription");

    const sla=await ctx.supabaseAdmin.from("cxroute_sla_policies").insert({
      organisation_id:organisationId
    });
    if(sla.error) throw new Error("Could not create SLA settings");

    let allowedOrigins:string[]=[];
    if(websiteUrl){
      try{
        const parsed=new URL(/^https?:\/\//i.test(websiteUrl)?websiteUrl:`https://${websiteUrl}`);
        if(["http:","https:"].includes(parsed.protocol)) allowedOrigins=[parsed.origin];
      }catch{}
    }

    const widget=await ctx.supabaseAdmin.from("cxroute_widget_configs").insert({
      organisation_id:organisationId,
      brand_id:brand.data.id,
      display_name:`${displayName} Support`.slice(0,80),
      welcome_message:"Hi! How can we help?",
      widget_version:"6.1.0-rc.2",
      allowed_origins:allowedOrigins
    }).select("id,brand_id,public_key,display_name,welcome_message,widget_version,allowed_origins").single();
    if(widget.error||!widget.data) throw new Error("Could not create website widget");

    await ctx.supabaseAdmin.from("cxroute_audit_log").insert({
      organisation_id:organisationId,actor_user_id:userId,actor_type:"user",
      action:"workspace_created",entity_type:"organisation",entity_id:organisationId,
      safe_metadata:{ai_mode:aiMode,has_website:Boolean(websiteUrl)}
    });

    return Response.json({
      ok:true,
      workspace:{id:organisationId,name:displayName,aiMode,planCode,trialEndsAt:trialEnd.toISOString()},
      brand:brand.data,
      widget:widget.data
    },{status:201});
  }catch(error){
    if(organisationId){
      try{await ctx.supabaseAdmin.from("cxroute_organisations").delete().eq("id",organisationId);}catch{}
    }
    return Response.json({
      error:error instanceof Error?error.message:"Could not create workspace"
    },{status:500});
  }
}));
