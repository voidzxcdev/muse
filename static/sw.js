/* Muse service worker — app shell offline, API always live. */
const CACHE = 'muse-v312';
const CORE = ['/', '/home', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return;
  // APK / desktop installers must hit Chrome's download manager, not Cache API.
  if (u.pathname.startsWith('/android/') || u.pathname.startsWith('/desktop/')) return;
  if (/\.(apk|exe|msi)$/i.test(u.pathname)) return;
  // Documents go network-first: a stale cached page is worse than no page.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => caches.match('/index.html'))
    )
  );
});

let watch = { handle: '', visible: false };
self.addEventListener('message', (e) => {
  const d = (e && e.data) || {};
  if (d.type !== 'muse-watch') return;
  watch = { handle: String(d.handle || '').toLowerCase(), visible: !!d.visible };
});

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch {}
    const title = data.title || 'Muse';
    const body = data.body || '';
    const tag = data.tag || 'muse';
    const handle = String(data.handle || '').toLowerCase();
    let clientsList = [];
    try {
      clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    } catch {}
    const pageOpen = clientsList.some((c) => c.visibilityState === 'visible' || c.focused);
    if (pageOpen && watch.visible && handle && watch.handle === handle) return;
    for (const c of clientsList) {
      try { c.postMessage({ type: 'muse-push', data }); } catch {}
    }
    await self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data,
      renotify: true,
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = (e.notification && e.notification.data) || {};
  const handle = String(data.handle || '');
  const dest = data.url || (handle ? ('/friends/' + handle) : '/friends');
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === location.origin) {
          try { c.postMessage({ type: 'muse-notif-click', handle, url: dest }); } catch {}
          try { await c.focus(); } catch {}
          return;
        }
      } catch {}
    }
    await self.clients.openWindow(dest);
  })());
});
