var CACHE_NAME = 'tm-timer-v1';
var urlsToCache = [
  '/toastmasters-timer/',
  '/toastmasters-timer/index.html',
  '/toastmasters-timer/icon-192.png',
  '/toastmasters-timer/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});
