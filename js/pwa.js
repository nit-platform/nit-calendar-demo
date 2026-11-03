// Progressive Web App helpers: dynamic manifest (?b= preserved), SW register, update prompt.
const THEME = '#1f3a5f';
const BG = '#f6f4f0';

function isOwnerPath() {
  return /\/owner(?:\/|$)/.test(location.pathname);
}

function siteRootUrl() {
  // Document directory for customer; parent of /owner/ for dashboard.
  const here = new URL('.', location.href);
  if (isOwnerPath()) return new URL('../', here);
  return here;
}

function iconList(root) {
  return [
    { src: new URL('icons/icon-192.png', root).href, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: new URL('icons/icon-512.png', root).href, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: new URL('icons/icon-512-maskable.png', root).href, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
}

/** Build a blob manifest so start_url keeps ?b=<slug> when installed from a business link. */
export function applyManifest({ slug } = {}) {
  const owner = isOwnerPath();
  const root = siteRootUrl();
  const manifest = {
    name: owner ? 'NIT ניהול' : 'NIT יומן',
    short_name: 'NIT',
    description: owner ? 'ניהול העסק ב-NIT' : 'יומן חכם לעסקי שירות',
    dir: 'rtl',
    lang: 'he',
    display: 'standalone',
    orientation: 'any',
    background_color: BG,
    theme_color: THEME,
    // Relative to the page URL (blob manifests resolve against the document).
    start_url: owner ? './' : (slug ? `./?b=${encodeURIComponent(slug)}` : './'),
    scope: './',
    id: owner ? './owner/' : './',
    icons: iconList(root),
  };

  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.dataset.blobUrl) {
    try { URL.revokeObjectURL(link.dataset.blobUrl); } catch (_) { /* ignore */ }
  }
  const json = JSON.stringify(manifest);
  const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/manifest+json' }));
  link.dataset.blobUrl = blobUrl;
  // Expose for e2e / debugging without fetching blob: (connect-src does not allow blob:).
  link.dataset.nitManifest = json;
  link.href = blobUrl;
}

function showUpdateToast() {
  if (sessionStorage.getItem('nit-pwa-update-shown') === '1') return;
  const el = document.getElementById('toast');
  if (!el) return;
  sessionStorage.setItem('nit-pwa-update-shown', '1');
  el.textContent = 'יש גרסה חדשה. לחצו לרענון.';
  el.classList.add('show');
  el.classList.remove('err');
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => { location.reload(); }, { once: true });
}

async function registerSw() {
  if (!('serviceWorker' in navigator)) return null;
  const root = siteRootUrl();
  const swUrl = new URL('sw.js', root);
  try {
    const reg = await navigator.serviceWorker.register(swUrl.href, { scope: root.href });
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('nit-pwa-had-controller') === '1') showUpdateToast();
      sessionStorage.setItem('nit-pwa-had-controller', '1');
    });
    if (navigator.serviceWorker.controller) sessionStorage.setItem('nit-pwa-had-controller', '1');
    return reg;
  } catch (err) {
    console.warn('NIT PWA: SW register failed', err);
    return null;
  }
}

/** Call once on boot. Pass business slug when known so install keeps ?b=. */
export async function initPwa({ slug } = {}) {
  applyManifest({ slug });
  return registerSw();
}
