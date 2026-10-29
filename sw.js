// Service worker: app shell en caché, datos siempre en línea.
const VERSION = 'healthy-v6';
const SHELL = ['./', './index.html', './rapido/', './rapido/index.html', './ia/', './ia/index.html', './app.js', './styles.css', './manifest.webmanifest',
  './assets/logos/healthy.png', './assets/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // datos y pedidos: siempre red
  if (url.pathname.includes('/admin')) return;
  const cdn = /esm\.sh|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (cdn) { // inmutables: caché primero
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin === location.origin) { // propios: red primero para ver cambios al instante
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req)));
  }
});
