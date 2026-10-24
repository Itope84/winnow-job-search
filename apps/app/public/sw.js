// Winnow service worker: makes the app installable and opens it without a connection.
// `scripts/build-sw.mjs` stamps BUILD and SHELL after each export, so every build installs a new worker that
// caches the new files and drops the old ones. API answers are never cached: they are personal and live.
const BUILD = '__WINNOW_BUILD__';
const SHELL = [] /* __WINNOW_SHELL__ */;
const CACHE = `winnow-shell-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('winnow-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: the network first, so a new build shows at once; the cached app when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/', { cacheName: CACHE }).then((r) => r || Response.error())),
    );
    return;
  }

  // Built files have content hashes in their names: the cache first, then the network.
  event.respondWith(
    caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)),
  );
});
