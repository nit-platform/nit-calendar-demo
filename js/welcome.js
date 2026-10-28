// First-entry welcome overlay for business booking links (Decision 18 + Nadav steering).
// Skip is sessionStorage only (per tab); returning Supabase session skips entirely.
import * as auth from './auth.js';
import { $ } from './ui.js';
import { toast } from './ui.js';
import { friendlyError } from './api.js';

const skipKey = (slug) => `nit-welcome-skip:${slug}`;

export function hasWelcomeSkip(slug) {
  try { return sessionStorage.getItem(skipKey(slug)) === '1'; } catch { return false; }
}
export function setWelcomeSkip(slug) {
  try { sessionStorage.setItem(skipKey(slug), '1'); } catch { /* private mode */ }
}
export function clearWelcomeSkip(slug) {
  try { sessionStorage.removeItem(skipKey(slug)); } catch { /* ignore */ }
}

export function hideWelcome() {
  const overlay = $('#welcome-screen');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('welcome-open');
}

/** Show welcome on booking view only; never on offer/manage. */
export async function maybeShowWelcome(slug, businessName) {
  const overlay = $('#welcome-screen');
  if (!overlay || !auth.googleSignInEnabled()) return;
  if (!slug) return;
  const session = await auth.getCustomerSession();
  if (session) { hideWelcome(); return; }
  if (hasWelcomeSkip(slug)) { hideWelcome(); return; }
  const nameEl = $('#welcome-biz-name');
  if (nameEl) nameEl.textContent = businessName || '';
  overlay.classList.remove('hidden');
  document.body.classList.add('welcome-open');
  if (overlay.dataset.wired) return;
  overlay.dataset.wired = '1';
  $('#welcome-google')?.addEventListener('click', async () => {
    // Persist skip before OAuth so return never loops the welcome screen.
    setWelcomeSkip(slug);
    try { await auth.signInWithGoogle(); }
    catch (e) { toast(friendlyError(e), true); }
  });
  $('#welcome-skip')?.addEventListener('click', () => {
    setWelcomeSkip(slug);
    hideWelcome();
  });
}

if (typeof window !== 'undefined') {
  window.__NIT_WELCOME__ = { hasWelcomeSkip, setWelcomeSkip, clearWelcomeSkip, skipKey };
}
