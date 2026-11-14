/* عامل الخدمة — يجعل التطبيق يعمل بلا إنترنت، ويضمن وصول التحديثات للآيفون */
const VERSION = 'alawael-v2';
const SHELL = [
  './app.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // addAll يفشل كلياً إن نقص ملف واحد — نضيف كل ملف على حدة
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function fromNetwork(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // لا نتدخّل في أي طلب خارجي

  // صفحات التنقّل: الشبكة أولاً (لتصل التحديثات فوراً)، والكاش عند انقطاع الإنترنت
  if (req.mode === 'navigate' || /\.html($|\?)/.test(url.pathname)) {
    e.respondWith(
      fromNetwork(req, 4000)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./app.html')))
    );
    return;
  }

  // الملفات الثابتة (أيقونات، manifest): الكاش أولاً ثم الشبكة
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
