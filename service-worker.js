// Contraseña Flashcards — offline service worker.
// `CACHE_VERSION` is rewritten on every `node build_flashcards.mjs` so each
// rebuild invalidates the cache and clients pick up new content within two
// opens (first open: stale, background refresh; second open: fresh).
const CACHE_VERSION = '2026-05-23T15-00-38-844Z';
const CACHE_NAME = 'contrasena-flashcards-' + CACHE_VERSION;
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs. Skip everything else so we
// don't break cross-origin fetches or non-GET requests.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then((resp) => {
      // Only cache successful basic responses.
      if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);
    return cached || network || new Response('Offline and not cached.', { status: 503 });
  })());
});
