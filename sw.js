// ─────────────────────────────────────────────────────────────────────────────
//  TAKMIL Feedback — Service Worker v3
//  Strategy: cache-on-visit (NOT cache-at-install)
//  • Install completes immediately — no risky fetch at install time
//  • Every successful page load is cached automatically
//  • Offline: always serves from cache if teacher visited once online
//  • Background Sync: flushes submission queue when signal returns
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'takmil-feedback-v3';
const SYNC_TAG   = 'sync-takmil-feedback';
const API_BASE   = 'https://takmil-bot-production-0f51.up.railway.app';

const CACHEABLE_PAGES  = ['/teacher-feedback'];
const CACHEABLE_ASSETS = [
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/apple-touch-icon.png', '/manifest.json',
];

// ── INSTALL: activate immediately, cache nothing (avoid failing on slow/no network) ──
self.addEventListener('install', event => {
  console.log('[SW] v3 installed');
  event.waitUntil(self.skipWaiting());
});

// ── ACTIVATE: clear old caches, take control of all tabs ─────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] v3 activated');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== 'takmil-queue-store')
            .map(k => caches.delete(k))
      )),
      self.clients.claim(),
    ])
  );
});

// ── FETCH: intercept GET requests only ───────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  const isOurHost = url.hostname === self.location.hostname;
  const isFont    = ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!isOurHost && !isFont) return;

  const isPage  = CACHEABLE_PAGES.some(p => url.pathname === p || url.pathname === p + '/');
  const isAsset = CACHEABLE_ASSETS.some(p => url.pathname === p) || isFont;

  if (isPage || isAsset) {
    event.respondWith(cacheFirstWithUpdate(request));
  } else if (isOurHost) {
    event.respondWith(networkWithCacheFallback(request));
  }
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    console.log('[SW] Background sync fired');
    event.waitUntil(flushQueueFromSW());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'FLUSH_NOW')    flushQueueFromSW();
});

// ─────────────────────────────────────────────────────────────────────────────
//  FETCH STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────

// Cache-first: instantly serve cached version, silently update cache in background
async function cacheFirstWithUpdate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Always update cache in background (fire and forget)
  fetch(request).then(res => {
    if (res && res.ok && res.status === 200) {
      cache.put(request, res.clone());
    }
  }).catch(() => {});

  if (cached) return cached;   // serve from cache instantly

  // No cache yet: first visit online — fetch and cache, then return
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    // Never visited while online — show friendly offline page
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
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#1a5c38"><title>TAKMIL — Offline</title>
  <style>
    body{font-family:-apple-system,sans-serif;background:#f0f9f4;display:flex;
         flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;margin:0;padding:24px;text-align:center}
    .card{background:#fff;border-radius:16px;padding:32px 24px;max-width:340px;
          box-shadow:0 2px 16px rgba(15,61,34,.1)}
    .logo{font-size:20px;font-weight:900;color:#fff;background:#1a5c38;
          padding:8px 18px;border-radius:8px;display:inline-block;
          letter-spacing:1px;margin-bottom:20px}
    .logo span{color:#c9952a}
    h2{color:#0f3d22;font-size:22px;margin-bottom:10px}
    p{color:#5a7263;font-size:15px;line-height:1.6;margin-bottom:20px}
    button{background:#1a5c38;color:#fff;border:none;border-radius:8px;
           padding:13px 24px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">TAK<span>MIL</span></div>
    <h2>📵 No Connection</h2>
    <p>Please open the TAKMIL app <strong>once while online</strong> to enable offline use.
       Then it will work without signal.</p>
    <button onclick="location.reload()">Try Again</button>
  </div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

// ─────────────────────────────────────────────────────────────────────────────
//  BACKGROUND SYNC — flush queue when app is closed + signal returns
// ─────────────────────────────────────────────────────────────────────────────
async function flushQueueFromSW() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (clients.length > 0) {
    clients.forEach(c => c.postMessage({ type: 'FLUSH_QUEUE' }));
    return;
  }
  const queue = await readPersistedQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const payload of queue) {
    try {
      const res  = await fetch(`${API_BASE}/api/web-feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.saved) remaining.push(payload);
    } catch (e) { remaining.push(payload); }
  }
  await persistQueue(remaining);
}

const QUEUE_CACHE = 'takmil-queue-store';
const QUEUE_KEY   = 'pending-submissions';

async function readPersistedQueue() {
  try {
    const c = await caches.open(QUEUE_CACHE);
    const r = await c.match(QUEUE_KEY);
    return r ? await r.json() : [];
  } catch (e) { return []; }
}

async function persistQueue(q) {
  try {
    const c = await caches.open(QUEUE_CACHE);
    q.length
      ? await c.put(QUEUE_KEY, new Response(JSON.stringify(q), { headers: { 'Content-Type': 'application/json' } }))
      : await c.delete(QUEUE_KEY);
  } catch (e) {}
}
