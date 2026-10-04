
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

function json(body:unknown,status=200,origin="*"){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json",
      "access-control-allow-origin":origin,
      "access-control-allow-headers":"content-type",
      "access-control-allow-methods":"POST,OPTIONS",
      "vary":"Origin"
    }
  });
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin")||"*";
  if(req.method==="OPTIONS") return json({ok:true},200,origin);
  if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);

  const requestId=crypto.randomUUID();

  try{
    let body:any;
    try{
      body=await req.json();
    }catch{
      return json({error:"Invalid request"},400,origin);
    }
    const widgetKey=String(body?.widgetKey||"").trim();
    const conversationId=String(body?.conversationId||"").trim();
    const visitorToken=String(body?.visitorToken||"").trim();
    const after=body?.after?String(body.after):null;
    const includeHistory=Boolean(body?.includeHistory);
    if(!widgetKey||!conversationId) return json({error:"widgetKey and conversationId are required"},400,origin);

    const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"];
    const url=Deno.env.get("SUPABASE_URL");
    if(!url||!secret) return json({error:"Server configuration unavailable"},503,origin);
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:config}=await admin.from("cxroute_widget_configs")
      .select("organisation_id,brand_id,enabled,allowed_origins")
      .eq("public_key",widgetKey).eq("enabled",true).maybeSingle();
    if(!config) return json({error:"Widget not found"},404,origin);

    const allowed=Array.isArray(config.allowed_origins)?config.allowed_origins:[];
    if(origin!=="*"&&allowed.length>0&&!allowed.includes(origin)) return json({error:"Origin not allowed"},403,origin);

    let conversationQuery=admin.from("cxroute_conversations")
      .select("id,brand_id,visitor_token_hash")
      .eq("id",conversationId)
      .eq("organisation_id",config.organisation_id)
      .eq("channel","website_chat");

    if(config.brand_id){
      conversationQuery=conversationQuery.eq("brand_id",config.brand_id);
    }

    const {data:conversation}=await conversationQuery.maybeSingle();
    if(!conversation) return json({error:"Conversation not found"},404,origin);

    if(conversation.visitor_token_hash){
      if(!visitorToken) return json({error:"Conversation access denied"},403,origin);
      const hash=await sha256Hex(visitorToken);
      if(hash!==String(conversation.visitor_token_hash)) return json({error:"Conversation access denied"},403,origin);
    }

    let query=admin.from("cxroute_messages")
      .select("id,body,author_type,direction,created_at")
      .eq("organisation_id",config.organisation_id)
      .eq("conversation_id",conversationId)
      .order("created_at",{ascending:true})
      .limit(50);

    if(includeHistory){
      query=query.in("direction",["inbound","outbound"]);
    }else{
      query=query.eq("direction","outbound");
    }

    if(after) query=query.gt("created_at",after);
    const {data:messages,error}=await query;
    if(error) return json({error:"Could not load messages"},500,origin);

    return json({messages:messages||[]},200,origin);
  }catch(error){
    console.error(JSON.stringify({
      fn:"cxroute-widget-sync",
      request_id:requestId,
      error:error instanceof Error?error.name:"Error",
      msg:error instanceof Error?error.message.slice(0,200):"Unexpected error"
    }));
    return json({error:"Internal error"},500,origin);
  }
});
