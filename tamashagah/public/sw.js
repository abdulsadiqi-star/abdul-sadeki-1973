/*
 * Minimal service worker. It makes the site installable and shows /offline.html when a page navigation fails because the
 * network is down. It deliberately caches NOTHING else: no pages (they can be personal), no API responses, no media.
 */
const CACHE = 'tamashagah-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only top-level page navigations; everything else (API, media, range requests, other origins) goes straight to the network.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((response) => response || Response.error())));
});
