// TAKMIL Lessons — Service Worker
const CACHE_NAME = 'takmil-lessons-v1';
const SYNC_TAG   = 'sync-takmil-lessons';
const API_BASE   = 'https://takmil-bot-production-0f51.up.railway.app';

self.addEventListener('install',  e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k.startsWith('takmil-lessons-') && k !== CACHE_NAME).map(k => caches.delete(k))
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  const isOurs = url.hostname === self.location.hostname;
  const isFont = ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!isOurs && !isFont) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.includes('/teacher-lessons') || isFont) {
    event.respondWith(cacheFirstWithUpdate(request));
  }
});

self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushFromSW());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirstWithUpdate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  fetch(req).then(r => { if (r?.ok) cache.put(req, r.clone()); }).catch(() => {});
  if (cached) return cached;
  try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
  catch(e) { return new Response('<h2>Offline</h2>', { headers:{'Content-Type':'text/html'} }); }
}

async function flushFromSW() {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled:true, type:'window' });
    if (clients.length) { clients.forEach(c => c.postMessage({ type:'FLUSH_VLOG' })); return; }
    const stored = await (await (await caches.open('takmil-lessons-queue')).match('vlog'))?.json() || [];
    const remaining = [];
    for (const ev of stored) {
      try {
        const r = await fetch(`${API_BASE}/api/video-log`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(ev)
        });
        const d = await r.json().catch(() => ({}));
        if (!d.saved) remaining.push(ev);
      } catch(e) { remaining.push(ev); }
    }
    const c = await caches.open('takmil-lessons-queue');
    remaining.length
      ? await c.put('vlog', new Response(JSON.stringify(remaining), { headers:{'Content-Type':'application/json'} }))
      : await c.delete('vlog');
  } catch(e) {}
}
