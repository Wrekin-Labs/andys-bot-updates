
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";

const MAX_BYTES=1_000_000;
const MAX_FACTS=80;
const MAX_PAGES=12;
const MAX_TOTAL_FACTS=220;

function isPrivateIPv4(ip:string){
  const p=ip.split(".").map(Number);
  if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255)) return true;
  return p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||
    (p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||p[0]===0;
}
function isPrivateIPv6(ip:string){
  const v=ip.toLowerCase();
  return v==="::1"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:");
}
async function assertPublicUrl(url:URL){
  if(!["http:","https:"].includes(url.protocol)) throw new Error("Only http/https URLs are allowed");
  if(url.username||url.password) throw new Error("Credentials in URLs are not allowed");
  const host=url.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")) {
    throw new Error("Local/private hosts are not allowed");
  }
  try{
    const a=await Deno.resolveDns(host,"A");
    const aaaa=await Deno.resolveDns(host,"AAAA").catch(()=>[]);
    if(a.length===0&&aaaa.length===0) throw new Error("Host did not resolve");
    if(a.some(isPrivateIPv4)||aaaa.some(isPrivateIPv6)) throw new Error("Private network addresses are not allowed");
  }catch(error){
    if(error instanceof Error&&(error.message.includes("Private network")||error.message.includes("Host did not resolve"))) throw error;
    throw new Error("Could not safely resolve website");
  }
}
async function safeFetch(start:URL){
  let current=start;
  for(let i=0;i<5;i++){
    await assertPublicUrl(current);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10_000);
    let response:Response;
    try{
      response=await fetch(current,{
        redirect:"manual",
        signal:controller.signal,
        headers:{
          "user-agent":"CXRoute-AutoSetup/1.5 (+business-owner-authorised-scan)",
          "accept":"text/html,application/xhtml+xml"
        }
      });
    }finally{clearTimeout(timer);}
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get("location");
      if(!location) throw new Error("Invalid redirect");
      current=new URL(location,current);
      continue;
    }
    if(!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
    const type=(response.headers.get("content-type")||"").toLowerCase();
    if(!type.includes("text/html")&&!type.includes("application/xhtml+xml")) throw new Error("Website did not return HTML");
    return {response,finalUrl:current};
  }
  throw new Error("Too many redirects");
}
async function readLimited(response:Response){
  if(!response.body) return "";
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[]; let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    if(!value) continue;
    total+=value.byteLength;
    if(total>MAX_BYTES){try{await reader.cancel();}catch{} throw new Error("Website page is too large");}
    chunks.push(value);
  }
  const all=new Uint8Array(total); let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(all);
}
function cleanHtml(html:string){
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ")
    .replace(/<[^>]+>/g,"\n")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/g,"'")
    .replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
