// Sasi Wonder Cakes: service worker. It is what lets the site be installed as an app, and it keeps a spare copy of
// the pages so a bad connection shows a friendly page instead of an error.
// Pages and scripts always come from the network first, so a new version of the site shows up straight away and the
// saved copy is only a fallback. Anything under /api (bookings, students, payments) is never saved.
const CACHE = 'swc-shell-v1';
const OFFLINE = '/offline'; // (the server shortens /offline.html to this; a redirected copy cannot be used as a fallback)

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all([OFFLINE, '/css/style.css', '/assets/icons/icon-192.png'].map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.status === 200 && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match(OFFLINE) : Response.error()))
  );
});
