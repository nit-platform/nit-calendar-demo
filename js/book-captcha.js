// Cloudflare Turnstile for booking-hold (Decision 18). Separate widget from waitlist.
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

export async function initBookCaptcha(el) {
  if (!TURNSTILE_SITE_KEY || !el) return;
  el.classList.remove('hidden');
  if (widgetId !== null) return;
  try {
    const ts = await load();
    if (widgetId !== null) return;
    widgetId = ts.render(el, {
      sitekey: TURNSTILE_SITE_KEY, language: 'he', action: 'booking-hold',
      callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; },
    });
  } catch { /* token empty -> hold shows Hebrew error */ }
}
export const bookCaptchaToken = () => token;
export function resetBookCaptcha() {
  token = '';
  if (widgetId !== null) try { window.turnstile.reset(widgetId); } catch { /* ignore */ }
}
