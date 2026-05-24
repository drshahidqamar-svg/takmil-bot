// ─────────────────────────────────────────────────────────────────────────────
//  TAKMIL Assessment — Service Worker
//  Separate from feedback SW to avoid scope conflicts.
//  Cache: assessment page + fonts (cache-on-visit strategy)
//  Queue: batch sync of offline submissions when signal returns
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME  = 'takmil-assess-v1';
const SYNC_TAG    = 'sync-takmil-assess';
const API_BASE    = 'https://takmil-bot-production-0f51.up.railway.app';

// ── INSTALL: activate immediately, nothing to pre-cache ──────────────────────
self.addEventListener('install', event => {
  console.log('[AssessSW] v1 installed');
  event.waitUntil(self.skipWaiting());
});

// ── ACTIVATE: clear old caches, claim clients ─────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[AssessSW] v1 activated');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k.startsWith('takmil-assess-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )),
      self.clients.claim(),
    ])
  );
});

// ── FETCH: intercept GET requests ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  const isOurHost  = url.hostname === self.location.hostname;
  const isFont     = ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!isOurHost && !isFont) return;

  // API calls — network only, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Assessment page + fonts — cache-first with background update
  if (url.pathname === '/assess' || url.pathname === '/assess/' || isFont) {
    event.respondWith(cacheFirstWithUpdate(request));
    return;
  }

  // Other pages on our domain — network with cache fallback
  if (isOurHost) {
    event.respondWith(networkWithCacheFallback(request));
  }
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    console.log('[AssessSW] Background sync fired');
    event.waitUntil(flushQueueFromSW());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'FLUSH_ASSESS_QUEUE') flushQueueFromSW();
});

// ── FETCH STRATEGIES ──────────────────────────────────────────────────────────
async function cacheFirstWithUpdate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // Update in background
  fetch(request).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
  }).catch(() => {});
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return offlinePage();
  }
}

async function networkWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(request)) || new Response('Offline', { status: 503 });
  }
}

function offlinePage() {
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TAKMIL Assessment — Offline</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#1a2e7a;display:flex;
       align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{background:#fff;border-radius:20px;padding:40px 28px;max-width:340px;text-align:center}
  h2{color:#1a2e7a;font-size:22px;margin-bottom:12px}
  p{color:#666;font-size:14px;line-height:1.6;margin-bottom:24px}
  button{background:#1a2e7a;color:#fff;border:none;border-radius:10px;
         padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
</style></head>
<body><div class="card">
  <div style="font-size:56px;margin-bottom:16px">📵</div>
  <h2>TAKMIL Assessment</h2>
  <p>Open the assessment page <strong>once while online</strong> to enable offline use.<br><br>
     Then it works on hotspot without internet.</p>
  <button onclick="location.reload()">Try Again</button>
</div></body></html>`,
  { headers: { 'Content-Type': 'text/html' } });
}

// ── BACKGROUND SYNC: flush queued results ─────────────────────────────────────
async function flushQueueFromSW() {
  // If app window is open, let it handle the flush
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (clients.length > 0) {
    clients.forEach(c => c.postMessage({ type: 'FLUSH_ASSESS_QUEUE' }));
    return;
  }

  // App closed — read queue from Cache Storage and POST directly
  const queue = await readPersistedQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const payload of queue) {
    try {
      const res  = await fetch(`${API_BASE}/api/assess/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.saved === false) remaining.push(payload);
    } catch (e) {
      remaining.push(payload);
    }
  }
  await persistQueue(remaining);
}

const QUEUE_CACHE = 'takmil-assess-queue';
const QUEUE_KEY   = 'pending-results';

async function readPersistedQueue() {
  try {
    const c = await caches.open(QUEUE_CACHE);
    const r = await c.match(QUEUE_KEY);
    return r ? await r.json() : [];
  } catch(e) { return []; }
}

async function persistQueue(q) {
  try {
    const c = await caches.open(QUEUE_CACHE);
    q.length
      ? await c.put(QUEUE_KEY, new Response(JSON.stringify(q), { headers: { 'Content-Type': 'application/json' } }))
      : await c.delete(QUEUE_KEY);
  } catch(e) {}
}
