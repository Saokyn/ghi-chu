// Service worker của Ghi Chú: cài như app (PWA), chạy offline cơ bản, nhận Web Push nhắc việc.
// Chiến lược cache an toàn cho cập nhật:
//  - HTML/JS/CSS/manifest/config cùng nguồn: MẠNG TRƯỚC (luôn lấy bản mới khi online), chỉ dùng cache khi mất mạng.
//  - Ảnh, font, vendor: CACHE TRƯỚC (ít đổi), cập nhật nền.
//  - Khác nguồn (Supabase API, AI, ảnh link…), POST, Range: KHÔNG đụng tới.
const CACHE = 'ghichu-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './img/logo/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ghichu-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
const STATIC = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf)$/i;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const cacheFirst = STATIC.test(url.pathname) || url.pathname.includes('/vendor/') || url.pathname.includes('/fonts/');
  e.respondWith(cacheFirst ? fromCacheFirst(req) : fromNetworkFirst(req));
});
async function put(req, res) {
  if (res && res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}
async function fromNetworkFirst(req) {
  try { return await put(req, await fetch(req, { cache: 'no-cache' })); }
  catch (err) {
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = await caches.match('./index.html') || await caches.match('./'); if (shell) return shell; }
    throw err;
  }
}
async function fromCacheFirst(req) {
  const hit = await caches.match(req);
  const net = fetch(req).then(r => put(req, r)).catch(() => null);
  return hit || (await net) || Response.error();
}

// ---------- Web Push ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Ghi Chú', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Ghi Chú';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, requireInteraction: !!d.reminder_id,
      icon: 'img/logo/icon-192.png', badge: 'img/logo/icon-192.png', data: { url: d.url || './#/nhac-viec', reminder_id: d.reminder_id || null },
    });
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'push', data: d });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) if (c.url.startsWith(self.registration.scope)) { await c.focus(); try { await c.navigate(target); } catch {} return; }
    await self.clients.openWindow(target);
  })());
});
