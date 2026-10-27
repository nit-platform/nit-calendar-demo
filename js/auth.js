// Customer Google auth for the public booking page (separate session from owner dashboard).
// Uses PKCE + localStorage; never touches service_role. Owners of the same business are
// rejected by customer_* RPCs (private.is_member). Manage-token remains the anon fallback.
import { GOOGLE_SIGNIN_ENABLED, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const { createClient } = window.supabase;

/** Dedicated client so booking RPCs (anon, persistSession:false) stay unchanged. */
export const customerSb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'nit-customer-auth',
  },
});

export function googleSignInEnabled() { return GOOGLE_SIGNIN_ENABLED === true; }

/** Redirect back to the current booking page (path + ?b= slug, no hash secrets). */
export function bookingRedirectUrl() {
  const u = new URL(location.href);
  u.hash = '';
  // Drop one-shot manage/offer tokens from the return URL.
  u.searchParams.delete('manage');
  u.searchParams.delete('offer');
  return u.origin + u.pathname + (u.search || '');
}

export async function getCustomerSession() {
  if (!googleSignInEnabled()) return null;
  const { data } = await customerSb.auth.getSession();
  return data.session ?? null;
}

export async function signInWithGoogle() {
  if (!googleSignInEnabled()) throw new Error('Google sign-in disabled');
  const { error } = await customerSb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: bookingRedirectUrl(), queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function signOutCustomer() {
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
