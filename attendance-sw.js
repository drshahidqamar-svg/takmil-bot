// TAKMIL Attendance — Service Worker
const CACHE_NAME = 'takmil-attend-v1';
const SYNC_TAG   = 'sync-takmil-attend';
const API_BASE   = 'https://takmil-bot-production-0f51.up.railway.app';

self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('takmil-attend-') && k !== CACHE_NAME).map(k => caches.delete(k))
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  const isOurHost = url.hostname === self.location.hostname;
  const isFont    = ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!isOurHost && !isFont) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.includes('/teacher-attendance') || isFont) {
    event.respondWith(cacheFirstWithUpdate(request));
  } else if (isOurHost) {
    event.respondWith(networkWithCacheFallback(request));
  }
});

self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushFromSW());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'FLUSH_ATTEND_QUEUE') flushFromSW();
});

async function cacheFirstWithUpdate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  fetch(req).then(r => { if (r?.ok) cache.put(req, r.clone()); }).catch(() => {});
  if (cached) return cached;
  try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
  catch(e) { return new Response('<h2>Offline</h2>', { headers: { 'Content-Type': 'text/html' } }); }
}
async function networkWithCacheFallback(req) {
  const cache = await caches.open(CACHE_NAME);
  try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
  catch(e) { return (await cache.match(req)) || new Response('Offline', { status: 503 }); }
}

async function flushFromSW() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (clients.length > 0) { clients.forEach(c => c.postMessage({ type: 'FLUSH_ATTEND_QUEUE' })); return; }
  try {
    const c   = await caches.open('takmil-attend-queue');
    const res = await c.match('pending');
    if (!res) return;
    const queue = await res.json();
    const remaining = [];
    for (const p of queue) {
      try {
        const r = await fetch(`${API_BASE}/api/register/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
        });
        const d = await r.json().catch(() => ({}));
        if (!d.saved) remaining.push(p);
      } catch(e) { remaining.push(p); }
    }
    remaining.length
      ? await c.put('pending', new Response(JSON.stringify(remaining), { headers: { 'Content-Type': 'application/json' } }))
      : await c.delete('pending');
  } catch(e) {}
}
