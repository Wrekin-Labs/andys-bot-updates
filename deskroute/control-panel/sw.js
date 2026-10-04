// Cache only the public shell. Never cache auth, APIs or customer content.
const CACHE='deskroute-shell-6.1.0-rc.2-push2';
const ASSETS=['./','./index.html','./app.js','./api.js','./styles.css','./manifest.webmanifest','./assets/inbox.svg','./assets/list-filter.svg','./assets/book-open.svg','./assets/workflow.svg','./assets/chart-no-axes-column.svg','./assets/plug.svg','./assets/library.svg','./assets/users.svg','./assets/settings.svg','./assets/bell.svg','./assets/menu.svg','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/inter-latin.woff2'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('deskroute-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL(self.registration.scope);
 if(event.request.method!=='GET'||url.origin!==base.origin||event.request.headers.has('Authorization'))return;
 const allowed=new Set(ASSETS.map(path=>new URL(path,base).pathname));
 if(!allowed.has(url.pathname)||url.search)return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});

self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?event.data.json():{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'DeskRoute',{
  body:data.body||'A customer needs your attention.',
  tag:data.tag||'deskroute-alert',
  renotify:!!data.renotify,
  icon:new URL('./assets/icon-192.png',self.registration.scope).href,
  badge:new URL('./assets/icon-192.png',self.registration.scope).href,
  data:{url:data.url||'./#alerts',notification_id:data.notification_id||null}
 }));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||'./#alerts',self.registration.scope).href;
 event.waitUntil((async()=>{
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const same=windows.find(client=>new URL(client.url).origin===new URL(target).origin);
  if(same){if('navigate' in same)await same.navigate(target);return same.focus();}
  return clients.openWindow(target);
 })());
});
