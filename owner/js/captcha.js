// Cloudflare Turnstile for the email-OTP login (explicit render). The token is sent as
// options.captchaToken to signInWithOtp; Supabase Auth checks it once CAPTCHA protection is enabled
// (before that it is simply ignored). verifyOtp does not need a token. Google OAuth is unaffected.
import { TURNSTILE_SITE_KEY } from '../../js/config.js';

let widgetId = null, token = '';

function whenLoaded(ms = 15000) {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    (function poll() {
      if (window.turnstile?.render) return ok(window.turnstile);
      if (Date.now() - t0 > ms) return fail(new Error('turnstile not loaded'));
      setTimeout(poll, 100);
    })();
  });
}

/** Render the widget into `el` once. Safe to call repeatedly. */
export async function initCaptcha(el) {
  if (widgetId !== null || !TURNSTILE_SITE_KEY) return;
  try {
    const ts = await whenLoaded();
    if (widgetId !== null) return;
    widgetId = ts.render(el, {
      sitekey: TURNSTILE_SITE_KEY, language: 'he', action: 'owner-otp',
      callback: (t) => { token = t; },
      'expired-callback': () => { token = ''; },
      'error-callback': () => { token = ''; },
    });
  } catch { /* token stays empty -> login shows a Hebrew error */ }
}

/** Current token ('' if the challenge was not solved yet). */
export const captchaToken = () => token;

/** Turnstile tokens are single-use: reset after every attempt. */
export function resetCaptcha() {
  token = '';
  if (widgetId !== null) try { window.turnstile.reset(widgetId); } catch { /* ignore */ }
}
