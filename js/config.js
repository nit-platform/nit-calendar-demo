// Public configuration. The publishable key is safe to publish: it can only call the demo_* RPCs
// (see supabase/migrations/20261026000006_demo_api.sql). NEVER put the service-role key here.
export const SUPABASE_URL = 'https://txdubkiyaceyassjcizc.supabase.co';
// Publishable key (sb_publishable_…): public by design; access is enforced by RLS + grants. Replaces the legacy anon JWT.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_N6mp7j78JHWDJCGnuHKbWg_wh7ZLYeS';
export const TIMEZONE = 'Asia/Jerusalem';
export const DAYS_AHEAD = 14;
// Cloudflare Turnstile public site key (owner email-OTP login). Public by design.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFnF9X2tOtdv1I-n';
