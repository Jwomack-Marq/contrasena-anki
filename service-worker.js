// Contraseña Flashcards — offline service worker.
// `CACHE_VERSION` is rewritten on every `node build_flashcards.mjs` so each
// rebuild invalidates the app cache and clients pick up new content within
// two opens (first open: stale, background refresh; second open: fresh).
const CACHE_VERSION = '2026-05-23T15-36-06-838Z';
const CACHE_NAME = 'contrasena-flashcards-' + CACHE_VERSION;
// Long-lived, content-addressed by URL — audio never changes, so we keep
// this cache across rebuilds.
const AUDIO_CACHE = 'contrasena-audio-v1';
const AUDIO_HOST = 's3.us-east-2.amazonaws.com';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== AUDIO_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return cached || network || new Response('Offline and not cached.', { status: 503 });
    })());
    return;
  }

  // Contraseña audio: cache-first. Audio files never change.
  if (url.hostname === AUDIO_HOST && url.pathname.toLowerCase().endsWith('.mp3')) {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        // no-cors yields an opaque response — still cacheable and <audio>
        // can play it back.
        const resp = await fetch(req, { mode: 'no-cors' });
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
        return resp;
      } catch (_) {
        return new Response('Audio offline and not cached.', { status: 503 });
      }
    })());
    return;
  }
  // Everything else: pass through.
});

// Prefetch a batch of audio URLs into the audio cache. Sent by index.html
// when a user clicks Start on a lesson — pulls just that lesson's clips.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'prefetch-audio' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(AUDIO_CACHE);
    let fetched = 0, skipped = 0;
    for (const u of data.urls) {
      if (!u) continue;
      try {
        const req = new Request(u, { mode: 'no-cors' });
        if (await cache.match(req)) { skipped++; continue; }
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) {
          await cache.put(req, resp.clone());
          fetched++;
        }
      } catch (_) { /* skip individual failures */ }
    }
    const clients = await self.clients.matchAll();
    for (const client of clients) {
      client.postMessage({ type: 'prefetch-audio-done', fetched, skipped, total: data.urls.length });
    }
  })());
});
