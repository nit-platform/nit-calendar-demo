// "Booking link" card: the business's public customer URL (…/?b=<public_slug>), a copy button and slug editing.
// The slug is validated here for a quick message and again in the database (check constraint + unique index +
// owner-only guard trigger, migration 000011). All values are inserted as text, never as HTML.
import { sb, q, heError, ownerUrl } from './sb.js';
import { h, toast } from '../../js/ui.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
// Keep in sync with businesses_public_slug_check (20261026000011_business_booking_link.sql).
export const RESERVED = new Set(['admin', 'administrator', 'api', 'app', 'assets', 'auth', 'b', 'billing', 'book', 'booking',
  'calendar', 'css', 'dashboard', 'demo', 'dev', 'docs', 'edit', 'favicon', 'help', 'img', 'images', 'index', 'js', 'login',
  'logout', 'mail', 'manage', 'new', 'nit', 'null', 'owner', 'owners', 'privacy', 'register', 'rest', 'root', 'rpc', 'settings',
  'signin', 'signup', 'static', 'status', 'supabase', 'support', 'system', 'terms', 'test', 'undefined', 'www']);

/** Returns a Hebrew error message, or '' when the slug is valid. */
export function slugError(s) {
  if (s.length < 3 || s.length > 40) return 'הקישור צריך להכיל 3–40 תווים.';
  if (!SLUG_RE.test(s)) return 'מותר רק אותיות אנגליות קטנות, ספרות ומקף (לא בהתחלה או בסוף).';
  if (RESERVED.has(s)) return 'המילה הזו שמורה, בחרו קישור אחר.';
  return '';
}

/** Public customer page URL for a slug: the site root (one level above owner/) + ?b=<slug>. */
export function bookingUrl(slug) {
  const u = new URL('../', ownerUrl());
  u.search = new URLSearchParams({ b: slug }).toString();
  return u.toString();
}

function slugSaveError(err) {
  const m = `${err?.message || ''} ${err?.code || ''}`;
  if (/23505|duplicate key|public_slug_uniq/i.test(m)) return 'הקישור הזה כבר תפוס, בחרו קישור אחר.';
  if (/public_slug is reserved/i.test(m)) return 'המילה הזו שמורה, בחרו קישור אחר.';
  if (/public_slug: owner only/i.test(m)) return 'רק בעל העסק יכול לשנות את הקישור.';
  if (/23514|check constraint/i.test(m)) return 'קישור לא תקין (3–40 תווים: a-z, 0-9, מקף).';
  return heError(err);
}

export function renderBookingLink(ctx) {
  const b = ctx.business;
  const link = h('a', { id: 'booking-url', href: bookingUrl(b.public_slug), target: '_blank', rel: 'noopener', dir: 'ltr' }, bookingUrl(b.public_slug));
  const copyBtn = h('button', { type: 'button', class: 'btn', id: 'booking-copy' }, 'העתקה');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link.href); toast('הקישור הועתק'); }
    catch { toast('לא ניתן להעתיק אוטומטית – סמנו את הקישור והעתיקו ידנית', true); }
  });
  const input = h('input', { name: 'public_slug', id: 'booking-slug', value: b.public_slug, required: true, dir: 'ltr',
    minlength: 3, maxlength: 40, pattern: '[a-z0-9][a-z0-9\\-]*[a-z0-9]', autocomplete: 'off', spellcheck: 'false',
    title: '3–40 תווים: a-z, 0-9, מקף' });
  const err = h('p', { class: 'form-error', id: 'booking-slug-error', role: 'alert' });
  const form = h('form', { class: 'card', id: 'booking-link-form', novalidate: '' }, h('h2', {}, 'קישור הזמנה'),
    h('p', { class: 'muted' }, 'שלחו ללקוחות את הקישור הזה כדי שיקבעו תור אצלכם.'),
    h('div', { class: 'row' }, link, copyBtn),
    h('div', { class: 'row' }, h('label', {}, 'שינוי הקישור (רק בעל העסק)', input)),
    err,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'booking-slug-save' }, 'שמירת קישור')));
  form.addEventListener('submit', async (e) => { e.preventDefault();
    const slug = input.value.trim().toLowerCase(); input.value = slug;
    const msg = slugError(slug);
    err.textContent = msg;
    if (msg) return;
    if (slug === b.public_slug) { toast('לא בוצע שינוי'); return; }
    try { const [row] = await q(sb.from('businesses').update({ public_slug: slug }).eq('id', b.id).select('*'));
      if (!row) throw new Error('permission denied');
      Object.assign(ctx.business, row);
      link.href = bookingUrl(row.public_slug); link.textContent = link.href;
      toast('הקישור עודכן. קישורים ישנים כבר לא יעבדו.'); }
    catch (ex) { err.textContent = slugSaveError(ex); } });
  return form;
}
