// Public configuration. The publishable key is safe to publish: it can only call the demo_* RPCs
// (see supabase/migrations/20261026000006_demo_api.sql). NEVER put the service-role key here.
export const SUPABASE_URL = 'https://txdubkiyaceyassjcizc.supabase.co';
// Publishable key (sb_publishable_…): public by design; access is enforced by RLS + grants. Replaces the legacy anon JWT.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_N6mp7j78JHWDJCGnuHKbWg_wh7ZLYeS';
// Compatibility alias: GitHub Pages caches modules for 10 min, so a browser can pair this config.js with an
// older cached api.js/sb.js that still imports SUPABASE_ANON_KEY. Without this export that module fails to
// link and the page hangs on 'טוען…'. Same (publishable) value; safe to remove after a later release.
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;
export const TIMEZONE = 'Asia/Jerusalem';
export const DAYS_AHEAD = 14;
// Cloudflare Turnstile public site key (owner email-OTP login). Public by design.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFnF9X2tOtdv1I-n';
