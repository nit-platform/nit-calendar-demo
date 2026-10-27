// Cloudflare Turnstile for the waitlist join (only when WAITLIST_VIA_FUNCTION). The script is loaded on demand
// (CSP script-src/frame-src already allow challenges.cloudflare.com); the token is checked by the
// `waitlist-join` Edge Function with Cloudflare siteverify. Tokens are single-use: reset after every attempt.
import { TURNSTILE_SITE_KEY } from './config.js';

let widgetId = null, token = '', loading = null;

function load() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  loading ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onerror = () => { loading = null; fail(new Error('turnstile not loaded')); };
    s.onload = () => { const t0 = Date.now(); (function poll() {
      if (window.turnstile?.render) return ok(window.turnstile);
      if (Date.now() - t0 > 15000) return fail(new Error('turnstile not loaded'));
      setTimeout(poll, 100); })(); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function initWlCaptcha(el) {
  if (!TURNSTILE_SITE_KEY) return;
  el.classList.remove('hidden');
  if (widgetId !== null) return;
  try {
    const ts = await load();
    if (widgetId !== null) return;
    widgetId = ts.render(el, {
      sitekey: TURNSTILE_SITE_KEY, language: 'he', action: 'waitlist-join',
      callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; },
    });
  } catch { /* token stays empty -> join shows a Hebrew error */ }
}
export const wlCaptchaToken = () => token;
export function resetWlCaptcha() {
  token = '';
  if (widgetId !== null) try { window.turnstile.reset(widgetId); } catch { /* ignore */ }
}
