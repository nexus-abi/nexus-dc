/* Nexus Document Hub service worker: offline app shell */
const V = 'nexus-v6', SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;            // never touch Google API / Drive files
  if (r.mode === 'navigate' || u.pathname.endsWith('/config.js')) { // always fresh when online; cached copy when offline                           // network first, offline fallback
    const k = r.mode === 'navigate' ? './index.html' : r;
    e.respondWith(fetch(r, { cache: 'no-cache' }).then(x => { if (x.ok) { const c = x.clone(); caches.open(V).then(h => h.put(k, c)); } return x; }).catch(() => caches.match(k)));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(x => { if (x.ok) { const c = x.clone(); caches.open(V).then(h => h.put(r, c)); } return x; })));
});
