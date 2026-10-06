// Offline support: app shell cached; data refreshed when online.
const V = 'ddr-app-v5';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/app.js', '/app/data.json', '/app/manifest.webmanifest', '/app/icons/icon-192.png', '/static/favicon.svg',
  '/app/fonts/fraunces-latin-700-normal.woff2', '/app/fonts/fraunces-latin-900-normal.woff2', '/app/fonts/fraunces-latin-400-italic.woff2',
  '/app/fonts/source-sans-3-latin-400-normal.woff2', '/app/fonts/source-sans-3-latin-600-normal.woff2', '/app/fonts/source-sans-3-latin-700-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first for data and stories, cache first for the shell
  if (u.pathname.endsWith('.json')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else if (u.pathname.startsWith('/app/') || u.pathname.startsWith('/static/')) {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })));
  }
});
