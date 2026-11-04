/* NIT PWA service worker — same-origin app shell only. Never caches APIs/auth/cross-origin. */
/* Bump BUILD whenever shell assets change so activate drops the old cache. */
const BUILD = 'v6';
const CACHE = `nit-shell-${BUILD}`;
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './favicon.svg',
  './css/styles.css',
  './css/tokens.css',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './js/theme.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './js/api.js',
  './js/auth.js',
  './js/book-captcha.js',
  './js/booking.js',
  './js/config.js',
  './js/main.js',
  './js/manage.js',
  './js/pwa.js',
  './js/router.js',
  './js/time.js',
  './js/ui.js',
  './js/validate.js',
  './js/waitlist.js',
  './js/welcome.js',
  './js/wl-captcha.js',
  './owner/',
  './owner/index.html',
  './owner/owner.css',
  './owner/js/app.js',
  './owner/js/bookinglink.js',
  './owner/js/calendar.js',
  './owner/js/captcha.js',
  './owner/js/confirm.js',
  './owner/js/days.js',
  './owner/js/holidays.js',
  './owner/js/hours.js',
  './owner/js/onboard.js',
  './owner/js/sb.js',
  './owner/js/services.js',
  './owner/js/settings.js',
  './owner/js/staff.js',
  './owner/js/waitlist.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add one-by-one so a single 404 does not fail the whole install.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (_) { /* offline during install — ignore */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isShellRequest(url) {
  const p = url.pathname;
  // Never treat local API proxies as shell (e2e PostgREST under same origin).
  if (/\/rest\/v1(?:\/|$)/.test(p) || /\/auth\/v1(?:\/|$)/.test(p) || /\/functions\/v1(?:\/|$)/.test(p)) return false;
  if (/\/__e2e(?:\/|$)/.test(p)) return false;
  return true;
}

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const p = url.pathname;
  return p.endsWith('.html') || p.endsWith('/') || /\/nit-calendar-demo\/?$/.test(p);
}

async function networkFirstHtml(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      // Cache a clone of successful same-origin navigations/shell HTML only.
      try { await cache.put(request, fresh.clone()); } catch (_) {}
    }
    return fresh;
  } catch (_) {
    // HTML network failure (navigations): always serve the friendly offline page,
    // never a stale index.html that would resolve /b/<slug> as "business not found".
    const offlineUrl = new URL('offline.html', self.registration.scope).href;
    const offline = await cache.match('./offline.html')
      || await cache.match(offlineUrl)
      || await cache.match('offline.html');
    if (offline) return offline;
    const cached = await cache.match(request) || await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/** Network-first for CSS/JS so deploys are never stuck on a stale shell asset. */
async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      try { await cache.put(request, fresh.clone()); } catch (_) {}
    }
    return fresh;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

/** Cache-first for immutable-ish static assets (icons, fonts, manifest). */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      try { await cache.put(request, fresh.clone()); } catch (_) {}
    }
    return fresh;
  } catch (err) {
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.get('Authorization')) return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (!sameOrigin(url)) return;
  if (!isShellRequest(url)) return;

  if (isHtmlRequest(request, url)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // CSS/JS: network-first so a deploy is never stuck on a stale shell.
  if (/\.(?:css|js)$/i.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  // Icons / fonts / manifest: cache-first (versioned via CACHE bump).
  if (/\.(?:png|svg|webmanifest|ico|woff2?)$/i.test(url.pathname) || url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
