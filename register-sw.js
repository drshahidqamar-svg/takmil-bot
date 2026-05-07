// TAKMIL Register — Service Worker
// Caches the register page for offline use.
// API calls are handled by app-level IndexedDB logic, not intercepted here.

const CACHE = 'takmil-register-v2';
const CACHE_ASSETS = ['/register.html', '/register-sw.js'];

// Install: cache page assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CACHE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve register.html from cache when offline; pass API calls through
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for API calls — app handles offline via IndexedDB
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Cache-first for page assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Background Sync (fires when connection restored, if browser supports it)
self.addEventListener('sync', e => {
  if (e.tag === 'sync-attendance') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_NOW' }))
      )
    );
  }
});
