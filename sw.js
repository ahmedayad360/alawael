/* عامل الخدمة — يجعل التطبيق يعمل بلا إنترنت بعد أول فتح */
const VERSION = 'alawael-v1';
const SHELL = [
  './app.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // لا نتدخّل في أي طلب خارجي

  // التنقّل: من الكاش أولاً ثم الشبكة (يعمل أوفلاين)
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).catch(() => caches.match('./app.html')))
    );
    return;
  }
  // بقية الملفات: كاش أولاً ثم الشبكة مع تحديث الكاش
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
