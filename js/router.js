// Barber slug from the URL. Supported forms (GitHub Pages is static):
//   /b/<slug>        -> 404.html redirects to ?b=<slug>, then we restore the pretty URL
//   ?b=<slug>        and  #/b/<slug>
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const SLUG_MAX = 40;

function rawSlugParts() {
  const fromPath = location.pathname.match(/\/b\/([^/?#]*)\/?$/)?.[1];
  const q = new URLSearchParams(location.search);
  const hasQuery = q.has('b');
  const fromQuery = hasQuery ? q.get('b') : null;
  const fromHash = location.hash.match(/^#\/b\/([^/?#]*)/)?.[1];
  return { fromPath, fromQuery, hasQuery, fromHash };
}

export function siteBase() {
  const i = location.pathname.indexOf('/b/');
  if (i >= 0) return location.pathname.slice(0, i + 1);
  return location.pathname.replace(/[^/]*$/, '');      // folder of index.html
}

/** Valid slug or null. Invalid / empty / too-long explicit values do not fall back here. */
export function getSlug() {
  const { fromPath, fromQuery, fromHash } = rawSlugParts();
  const raw = decodeURIComponent(fromPath || fromQuery || fromHash || '').toLowerCase();
  return SLUG_RE.test(raw) ? raw : null;
}

/**
 * How the URL names a business:
 *   none     – no ?b= / /b/ / #/b/ → caller may use the demo default
 *   ok       – well-formed slug
 *   invalid  – present but empty, too long, or not matching SLUG_RE
 */
export function slugAttempt() {
  const { fromPath, fromQuery, hasQuery, fromHash } = rawSlugParts();
  const explicit = fromPath != null || hasQuery || fromHash != null;
  if (!explicit) return { kind: 'none' };
  let raw = '';
  try {
    raw = decodeURIComponent(fromPath || fromQuery || fromHash || '').toLowerCase();
  } catch {
    return { kind: 'invalid', raw: '' };
  }
  if (!raw || raw.length > SLUG_MAX || !SLUG_RE.test(raw)) return { kind: 'invalid', raw };
  return { kind: 'ok', slug: raw };
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
