// Cache only the public offline screen and branding, never accounts, API data,
// HTML app sessions, consultation passes, or appointment responses.
const OFFLINE_CACHE = 'it-consult-offline-v1';
const PUBLIC_FILES = ['/offline.html', '/images/app-icon-192.png', '/images/app-icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.addAll(PUBLIC_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('it-consult-offline-') && key !== OFFLINE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  } else if (PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
