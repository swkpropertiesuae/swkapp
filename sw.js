const C = 'swk-daily-v1', A = ['.', 'index.html', 'app.js', 'calc.js', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg']
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(A)).then(() => self.skipWaiting())))
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => clients.claim())))
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))))