function unique(values:string[]){return [...new Set(values.map(x=>x.trim()).filter(Boolean))];}
function detectPlatform(html:string){
  const h=html.toLowerCase();
  if(h.includes("cdn.shopify.com")||h.includes("shopify.theme")||h.includes("myshopify.com"))
    return {platform:"shopify",confidence:0.98,autoInstall:"app"};
  if(h.includes("wixstatic.com")||h.includes("wix.com/website-template")||h.includes("x-wix-"))
    return {platform:"wix",confidence:0.97,autoInstall:"app"};
  if(h.includes("/wp-content/")||h.includes("/wp-includes/")||/content=["'][^"']*wordpress/i.test(html))
    return {platform:"wordpress",confidence:0.97,autoInstall:"plugin"};
  if(h.includes("static1.squarespace.com")||h.includes("squarespace.com"))
    return {platform:"squarespace",confidence:0.93,autoInstall:"guided"};
  if(h.includes("data-wf-page=")||h.includes("webflow"))
    return {platform:"webflow",confidence:0.92,autoInstall:"guided"};
  return {platform:"custom",confidence:0.55,autoInstall:"script"};
}
function socialProvider(url:string){
  try{
    const host=new URL(url).hostname.toLowerCase();
    if(host==="facebook.com"||host.endsWith(".facebook.com")) return "facebook";
    if(host==="instagram.com"||host.endsWith(".instagram.com")) return "instagram";
    if(host==="x.com"||host.endsWith(".x.com")||host==="twitter.com"||host.endsWith(".twitter.com")) return "x";
    if(host==="tiktok.com"||host.endsWith(".tiktok.com")) return "tiktok";
  }catch{}
  return null;
}

function extractInternalLinks(html:string,baseUrl:string){
  const base=new URL(baseUrl);
  const preferred=/\b(faq|help|support|contact|about|price|pricing|service|services|book|booking|cancel|cancellation|refund|return|shipping|delivery|terms|policy|policies|hours|room|rooms|rehearsal)\b/i;
  const skipExt=/\.(?:jpe?g|png|gif|svg|webp|ico|pdf|zip|css|js|json|xml|mp3|mp4|webm|woff2?|ttf)(?:$|\?)/i;
  const values:Array<{url:string;score:number}>=[];
  const seen=new Set<string>();

  for(const match of html.matchAll(/href=["']([^"'#]+)["']/gi)){
    const raw=String(match[1]||"").trim();
    if(!raw||/^(?:mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try{
      const u=new URL(raw,base);
      if(u.origin!==base.origin) continue;
      if(skipExt.test(u.pathname)) continue;
      if(/\/wp-admin\/|\/wp-login\.php/i.test(u.pathname)) continue;
      u.hash="";
      u.search="";
      let path=u.pathname.replace(/\/{2,}/g,"/");
      if(!path.endsWith("/")&&!/\.[a-z0-9]{1,6}$/i.test(path)) path+="/";
      u.pathname=path;
      const value=u.toString();
      if(seen.has(value)||value===base.toString()) continue;
      seen.add(value);
      const depth=path.split("/").filter(Boolean).length;
      const score=(preferred.test(path)?20:0)-depth;
      values.push({url:value,score});
    }catch{}
  }

  return values
    .sort((a,b)=>b.score-a.score||a.url.length-b.url.length)
    .map(x=>x.url)
    .slice(0,40);
}

function extractFaqFacts(html:string){
  const out:Array<{fact_key:string;fact_value:string;confidence:number}>=[];
  const clean=(value:unknown)=>cleanHtml(String(value||"")).replace(/\s+/g," ").trim();

  const visit=(node:any)=>{
    if(Array.isArray(node)){
      node.forEach(visit);
      return;
    }
    if(!node||typeof node!=="object") return;

    const types=Array.isArray(node["@type"])?node["@type"]:[node["@type"]];
    if(types.some((x:any)=>String(x)==="FAQPage")){
      const entities=Array.isArray(node.mainEntity)?node.mainEntity:[node.mainEntity];
      for(const item of entities){
        if(!item||typeof item!=="object") continue;
        const q=clean(item.name);
        const a=clean(item.acceptedAnswer?.text);
        if(q&&a){
          out.push({
            fact_key:"faq_candidate",
            fact_value:`Question: ${q.slice(0,700)}\nAnswer: ${a.slice(0,2500)}`,
            confidence:0.90
          });
        }
      }
    }

    for(const value of Object.values(node)) visit(value);
  };

  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      visit(JSON.parse(String(match[1]||"").trim()));
    }catch{}
  }

  return out.slice(0,40);
}

function extractFacts(html:string,text:string,finalUrl:string){
  const facts:Array<{fact_key:string;fact_value:string;confidence:number}>=[];
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g," ").trim();
  if(title) facts.push({fact_key:"website_title",fact_value:title.slice(0,300),confidence:0.95});
  const desc=html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)?.[1];
  if(desc) facts.push({fact_key:"website_description",fact_value:desc.slice(0,600),confidence:0.9});
  for(const v of unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).slice(0,10))
    facts.push({fact_key:"email",fact_value:v,confidence:0.92});
  for(const v of unique(text.match(/(?:\+44\s?\d{3,4}|0\d{3,4})[\s().-]*\d{3,4}[\s.-]*\d{3,4}/g)||[]).slice(0,10))
    facts.push({fact_key:"phone",fact_value:v,confidence:0.82});
  const lines=text.split("\n").map(x=>x.trim()).filter(x=>x.length>=5&&x.length<=260);
  for(const v of unique(lines.filter(x=>/\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|opening|open|closed)\b/i.test(x)&&/\d|closed/i.test(x)).slice(0,20)))
    facts.push({fact_key:"opening_hours_candidate",fact_value:v,confidence:0.68});
  for(const v of unique(lines.filter(x=>/(?:£|\$|€)\s?\d|\d+(?:\.\d{2})?\s?(?:gbp|pounds?)/i.test(x)).slice(0,20)))
    facts.push({fact_key:"price_candidate",fact_value:v,confidence:0.62});
  for(const v of unique(lines.filter(x=>/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(x)).slice(0,8)))
    facts.push({fact_key:"address_candidate",fact_value:v,confidence:0.72});
  const hrefs=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);
  const socials:string[]=[];
  for(const href of hrefs){
    try{
      const absolute=new URL(href,finalUrl).toString();
      if(socialProvider(absolute)) socials.push(absolute);
    }catch{}
  }
  for(const v of unique(socials).slice(0,20))
    facts.push({fact_key:"social_profile",fact_value:v,confidence:0.9});
  facts.push(...extractFaqFacts(html));
  return {facts:facts.slice(0,MAX_FACTS),socials:unique(socials).slice(0,20)};
}

