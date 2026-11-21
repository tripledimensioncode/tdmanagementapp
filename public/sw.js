// TRIPLE DIMENSION service worker.
//
// Served from /sw.js (see app.js) so its scope covers the whole site.
// Deliberately conservative: pages are never cached, because they are
// per-user, session-protected and contain CSRF tokens. Only static assets
// under /public (css, js, images, icons) are cached, and an offline page is
// shown when a page can't be reached. Bump CACHE_VERSION to force clients
// to drop old cached assets.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `td-static-${CACHE_VERSION}`;
const OFFLINE_URL = '/public/offline.html';

const PRECACHE = [
  OFFLINE_URL,
  '/public/css/style.css',
  '/public/js/app.js',
  '/public/icons/icon-192.png',
  '/public/images/triple-dimension-logo.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('td-') && k !== STATIC_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheableAsset(url) {
  return url.origin === self.location.origin
    && url.pathname.startsWith('/public/')
    && !url.pathname.startsWith('/public/uploads/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Page navigations: always go to the network; show the offline page if
  // the network is unreachable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  const url = new URL(request.url);
  if (!isCacheableAsset(url)) return;

  // Static assets: network first so a deploy shows up right away, falling
  // back to the cached copy on a bad or missing connection.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
