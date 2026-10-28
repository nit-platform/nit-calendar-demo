// Barber slug from the URL. Supported forms (GitHub Pages is static):
//   /b/<slug>        -> 404.html redirects to ?b=<slug>, then we restore the pretty URL
//   ?b=<slug>        and  #/b/<slug>
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function siteBase() {
  const i = location.pathname.indexOf('/b/');
  if (i >= 0) return location.pathname.slice(0, i + 1);
  return location.pathname.replace(/[^/]*$/, '');      // folder of index.html
}

export function getSlug() {
  const fromPath = location.pathname.match(/\/b\/([^/?#]+)\/?$/)?.[1];
  const fromQuery = new URLSearchParams(location.search).get('b');
  const fromHash = location.hash.match(/^#\/b\/([^/?#]+)/)?.[1];
  const raw = decodeURIComponent(fromPath || fromQuery || fromHash || '').toLowerCase();
  return SLUG_RE.test(raw) ? raw : null;
}

/** True while the URL still carries an OAuth/PKCE (or implicit) callback payload. */
export function hasAuthCallback() {
  const q = new URLSearchParams(location.search);
  if (q.has('code') || q.has('error') || q.has('error_description')) return true;
  const h = location.hash || '';
  // implicit grant / older supabase: tokens or error in the hash fragment
  if (/(?:^[#&]|[#&])(?:access_token|refresh_token|error|provider_token)=/.test(h)) return true;
  return false;
}

/** Show the canonical pretty URL /b/<slug> (keeps the #day hash). Skips while OAuth params present. */
export function canonicalize(slug) {
  if (hasAuthCallback()) return;
  const view = location.hash === '#day' ? '#day' : '';
  const pretty = `${siteBase()}b/${slug}${view}`;
  if (location.pathname + location.hash !== pretty) history.replaceState(null, '', pretty);
}
