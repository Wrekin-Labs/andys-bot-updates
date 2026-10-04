(function(){
  var script=document.currentScript;
  if(!script||script.dataset.deskrouteLoaderStarted==="1")return;
  script.dataset.deskrouteLoaderStarted="1";

  var key=script.getAttribute("data-deskroute-key")||script.getAttribute("data-cxroute-key")||"";
  if(!key)return;

  var endpoint=script.getAttribute("data-deskroute-endpoint")||script.getAttribute("data-cxroute-endpoint")||"https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-widget-chat";
  var fallbackVersion="6.1.0-rc.2";
  var versionRx=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  var base=new URL(".",script.src);
  var lang=(navigator.language||"en-GB").slice(0,40);
  var cacheKey="deskroute:cfg:"+key+":"+lang;

  function safeVersion(value){
    value=String(value||"").trim();
    return versionRx.test(value)?value:fallbackVersion;
  }

  function copyDataAttributes(target){
    for(var i=0;i<script.attributes.length;i++){
      var a=script.attributes[i];
      if(a.name.indexOf("data-")===0)target.setAttribute(a.name,a.value);
    }
  }

  function load(version,allowFallback){
    var chosen=safeVersion(version);
    var child=document.createElement("script");
    copyDataAttributes(child);
    child.src=new URL("widget/"+chosen+"/deskroute-widget.js",base).href;
    child.defer=true;
    child.async=false;
    child.setAttribute("data-deskroute-loaded-version",chosen);
    child.onerror=function(){
      child.remove();
      if(allowFallback!==false&&chosen!==fallbackVersion)load(fallbackVersion,false);
      else console.error("DeskRoute widget could not be loaded.");
    };
    script.parentNode.insertBefore(child,script.nextSibling);
  }

  function readCache(){
    try{
      var cached=JSON.parse(sessionStorage.getItem(cacheKey)||"null");
      return cached&&cached.exp>Date.now()&&cached.cfg?cached.cfg:null;
    }catch(e){return null;}
  }

  function writeCache(cfg){
    try{sessionStorage.setItem(cacheKey,JSON.stringify({cfg:cfg,exp:Date.now()+600000}));}catch(e){}
  }

  var cached=readCache();
  if(cached){load(cached.widget_version,true);return;}

  fetch(endpoint+"?key="+encodeURIComponent(key)+"&lang="+encodeURIComponent(lang),{method:"GET",credentials:"omit"})
    .then(function(r){if(!r.ok)throw new Error("config");return r.json();})
    .then(function(cfg){writeCache(cfg||{});load(cfg&&cfg.widget_version,true);})
    .catch(function(){load(fallbackVersion,false);});
})();
