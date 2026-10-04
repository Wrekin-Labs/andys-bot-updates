(function(){
  var script=document.currentScript;
  if(!script)return;
  var key=script.getAttribute('data-deskroute-key')||script.getAttribute('data-cxroute-key')||'';
  var title=script.getAttribute('data-deskroute-title')||script.getAttribute('data-cxroute-title')||'Support';
  var endpoint=script.getAttribute('data-deskroute-endpoint')||script.getAttribute('data-cxroute-endpoint')||'https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-widget-chat';
  var syncEndpoint=script.getAttribute('data-deskroute-sync-endpoint')||script.getAttribute('data-cxroute-sync-endpoint')||'https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-widget-sync';
  if(!key)return;
  var root=document.createElement('div');
  root.id='deskroute-widget-host';
  document.body.appendChild(root);
  var sh=root.attachShadow({mode:'open'});
  var wrap=document.createElement('div');
  wrap.innerHTML='<style>'+
  ':host{all:initial}.dr-btn{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:13px 16px;background:linear-gradient(135deg,#59ddb7,#78a6ff);color:#07131f;font:800 14px system-ui;box-shadow:0 14px 36px rgba(0,0,0,.28);cursor:pointer}.dr-panel{position:fixed;right:18px;bottom:76px;width:min(380px,calc(100vw - 28px));height:min(580px,calc(100vh - 110px));z-index:2147483647;border:1px solid #2c4567;border-radius:18px;overflow:hidden;background:#0c1727;color:#eef5ff;box-shadow:0 24px 65px rgba(0,0,0,.42);display:none;font:14px/1.45 system-ui}.dr-panel.open{display:grid;grid-template-rows:auto auto 1fr auto}.dr-head{padding:14px 15px;background:#122641;border-bottom:1px solid #28425f;display:flex;align-items:center;justify-content:space-between}.dr-title{font-weight:850}.dr-close{min-width:44px;min-height:44px;margin:-8px;display:grid;place-items:center;border:0;background:transparent;color:#c8d7ea;font-size:20px;cursor:pointer}.dr-pre{padding:10px 12px;background:#0e1d31;border-bottom:1px solid #233a58;color:#aabbd0;font-size:12px}.dr-msgs{padding:13px;overflow:auto;display:flex;flex-direction:column;gap:9px}.dr-msg{max-width:84%;padding:9px 11px;border-radius:13px;background:#173050;white-space:pre-wrap}.dr-msg.me{align-self:flex-end;background:#173b38;border:1px solid #2a6058}.dr-msg.sys{background:#12253e;color:#c9d7e9}.dr-form{padding:11px;border-top:1px solid #253d5b;display:grid;gap:8px}.dr-form.dr-compact{grid-template-columns:minmax(0,1fr) auto;align-items:end}.dr-form.dr-compact .dr-fields{display:none!important}.dr-form.dr-compact .dr-ta{min-height:44px;max-height:88px;resize:none}.dr-form.dr-compact .dr-send{min-width:76px}.dr-form.dr-compact .dr-note{grid-column:1/-1}.dr-fields{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dr-in,.dr-ta{width:100%;box-sizing:border-box;background:#081421;border:1px solid #2c4666;color:#eef5ff;border-radius:9px;padding:9px;font:13px system-ui;outline:none}.dr-ta{min-height:54px;max-height:120px;resize:vertical}.dr-send{border:0;border-radius:9px;padding:10px 12px;background:linear-gradient(135deg,#59ddb7,#78a6ff);color:#06131e;font-weight:850;cursor:pointer}.dr-send[disabled]{opacity:.6;cursor:wait}.dr-note{font-size:11px;color:#91a6bf}.dr-err{color:#ffadb5}.dr-hidden{display:none!important}@media(max-width:520px){.dr-btn{right:12px;bottom:12px}.dr-panel{right:7px;bottom:66px;width:calc(100vw - 14px);height:calc(100vh - 86px);border-radius:15px}.dr-fields{grid-template-columns:1fr}}'+
  '.dr-in:focus-visible,.dr-ta:focus-visible,.dr-btn:focus-visible,.dr-close:focus-visible,.dr-send:focus-visible{outline:2px solid #78a6ff;outline-offset:2px}.dr-send{min-height:44px}.dr-panel{height:min(580px,calc(100dvh - 110px))}@media(max-width:520px){.dr-panel{height:min(72dvh,620px)}.dr-in,.dr-ta{font-size:16px}}'+
  '</style><button class="dr-btn" aria-label="Open support chat">Chat</button><section class="dr-panel" role="dialog" aria-label="Support chat"><div class="dr-head"><div class="dr-title"></div><button class="dr-close" aria-label="Close chat">&times;</button></div><div class="dr-pre">Loading support...</div><div class="dr-msgs" aria-live="polite"></div><form class="dr-form"><div class="dr-fields dr-hidden"><input class="dr-in dr-name" aria-label="Your name" autocomplete="name" placeholder="Your name"><input class="dr-in dr-email" aria-label="Email" autocomplete="email" placeholder="Email (optional)" type="email"></div><textarea class="dr-ta" aria-label="How can we help?" maxlength="1000" placeholder="How can we help?"></textarea><button class="dr-send" type="submit">Send</button><div class="dr-note"></div></form></section>';
  while(wrap.firstChild)sh.appendChild(wrap.firstChild);
  var btn=sh.querySelector('.dr-btn'),panel=sh.querySelector('.dr-panel'),close=sh.querySelector('.dr-close'),head=sh.querySelector('.dr-title'),pre=sh.querySelector('.dr-pre'),msgs=sh.querySelector('.dr-msgs'),form=sh.querySelector('.dr-form'),fields=sh.querySelector('.dr-fields'),nameIn=sh.querySelector('.dr-name'),emailIn=sh.querySelector('.dr-email'),ta=sh.querySelector('.dr-ta'),send=sh.querySelector('.dr-send'),note=sh.querySelector('.dr-note');
  var storageKey='deskroute-state-'+key,legacyKey='deskroute-conversation-'+key;
  var conversationId='',visitorToken='',savedName='',savedEmail='';
  function readState(){
    try{
      var raw=localStorage.getItem(storageKey);
      if(raw){
        var state=JSON.parse(raw);
        if(state&&Number(state.expiresAt||0)>Date.now()){
          conversationId=String(state.conversationId||'');visitorToken=String(state.visitorToken||'');savedName=String(state.name||'');savedEmail=String(state.email||'');return;
        }
      }
    }catch(e){}
    try{conversationId=sessionStorage.getItem(legacyKey)||localStorage.getItem(legacyKey)||'';savedName=sessionStorage.getItem('deskroute-name-'+key)||'';savedEmail=sessionStorage.getItem('deskroute-email-'+key)||''}catch(e){}
  }
  function persistState(){if(!conversationId)return;try{localStorage.setItem(storageKey,JSON.stringify({conversationId:conversationId,visitorToken:visitorToken,name:savedName,email:savedEmail,expiresAt:Date.now()+30*24*60*60*1000}))}catch(e){}}
  function clearState(){conversationId='';visitorToken='';savedName='';savedEmail='';historyLoaded=false;lastSeen='';try{localStorage.removeItem(storageKey);sessionStorage.removeItem(legacyKey);localStorage.removeItem(legacyKey)}catch(e){}}
  readState();
  var cfg=null,lastSeen='',timer=null,historyLoaded=false;
  function add(text,kind){var d=document.createElement('div');d.className='dr-msg '+(kind||'');d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d}
  function setError(text){note.textContent=text||'';note.className='dr-note'+(text?' dr-err':'')}
  function compactComposer(){if(!conversationId)return;fields.classList.add('dr-hidden');nameIn.required=false;emailIn.required=false;form.classList.add('dr-compact');ta.placeholder='Type a message...'}
  async function loadConfig(){
    try{
      var r=await fetch(endpoint+'?key='+encodeURIComponent(key)+'&lang='+encodeURIComponent(navigator.language||'en-GB'));
      var j=await r.json();
      if(!r.ok)throw new Error(j.error||'Support unavailable');
      cfg=j;head.textContent=j.display_name||title;pre.textContent=j.is_open===false?(j.offline_message||'The team is currently offline. Send a message and they will reply when support reopens.'):(j.welcome_message||'Hi! How can we help?');
      if((j.require_name||j.require_email)&&!conversationId)fields.classList.remove('dr-hidden');
      nameIn.required=!!j.require_name&&!conversationId;emailIn.required=!!j.require_email&&!conversationId;
      if(conversationId)compactComposer();
      if(j.require_email)emailIn.placeholder='Email';
      nameIn.value=savedName;emailIn.value=savedEmail;
    }catch(e){head.textContent=title;pre.textContent='Support is temporarily unavailable.';setError(e.message)}
  }
  async function sync(includeHistory){
    if(!conversationId||document.hidden)return false;
    try{
      var payload={widgetKey:key,conversationId:conversationId,visitorToken:visitorToken||undefined,after:includeHistory?null:(lastSeen||null)};
      if(includeHistory)payload.includeHistory=true;
      var r=await fetch(syncEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      var j=await r.json();if(!r.ok){if(r.status===403){clearState();setError('This chat session expired. Send a new message to start again.')}return false;}
      var items=j.messages||[];
      if(includeHistory){msgs.innerHTML='';historyLoaded=true;lastSeen='';}
      items.forEach(function(m){
        var kind=m.direction==='inbound'?'me':((m.author_type==='agent'||m.author_type==='ai')?'':'sys');
        add(m.body,kind);
        if(m.created_at)lastSeen=m.created_at;
      });
      return true;
    }catch(e){return false}
  }
  function beginPolling(){if(timer)clearInterval(timer);timer=setInterval(function(){sync(false)},3000);sync(false)}
  btn.onclick=async function(){panel.classList.add('open');btn.style.display='none';btn.setAttribute('aria-expanded','true');ta.focus();if(conversationId){if(!historyLoaded)await sync(true);beginPolling()}};
  close.onclick=function(){panel.classList.remove('open');btn.style.display='block';btn.setAttribute('aria-expanded','false');if(timer){clearInterval(timer);timer=null}btn.focus()};
  sh.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&panel.classList.contains('open')){ev.preventDefault();close.click()}});
  form.onsubmit=async function(ev){
    ev.preventDefault();if(send.disabled)return;setError('');
    var message=ta.value.trim();if(!message)return;
    if(cfg&&cfg.require_name&&!nameIn.value.trim()){setError('Please enter your name.');return}
    if(cfg&&cfg.require_email&&!emailIn.value.trim()){setError('Please enter your email.');return}
    send.disabled=true;add(message,'me');ta.value='';
    savedName=nameIn.value.trim();savedEmail=emailIn.value.trim();
    try{
      var r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({widgetKey:key,message:message,conversationId:conversationId||undefined,visitorToken:visitorToken||undefined,visitorName:savedName||undefined,visitorEmail:savedEmail||undefined,locale:navigator.language||'en-GB'})});
      var j=await r.json();if(!r.ok)throw new Error(j.error||'Could not send message');
      if(j.conversationId){conversationId=j.conversationId;if(j.visitorToken)visitorToken=String(j.visitorToken);persistState();compactComposer()}
      var loaded=await sync(true);
      if(!loaded&&j.answer)add(j.answer,j.needsHuman?'sys':'');
      beginPolling();
    }catch(e){add('Sorry, your message could not be sent. Please try again.','sys');setError(e.message)}
    finally{send.disabled=false;ta.focus()}
  };
  btn.setAttribute('aria-expanded','false');
  loadConfig().then(function(){
    if(script.getAttribute('data-deskroute-auto-open')==='true'){
      setTimeout(function(){btn.click()},0);
    }
  });
})();