'use strict';

// App instalable y que abre sin señal. Al cambiar cualquier archivo, subí el número de CACHE.
const CACHE = 'obras-v9';
const SHELL = [
  './', './index.html', './app.js?v=9', './etapas.js?v=9', './obras.css?v=9', './manifest.webmanifest',
  '../shared/base.css?v=9', '../shared/config.js?v=9', '../shared/cloud.js?v=9', '../shared/ui.js?v=9', '../shared/boot.js?v=9',
  '../shared/icons/logo-white.png', '../shared/icons/favicon.png', '../shared/icons/icon-192.png',
];
const FIREBASE = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('obras-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = request.url;
  // SDK de Firebase: tiene la versión en la dirección, así que si está guardado se usa directo.
  if (url.startsWith(FIREBASE)) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    })));
    return;
  }
  if (new URL(url).origin !== location.origin) return;
  // Archivos de la app: primero la red (3 segundos), si no contesta, lo guardado.
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback()); } }, 3000);
    fetch(request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(fallback()); } });
  }));
});
