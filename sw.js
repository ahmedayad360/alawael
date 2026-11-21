/* عامل الخدمة — يعمل والتطبيق مغلق، ويستقبل الإشعارات الفورية */
const VERSION = 'alawael-v14';
const SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  /* نحذف الكاش القديم فقط بعد التأكد من جاهزية نسخة التطبيق في الكاش الجديد
     — وإلا قد يبقى المتصفح بلا نسخة صالحة فيظهر له خطأ/صفحة فارغة. */
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.match('./app.html')
        .then((hit) => hit || c.add('./app.html').catch(() => {}))
        .then(() => c.match('./index.html').then((hit) => hit || c.add('./index.html').catch(() => {})))
        .then(() => c.match('./').then((hit) => hit || c.add('./').catch(() => {}))))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

/* ============================ الإشعارات ============================ */
self.addEventListener('push', (e) => {
  let data = { title: 'مدارس الأوائل', body: 'لديك إشعار جديد', url: './app.html' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch (err) {
    try { data.body = e.data.text(); } catch (err2) {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || './app.html' }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './app.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('app.html') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* ============================ الشبكة ============================ */
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
  if (url.origin !== location.origin) return;
  /* ملف عامل الخدمة نفسه: لا نخزّنه أبداً — وإلا بقي المتصفح على نسخة قديمة */
  if (/(^|\/)sw\.js(\?|$)/.test(url.pathname)) return;
  /* إعدادات السحابة يجب أن تُقرأ من الشبكة دائماً (حتى لا تبقى نسخة قديمة فارغة) */
  if (/cloud-config\.js$/.test(url.pathname)) return;

  // صفحات التنقّل: الشبكة أولاً (لتصل التحديثات فوراً)، والكاش عند انقطاع الإنترنت
  if (req.mode === 'navigate' || /\.html($|\?)/.test(url.pathname)) {
    e.respondWith(
      fromNetwork(req, 4000)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./app.html')
          .then((shell) => shell || caches.match('./index.html').then((idx) => idx || caches.match('./')))))
    );
    return;
  }

  // الملفات الثابتة: الكاش أولاً ثم الشبكة
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
