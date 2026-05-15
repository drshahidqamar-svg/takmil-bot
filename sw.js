// TAKMIL Offline Service Worker v5
// Handles navigation requests so app opens without internet

const CACHE   = 'takmil-offline-v5';
const SHELL   = ['/offline-portal', '/student-portal', '/teacher-portal', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Navigation (opening app / refresh) — network first, cached shell fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => {
          // Serve the correct cached page based on URL
          return caches.match(e.request).then(cached => {
            if (cached) return cached;
            // Fallback: pick the right shell page
            const path = new URL(e.request.url).pathname;
            if (path.startsWith('/student-portal')) return caches.match('/student-portal');
            if (path.startsWith('/teacher-portal')) return caches.match('/teacher-portal');
            return caches.match('/offline-portal');
          });
        })
    );
    return;
  }

  // Schools list — cache for offline dropdown
  if (url.pathname === '/api/schools/list') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Attendance submit — network only, app JS handles offline queue
  if (url.pathname === '/api/attendance/submit') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ saved:false, error:'offline', queued:true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Question APIs — cache for offline assessments
  if (url.pathname.startsWith('/api/assess/questions/') ||
      url.pathname.startsWith('/api/assess/session/')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Assessment submit — network only
  if (url.pathname.startsWith('/portal/offline/submit') ||
      url.pathname.startsWith('/api/assess/submit')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error:'offline', queued:true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Portal session/start — network only, fall through to offline PIN check in app
  if (url.pathname === '/portal/session/start') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error:'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Everything else — cache first, network fallback
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        });
      })
      .catch(() => caches.match('/offline-portal'))
  );
});
