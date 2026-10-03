// Cache only the public shell. Never cache auth, APIs or customer content.
const CACHE='deskroute-shell-6.1.0-rc.1';
const ASSETS=['./','./index.html','./app.js','./api.js','./styles.css','./manifest.webmanifest','./assets/nav-dot.svg','./assets/nav-active.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/inter-latin.woff2'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('deskroute-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL(self.registration.scope);
 if(event.request.method!=='GET'||url.origin!==base.origin||event.request.headers.has('Authorization'))return;
 const allowed=new Set(ASSETS.map(path=>new URL(path,base).pathname));
 if(!allowed.has(url.pathname)||url.search)return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
