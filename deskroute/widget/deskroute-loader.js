(function(){
  var script=document.currentScript;
  if(!script||script.dataset.deskrouteLoaderStarted==="1")return;
  script.dataset.deskrouteLoaderStarted="1";
  var key=script.getAttribute("data-deskroute-key")||script.getAttribute("data-cxroute-key")||"";
  if(!key)return;
  var endpoint=script.getAttribute("data-deskroute-endpoint")||script.getAttribute("data-cxroute-endpoint")||"https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-widget-chat";
  var fallbackVersion="6.1.0-rc.1";
  var base=new URL(".",script.src);
  function safeVersion(value){
    value=String(value||"").trim();
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)?value:fallbackVersion;
  }
  function load(version){
    var child=document.createElement("script");
    for(var i=0;i<script.attributes.length;i++){
      var a=script.attributes[i];
      if(a.name.indexOf("data-")===0)child.setAttribute(a.name,a.value);
    }
    child.src=new URL("widget/"+safeVersion(version)+"/deskroute-widget.js",base).href;
    child.defer=true;
    child.async=false;
    child.setAttribute("data-deskroute-loaded-version",safeVersion(version));
    child.onerror=function(){ console.error("DeskRoute widget could not be loaded."); };
    script.parentNode.insertBefore(child,script.nextSibling);
  }
  var lang=(navigator.language||"en-GB").slice(0,40);
  fetch(endpoint+"?key="+encodeURIComponent(key)+"&lang="+encodeURIComponent(lang),{method:"GET",credentials:"omit"})
    .then(function(r){if(!r.ok)throw new Error("config");return r.json();})
    .then(function(cfg){load(cfg&&cfg.widget_version);})
    .catch(function(){load(fallbackVersion);});
})();