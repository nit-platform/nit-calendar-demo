# NIT – דמו הזמנת תור (Hebrew booking demo)

לכל עסק יש קישור הזמנה אישי (`?b=<slug>`) שבעל העסק רואה, מעתיק ועורך בממשק הניהול. אין רשימת עסקים, לא באתר ולא ב-API.
הדף פונה רק לפונקציות `public_*` (לפי slug של עסק) ו-`demo_*` (קישורי ספר ישנים של עסק ההדגמה).

**English:** a static site (no build step) that loads supabase-js from a CDN. Every business has a personal booking link
(`businesses.public_slug`, migration 000011), e.g. `https://nit-platform.github.io/nit-calendar-demo/?b=nit-demo`.
The slug is resolved first as a business slug (`public_business`, with a provider picker for that business only),
then as a legacy per-provider demo slug (`demo_barber`, e.g. `/b/avi`). With no slug the demo business (`DEFAULT_BUSINESS_SLUG`) is shown.

- `https://<user>.github.io/<repo>/b/<slug>`: the pretty URL. GitHub Pages serves `404.html`, which
  redirects to `?b=<slug>` (keeping the `#hash`), and `index.html` then restores `/b/<slug>` with `history.replaceState`.
- Fallbacks: `?b=<slug>` and `#/b/<slug>`.
- An unknown slug shows "הדף לא נמצא". There is no list.

Seeded pages: `?b=nit-demo` (demo business), plus legacy provider pages `/b/avi` and `/b/dani`.

## Files
- `index.html`, `404.html` (SPA redirect), `.nojekyll`
- `css/styles.css`
- `js/config.js`: Supabase URL, anon key (public-safe), timezone, days ahead
- `js/router.js`: reads the slug from the path, `?b=` or `#/b/`, and canonicalizes the URL
- `js/api.js`: RPC wrappers plus Hebrew error messages
- `js/main.js`, `js/booking.js`, `js/time.js`, `js/ui.js`

## RPCs (anon, SECURITY DEFINER, fixed search_path)
Business link (any business, by its public slug; staff must belong to that business, otherwise `PT404`):
`public_business(slug)` → name, timezone, provider label, slug, active staff (id + display name only),
`public_list_services(slug, staff_id)`, `public_slot_grid(slug, staff_id, service, date)`,
`public_book(slug, staff_id, service, starts_at, name, phone)`.
If the owner turns off "customers choose provider" (`businesses.customers_choose_provider`, migration 000012), the page shows no staff names, `public_business` returns no staff list, and `staff_id` is null: the first free active staff is assigned server-side (race-safe).
Rate limits (migration 000012): per phone per business per day; per client IP (salted SHA-256 of the first `X-Forwarded-For` entry, hash only) 5 per 10 minutes and 20 per day across businesses; requests without an IP share a per-business "unknown" bucket (10 / 10 min, 30 / day); plus per-business minute/hour caps. Events older than 7 days are purged nightly by pg_cron.

Legacy demo (is_demo only, by staff slug):
`demo_barber(slug)`, `demo_list_services(slug)`, `demo_slots(slug, service, date)`,
`demo_slot_grid(slug, service, date)`, `demo_book(slug, service, starts_at, name, phone)`.

**Privacy:** a customer sees only free and busy times. Busy slots are greyed out and can't be clicked, and they carry no name, service or other detail.
Dead-time slots are still highlighted. The full day calendar (`owner_day_view`) is for authenticated business members only, and this page doesn't use it.
- An unknown slug, or a slug belonging to a non-demo shop, returns HTTP 404 (`PT404`).
- Rate limits return HTTP 429 (`PT429`).
- Invalid input returns 400.

## Local run
ES modules need http, not `file://`. For example, `python3 -m http.server 8080` in this folder, then open
http://localhost:8080/?b=avi. Python's server has no 404.html fallback, so use `?b=`.

Never put the service-role key or the DB password in this repo.

## Owner dashboard (`owner/`) / ממשק בעל העסק
URL: `https://nit-platform.github.io/nit-calendar-demo/owner/`. A static page (supabase-js from a CDN, no build step). It uses only the anon key plus the signed-in user's Supabase Auth session; every read and write goes through RLS (`business_members`).
- Login: email OTP (6-digit code, `signInWithOtp` → `verifyOtp` type `email`) or Google (`signInWithOAuth`, PKCE, `redirectTo` = the owner URL).
- After login the page calls `claim_owner_invites()`. It turns pending invites for the user's **confirmed** email into memberships. Migration 8 seeds `nit.platform@gmail.com` as owner of the demo shop.
- Tabs:
  - יומן (calendar): day and week views per barber, with wait steps and in-wait fills; cancel and no-show.
  - שירותים (services): prices, durations, wait min/max, wait mode, overlap, active, and per-barber offer and price.
  - שעות והפסקות (hours and breaks): working hours, recurring breaks and time-off periods.
  - ימים מיוחדים (special days): manual days, and overriding holidays imported from the calendar.
  - הגדרות (settings): the booking-link card (full URL, copy button, slug editing: a-z 0-9 '-', 3–40 chars, reserved words blocked, unique; owner only, enforced in the DB), business details and booking policies.
- Files: `owner/index.html`, `owner/owner.css`, and in `owner/js/`: `sb.js` (client, Hebrew errors, Israel-time helpers), `app.js` (auth, business choice, tabs), `calendar.js`, `services.js`, `hours.js`, `days.js`, `settings.js`, `bookinglink.js`.
- Required Supabase Auth settings: see the main repo README ("Owner dashboard: Supabase Auth setup").
