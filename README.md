# NIT – דמו הזמנת תור (Hebrew booking demo)

לכל ספר יש דף משלו בכתובת משלו. אין בחירת ספר ואין רשימת ספרים/עסקים, לא באתר ולא ב-API.
הדף פונה רק לפונקציות `demo_*` ב-Supabase, וכל אחת מהן מקבלת slug ועובדת רק לעסק שמסומן `is_demo`.

**English:** a static site (no build step) that loads supabase-js from a CDN. Every barber has a standalone page:

- `https://<user>.github.io/<repo>/b/<slug>`: the pretty URL. GitHub Pages serves `404.html`, which
  redirects to `?b=<slug>` (keeping the `#hash`), and `index.html` then restores `/b/<slug>` with `history.replaceState`.
- Fallbacks: `?b=<slug>` and `#/b/<slug>`.
- With no slug or an unknown slug, the page shows "הדף לא נמצא". There is no list.

Seeded demo pages: `/b/avi` and `/b/dani`.

## Files
- `index.html`, `404.html` (SPA redirect), `.nojekyll`
- `css/styles.css`
- `js/config.js`: Supabase URL, anon key (public-safe), timezone, days ahead
- `js/router.js`: reads the slug from the path, `?b=` or `#/b/`, and canonicalizes the URL
- `js/api.js`: RPC wrappers plus Hebrew error messages
- `js/main.js`, `js/booking.js`, `js/time.js`, `js/ui.js`

## RPCs (anon, SECURITY DEFINER, is_demo only, by slug)
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