Deno.serve(withSupabase({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST") return Response.json({error:"Method not allowed"},{status:405});

  let runId:string|null=null;
  let organisationId="";
  let brandId="";

  try{
    const body=await req.json();
    organisationId=String(body?.organisationId||"");
    brandId=String(body?.brandId||"");
    const inputUrl=String(body?.websiteUrl||"").trim();

    if(!organisationId||!brandId||!inputUrl){
      return Response.json({error:"organisationId, brandId and websiteUrl are required"},{status:400});
    }

    const {data:membership}=await ctx.supabase.from("cxroute_org_members")
      .select("organisation_id,role").eq("organisation_id",organisationId).maybeSingle();

    if(!membership||!["owner","admin"].includes(membership.role)){
      return Response.json({error:"Not authorised for this organisation"},{status:403});
    }

    const {data:brand}=await ctx.supabase.from("cxroute_brands")
      .select("id,website_url,enabled")
      .eq("id",brandId)
      .eq("organisation_id",organisationId)
      .eq("enabled",true)
      .maybeSingle();

    if(!brand){
      return Response.json({error:"Brand not found or disabled"},{status:404});
    }

    const run=await ctx.supabaseAdmin.from("cxroute_autosetup_runs").insert({
      organisation_id:organisationId,
      brand_id:brandId,
      website_url:inputUrl,
      scan_status:"running",
      started_at:new Date().toISOString()
    }).select("id").single();
    runId=run.data?.id??null;

    const start=new URL(/^https?:\/\//i.test(inputUrl)?inputUrl:`https://${inputUrl}`);
    const first=await safeFetch(start);
    const finalUrl=first.finalUrl;
    const firstHtml=await readLimited(first.response);
    const platform=detectPlatform(firstHtml);

    let {data:connection}=await ctx.supabaseAdmin.from("cxroute_source_connections")
      .select("id")
      .eq("organisation_id",organisationId)
      .eq("brand_id",brandId)
      .eq("source_type","website")
      .eq("display_name",finalUrl.hostname)
      .maybeSingle();

    if(!connection){
      const created=await ctx.supabaseAdmin.from("cxroute_source_connections").insert({
        organisation_id:organisationId,
        brand_id:brandId,
        source_type:"website",
        display_name:finalUrl.hostname,
        status:"connected",
        external_account_id:finalUrl.toString()
      }).select("id").single();

      if(created.error||!created.data) throw new Error("Could not create website source");
      connection=created.data;
    }

    const queue:string[]=[finalUrl.toString(),...extractInternalLinks(firstHtml,finalUrl.toString())];
    const visited=new Set<string>();
    const collected:Array<{
      fact_key:string;
      fact_value:string;
      confidence:number;
      source_item_id:string;
      source_url:string;
    }>=[];
    const socialSet=new Set<string>();
    let primarySourceItemId:string|null=null;
    let pagesScanned=0;

    while(queue.length&&pagesScanned<MAX_PAGES){
      const requested=queue.shift()!;
      if(visited.has(requested)) continue;
      visited.add(requested);

      let pageFinal:URL;
      let html:string;

      if(pagesScanned===0&&requested===finalUrl.toString()){
        pageFinal=finalUrl;
        html=firstHtml;
      }else{
        try{
          const fetched=await safeFetch(new URL(requested));
          pageFinal=fetched.finalUrl;
          if(pageFinal.origin!==finalUrl.origin) continue;
          html=await readLimited(fetched.response);
        }catch{
          continue;
        }
      }

      if(pageFinal.origin!==finalUrl.origin) continue;

      const text=cleanHtml(html).slice(0,60_000);
      const source=await ctx.supabaseAdmin.from("cxroute_source_items").insert({
        organisation_id:organisationId,
        connection_id:connection.id,
        source_url:pageFinal.toString(),
        source_kind:"website_page",
        raw_text:text,
        captured_at:new Date().toISOString()
      }).select("id").single();

      if(source.error||!source.data) continue;
      if(!primarySourceItemId) primarySourceItemId=source.data.id;

      const extractedPage=extractFacts(html,text,pageFinal.toString());
      for(const fact of extractedPage.facts){
        collected.push({
          ...fact,
          source_item_id:source.data.id,
          source_url:pageFinal.toString()
        });
      }
      for(const social of extractedPage.socials) socialSet.add(social);

      for(const link of extractInternalLinks(html,pageFinal.toString())){
        if(!visited.has(link)&&queue.length<80) queue.push(link);
      }

      pagesScanned++;
    }

    const deduped=new Map<string,(typeof collected)[number]>();
    for(const fact of collected){
      const key=`${fact.fact_key}|\u0000|${fact.fact_value.trim().toLowerCase()}`;
      if(!deduped.has(key)) deduped.set(key,fact);
      if(deduped.size>=MAX_TOTAL_FACTS) break;
    }

    const {data:existingFactRows}=await ctx.supabaseAdmin.from("cxroute_knowledge_facts")
      .select("fact_key,fact_value")
      .eq("organisation_id",organisationId)
      .eq("brand_id",brandId)
      .eq("origin_type","website")
      .limit(2000);

    const existingFactSet=new Set((existingFactRows||[]).map((f:any)=>
      `${String(f.fact_key)}|\u0000|${String(f.fact_value||"").trim().toLowerCase()}`
    ));

    const newFacts=[...deduped.values()].filter(f=>
      !existingFactSet.has(`${f.fact_key}|\u0000|${f.fact_value.trim().toLowerCase()}`)
    );

    if(newFacts.length){
      const rows=newFacts.map(f=>({
        organisation_id:organisationId,
        brand_id:brandId,
        source_item_id:f.source_item_id,
        fact_key:f.fact_key,
        fact_value:f.fact_value,
        confidence:f.confidence,
        review_status:"pending",
        origin_type:"website",
        category:f.fact_key.includes("faq")?"faq":
          f.fact_key.includes("price")?"pricing":
          f.fact_key.includes("opening_hours")?"opening_hours":
          f.fact_key.includes("email")||f.fact_key.includes("phone")?"contact":
          f.fact_key.includes("social")?"social_links":
          f.fact_key.includes("address")?"location":
          "business_info",
        source_label:new URL(f.source_url).hostname
      }));

      const inserted=await ctx.supabaseAdmin.from("cxroute_knowledge_facts").insert(rows);
      if(inserted.error) throw new Error("Could not save proposed facts");
    }

    const extracted={
      facts:[...deduped.values()].map(({source_item_id,source_url,...fact})=>fact),
      socials:[...socialSet]
    };
    const factsProposed=newFacts.length;
    const source={data:{id:primarySourceItemId}};

    const discovered:any[]=[];

    for(const profileUrl of extracted.socials){
      const provider=socialProvider(profileUrl);
      if(!provider) continue;

      const existing=await ctx.supabaseAdmin.from("cxroute_social_accounts")
        .select("id")
        .eq("organisation_id",organisationId)
        .eq("brand_id",brandId)
        .eq("provider",provider)
        .eq("profile_url",profileUrl)
        .maybeSingle();

      if(existing.data){
        discovered.push({provider,profileUrl,existing:true});
        continue;
      }

      const conn=await ctx.supabaseAdmin.from("cxroute_source_connections").insert({
        organisation_id:organisationId,
        brand_id:brandId,
        source_type:provider,
        display_name:profileUrl,
        external_account_id:profileUrl,
        status:"pending"
      }).select("id").single();

      if(conn.error||!conn.data) continue;

      const social=await ctx.supabaseAdmin.from("cxroute_social_accounts").insert({
        organisation_id:organisationId,
        brand_id:brandId,
        connection_id:conn.data.id,
        provider,
        profile_url:profileUrl,
        display_name:profileUrl,
        status:"pending",
        knowledge_enabled:true,
        messaging_enabled:false,
        safe_metadata:{discovered_from:finalUrl.toString()}
      }).select("id").single();

      if(social.error){
        await ctx.supabaseAdmin.from("cxroute_source_connections").delete().eq("id",conn.data.id);
        continue;
      }

      discovered.push({provider,profileUrl,existing:false});
    }

    if(runId){
      await ctx.supabaseAdmin.from("cxroute_autosetup_runs").update({
        website_url:finalUrl.toString(),
        detected_platform:platform.platform,
        platform_confidence:platform.confidence,
        install_method:platform.autoInstall,
        scan_status:"complete",
        widget_status:"ready",
        facts_proposed:factsProposed,
        socials_discovered:discovered.length,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("id",runId);
    }

    await ctx.supabaseAdmin.from("cxroute_brands").update({
      website_url:finalUrl.toString(),
      updated_at:new Date().toISOString()
    }).eq("id",brandId).eq("organisation_id",organisationId);

    let businessBrainReadiness:any=null;
    try{
      const readiness=await ctx.supabase.rpc("cxroute_business_brain_readiness",{
        p_organisation_id:organisationId,
        p_brand_id:brandId
      });
      if(!readiness.error){
        businessBrainReadiness=readiness.data;
      }
    }catch{}

    await ctx.supabaseAdmin.from("cxroute_audit_log").insert({
      organisation_id:organisationId,
      actor_user_id:ctx.userClaims?.id??null,
      actor_type:"user",
      action:"website_autosetup_scan",
      entity_type:"source_item",
      entity_id:source.data.id,
      safe_metadata:{
        brand_id:brandId,
        platform:platform.platform,
        facts_proposed:factsProposed,
        pages_scanned:pagesScanned,
        facts_found:extracted.facts.length,
        socials_discovered:discovered.length
      }
    });

    return Response.json({
      ok:true,
      runId,
      brandId,
      finalUrl:finalUrl.toString(),
      sourceItemId:source.data.id,
      pagesScanned,
      factsFound:extracted.facts.length,
      factsProposed,
      facts:extracted.facts,
      platform,
      businessBrainReadiness,
      socialsDiscovered:discovered
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Website scan failed";

    if(runId&&organisationId){
      try{
        await ctx.supabaseAdmin.from("cxroute_autosetup_runs").update({
          scan_status:"error",
          last_error:message,
          completed_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",runId);
      }catch{}
    }

    return Response.json({error:message,runId,brandId},{status:400});
  }
}));
