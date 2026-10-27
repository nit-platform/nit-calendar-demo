// Public configuration. The publishable key is safe to publish: it can only call the demo_* / public_* RPCs
// (see supabase/migrations/20261026000006_demo_api.sql and 20261026000011_business_booking_link.sql). NEVER put the service-role key here.
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
// Waitlist join through the `waitlist-join` Edge Function (Turnstile-verified, migration 000015).
// false = legacy direct RPC (works only while private.app_flags.turnstile_required is false).
export const WAITLIST_VIA_FUNCTION = true;
// Business shown when the page is opened without ?b=<slug> (the demo business).
export const DEFAULT_BUSINESS_SLUG = 'nit-demo';

// Customer Google sign-in on the booking page. Provider is enabled on the project;
// new-user signup may still be blocked project-wide (see docs/customer_google_signin.md).
// Flip to false to hide the UI without a redeploy of Auth settings.
export const GOOGLE_SIGNIN_ENABLED = false;
