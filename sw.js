// TAKMIL Offline Service Worker v2
const CACHE = 'takmil-offline-v2';
const ASSETS = [
  '/offline-portal',
  '/manifest.json',
];

// ── Install: cache static assets ────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clear old caches ───────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ───────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Question API — cache the response so tablets work offline after first load
  if (url.pathname.startsWith('/api/assess/questions/') ||
      url.pathname.startsWith('/api/assess/session/')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          // Cache a clone of the response
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request)) // offline: return cached version
    );
    return;
  }

  // Submit endpoints — network only, queue handled by app JS
  if (url.pathname.startsWith('/portal/offline/submit') ||
      url.pathname.startsWith('/api/assess/submit')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', queued: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — cache first, network fallback
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }))
      .catch(() => caches.match('/offline-portal'))
  );
});
