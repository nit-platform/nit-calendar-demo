// Customer Google auth for the public booking page (separate session from owner dashboard).
// Uses PKCE + localStorage; never touches service_role. Owners of the same business are
// rejected by customer_* RPCs (private.is_member). Manage-token remains the anon fallback.
import { GOOGLE_SIGNIN_ENABLED, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { getSlug, siteBase } from './router.js';
import { toast } from './ui.js';

const { createClient } = window.supabase;

const OAUTH_PENDING_KEY = 'nit-oauth-pending';
const AUTH_ERR = {
  access_denied: 'ההתחברות בוטלה.',
  signup_disabled: 'לא ניתן ליצור חשבון חדש כרגע. פנו לתמיכה או נסו מאוחר יותר.',
  server_error: 'ההתחברות נכשלה. נסו שוב.',
};

/** Dedicated client so booking RPCs (anon, persistSession:false) stay unchanged. */
const detectSessionInUrl = !(typeof window !== 'undefined' && window.__NIT_E2E__?.preserveAuthUrl);
export const customerSb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl,
    flowType: 'pkce',
    storageKey: 'nit-customer-auth',
  },
});

let _authReady = null;
/** Resolves after the first auth event (INITIAL_SESSION / SIGNED_IN) or getSession. */
export function waitForAuthReady() {
  if (!googleSignInEnabled()) return Promise.resolve(null);
  if (typeof window !== 'undefined' && window.__NIT_E2E_SESSION__) return Promise.resolve(window.__NIT_E2E_SESSION__);
  if (_authReady) return _authReady;
  _authReady = new Promise((resolve) => {
    let done = false;
    const finish = (session) => {
      if (done) return;
      done = true;
      try { unsub(); } catch { /* ignore */ }
      resolve(session ?? null);
    };
    const { data: { subscription } } = customerSb.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') finish(session);
    });
    const unsub = () => subscription.unsubscribe();
    customerSb.auth.getSession().then(({ data }) => finish(data.session ?? null)).catch(() => {});
    const ms = (typeof window !== 'undefined' && window.__NIT_E2E__) ? 200 : 2500;
    setTimeout(async () => {
      try {
        const { data } = await customerSb.auth.getSession();
        finish(data.session ?? null);
      } catch { finish(null); }
    }, ms);
  });
  return _authReady;
}

export function googleSignInEnabled() {
  // e2e override (welcome / hold paths without flipping production config).
  if (typeof window !== 'undefined' && window.__NIT_E2E__ && typeof window.__NIT_E2E__.googleEnabled === 'boolean') {
    return window.__NIT_E2E__.googleEnabled;
  }
  return GOOGLE_SIGNIN_ENABLED === true;
}

/**
 * Redirect back to a *real* GitHub Pages file (index via ?b=<slug>), never /b/<slug>.
 * /b/<slug> has no file → Pages serves 404.html; an older 404 dropped ?code= and broke PKCE.
 */
export function bookingRedirectUrl() {
  const slug = getSlug();
  const base = siteBase(); // folder of index.html, ends with /
  if (slug) return location.origin + base + '?b=' + encodeURIComponent(slug);
  const u = new URL(location.href);
  u.hash = '';
  u.searchParams.delete('manage');
  u.searchParams.delete('offer');
  const i = u.pathname.indexOf('/b/');
  if (i >= 0) return u.origin + u.pathname.slice(0, i + 1);
  return u.origin + u.pathname + (u.search || '');
}

export async function getCustomerSession() {
  if (!googleSignInEnabled()) return null;
  if (typeof window !== 'undefined' && window.__NIT_E2E_SESSION__) return window.__NIT_E2E_SESSION__;
  const { data } = await customerSb.auth.getSession();
  return data.session ?? null;
}

function markOAuthPending() {
  try { sessionStorage.setItem(OAUTH_PENDING_KEY, '1'); } catch { /* ignore */ }
}
function clearOAuthPending() {
  try { sessionStorage.removeItem(OAUTH_PENDING_KEY); } catch { /* ignore */ }
}
function hadOAuthPending() {
  try { return sessionStorage.getItem(OAUTH_PENDING_KEY) === '1'; } catch { return false; }
}

export async function signInWithGoogle() {
  if (!googleSignInEnabled()) throw new Error('Google sign-in disabled');
  if (typeof window !== 'undefined' && window.__NIT_E2E__?.blockGoogleRedirect) {
    window.__NIT_E2E__.googleRedirectRequested = true;
    window.__NIT_E2E__.lastRedirectTo = bookingRedirectUrl();
    markOAuthPending();
    return;
  }
  markOAuthPending();
  const { error } = await customerSb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: bookingRedirectUrl(), queryParams: { prompt: 'select_account' } },
  });
  if (error) { clearOAuthPending(); throw error; }
}

export async function signOutCustomer() {
  if (typeof window !== 'undefined' && window.__NIT_E2E_SESSION__) {
    delete window.__NIT_E2E_SESSION__;
    return;
  }
  await customerSb.auth.signOut();
}

/** RPC with the customer JWT (authenticated role). */
export async function customerRpc(name, params) {
  const { data, error } = await customerSb.rpc(name, params);
  if (error) throw error;
  return data;
}

export function onAuthChange(cb) {
  const { data: { subscription } } = customerSb.auth.onAuthStateChange((_e, session) => cb(session));
  return () => subscription.unsubscribe();
}

function readOAuthErrorFromUrl() {
  const q = new URLSearchParams(location.search);
  let err = q.get('error');
  let desc = q.get('error_description') || q.get('error_code') || '';
  if (!err && location.hash) {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    err = h.get('error');
    desc = h.get('error_description') || h.get('error_code') || desc;
  }
  return err ? { err, desc: (desc || '').replace(/\+/g, ' ') } : null;
}

function stripOAuthParamsFromUrl() {
  const u = new URL(location.href);
  ['error', 'error_description', 'error_code', 'code', 'state'].forEach((k) => u.searchParams.delete(k));
  if (/error=|access_token=|refresh_token=/.test(u.hash)) u.hash = '';
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/** Fetch GoTrue public settings (disable_signup). Never throws. */
export async function fetchAuthSettings() {
  if (typeof window !== 'undefined' && window.__NIT_E2E__?.authSettings) return window.__NIT_E2E__.authSettings;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * After redirect: surface OAuth errors, wait for session settle, toast if pending OAuth failed.
 * Call once during booking-page boot (before painting "לא מחוברים").
 */
export async function settleAuthReturn() {
  if (!googleSignInEnabled()) return null;
  const urlErr = readOAuthErrorFromUrl();
  if (urlErr) {
    const key = (urlErr.err || '').toLowerCase();
    const msg = AUTH_ERR[key]
      || (/signup|sign.?up|disabled/i.test(urlErr.desc + key) ? AUTH_ERR.signup_disabled : null)
      || 'ההתחברות נכשלה. נסו שוב.';
    toast(msg, true);
    stripOAuthParamsFromUrl();
    clearOAuthPending();
    return null;
  }
  const session = await waitForAuthReady();
  if (session) { clearOAuthPending(); return session; }
  // Only toast a failed return when we started OAuth ourselves (pending flag).
  // Do not strip ?code= here — supabase-js needs it for PKCE; canonicalize also waits.
  if (hadOAuthPending()) {
    const settings = await fetchAuthSettings();
    if (settings && settings.disable_signup === true) toast(AUTH_ERR.signup_disabled, true);
    else toast('לא הצלחנו להתחבר. נסו שוב.', true);
    clearOAuthPending();
  }
  return null;
}
