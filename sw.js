// ─────────────────────────────────────────────────────────────────────────────
//  TAKMIL Feedback — Service Worker
//  Strategy:
//    • App shell (feedback page + fonts) → cache on install, serve offline
//    • API calls (/api/*) → network only, never cached
//    • Background Sync tag 'sync-takmil-feedback' → flush queue when signal returns
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME  = 'takmil-feedback-v2';
const SYNC_TAG    = 'sync-takmil-feedback';
const API_BASE    = 'https://takmil-bot-production-0f51.up.railway.app';

// Pages and assets to cache on install
const APP_SHELL = [
  '/teacher-feedback',
];

// ── INSTALL — pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // addAll fails if ANY request fails — use individual puts so fonts
        // failing (e.g. already offline at install time) don't block the SW
        return Promise.allSettled(
          APP_SHELL.map(url =>
            fetch(url)
              .then(res => { if (res.ok) cache.put(url, res); })
              .catch(() => {}) // silently skip if offline at install time
          )
        );
      })
      .then(() => {
        console.log('[SW] App shell cached');
        return self.skipWaiting(); // activate immediately
      })
  );
});

// ── ACTIVATE — delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim()) // take control of open pages immediately
  );
});

// ── FETCH — serve from cache when offline ────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept API calls — pass straight to network
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) {
    // Exception: cache Google Fonts so they work offline too
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirst(request));
    }
    // Everything else (including /api/) — let browser handle
    return;
  }

  // 2. App shell pages — stale-while-revalidate
  //    Serve cached version instantly, update cache in background
  if (
    url.pathname === '/teacher-feedback' ||
    url.pathname === '/teacher-feedback/' ||
    url.pathname === '/'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. Everything else on our domain — network first, cache fallback
  event.respondWith(networkFirst(request));
});

// ── BACKGROUND SYNC — fires when signal is restored ──────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    console.log('[SW] Background sync triggered — flushing submission queue');
    event.waitUntil(flushQueueFromSW());
  }
});

// ── PUSH-style message from main thread ──────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'FLUSH_NOW') flushQueueFromSW();
});

// ─────────────────────────────────────────────────────────────────────────────
//  FLUSH — read queue from localStorage via client window, then POST each item
//  We can't read localStorage directly in SW — we post a message to the client
//  and let the client do the actual flushing (most reliable cross-browser).
//  For true background sync (app closed), we read the queue via a BroadcastChannel
//  or by asking the client if one is open, otherwise defer to next open.
// ─────────────────────────────────────────────────────────────────────────────
async function flushQueueFromSW() {
  // Tell every open client window to flush its queue
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });

  if (clients.length > 0) {
    // App is open — ask client to flush (client has localStorage access)
    clients.forEach(client => client.postMessage({ type: 'FLUSH_QUEUE' }));
    return;
  }

  // App is closed — read queue from Cache Storage where we persisted it
  const queue = await readPersistedQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const payload of queue) {
    try {
      const res = await fetch(`${API_BASE}/api/web-feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) remaining.push(payload);
      else console.log('[SW] Queued submission sent for', payload.school);
    } catch (e) {
      remaining.push(payload); // re-queue on network failure
    }
  }
  await persistQueue(remaining);
}

// ── Cache-backed queue store (accessible from SW when app is closed) ──────────
const QUEUE_CACHE = 'takmil-queue-store';
const QUEUE_KEY   = 'pending-submissions';

async function readPersistedQueue() {
  try {
    const cache = await caches.open(QUEUE_CACHE);
    const res   = await cache.match(QUEUE_KEY);
    if (!res) return [];
    return await res.json();
  } catch (e) { return []; }
}

async function persistQueue(queue) {
  try {
    const cache = await caches.open(QUEUE_CACHE);
    if (queue.length === 0) {
      await cache.delete(QUEUE_KEY);
    } else {
      await cache.put(QUEUE_KEY, new Response(JSON.stringify(queue), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  FETCH STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Revalidate in background (don't await)
  const revalidate = fetch(request)
    .then(res => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  return cached || await revalidate;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    return offlineFallback();
  }
}

function offlineFallback() {
  return new Response(
    '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
    '<h2>📵 You are offline</h2>' +
    '<p>Open the TAKMIL feedback form while online at least once to use it offline.</p>' +
    '</body></html>',
    { headers: { 'Content-Type': 'text/html' } }
  );
}
