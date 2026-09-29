// Service Worker «Арены Работы»: только веб-пуш (без кэширования страниц).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = { title: 'Арена Работы', body: '', url: '/' };
  try { m = Object.assign(m, e.data ? e.data.json() : {}); } catch (_) { /* пустой или не JSON */ }
  e.waitUntil(self.registration.showNotification(m.title, {
    body: m.body, icon: '/icon.svg', badge: '/icon.svg', tag: m.url, renotify: true, data: { url: m.url }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
