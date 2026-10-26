// Service Worker «Арены Работ»: веб-пуш и страница «Нет интернета» вместо ошибки браузера, когда сайт открыт
// как приложение (или вкладкой) без связи. Страницы и данные не кэшируются: всё всегда свежее с сервера.
const CACHE = 'arena-offline-1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => e.waitUntil(
  // Без страницы «Нет интернета» воркер всё равно ставится — пуш важнее.
  caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))).catch(() => {}).then(() => self.skipWaiting())
));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  // Запрос страницы уходит сразу, не дожидаясь запуска воркера.
  if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
  await self.clients.claim();
})()));

// Только переходы по страницам (GET): ответ сервера как есть; нет сети — страница «Нет интернета».
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate' || e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      return (await e.preloadResponse) || (await fetch(e.request));
    } catch (_) {
      return (await caches.match(OFFLINE)) || Response.error();
    }
  })());
});

self.addEventListener('push', (e) => {
  let m = { title: 'Арена Работ', body: '', url: '/' };
  try { m = Object.assign(m, e.data ? e.data.json() : {}); } catch (_) { /* пустой или не JSON */ }
  e.waitUntil(self.registration.showNotification(m.title, {
    body: m.body, icon: '/icon-192.png', badge: '/badge-96.png', tag: m.url, renotify: true, data: { url: m.url }
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
