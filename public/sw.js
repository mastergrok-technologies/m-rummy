// Only an offline explanation is cached. Hands, API responses, and the live
// application shell always use the network so no stale game state is replayed.
const CACHE = 'm-rummy-offline-v2';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/offline.js', '/style.css'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('m-rummy-offline-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  } else if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin && ['/style.css', '/offline.js'].includes(new URL(event.request.url).pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL(event.request.url).pathname)));
  }
});
