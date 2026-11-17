// Service worker: keeps the app shell available offline. Data is never cached here
// (it lives in the browser store or in Firestore). Bump CACHE when the shell changes.
const CACHE = 'svl-cashflow-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/views.js',
  './js/store.js',
  './js/format.js',
  './firebase-config.js',
  './src/engine.js',
  './src/importer.js',
  './src/structure.js',
  './src/quality.js',
  './vendor/xlsx.full.min.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase SDK and Firestore/Auth traffic always go to the network
  if (url.origin !== self.location.origin) return;
  // Network first for the shell so updates arrive; fall back to the cache offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
