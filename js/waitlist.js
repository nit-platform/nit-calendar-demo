// Customer side of the waitlist + in-app inbox (business links only, ?b=<slug>).
// - join: name + phone + date range (+ optional hours) -> public_waitlist_join; the returned random access token is kept
//   on this device (localStorage, max 10 per business) and is the only key to this customer's inbox.
// - inbox: public_inbox(slug, tokens) – reminders/offers sent in-app, own waitlist entries; polled while the page is visible.
// - offer link (?b=<slug>&offer=<token>): public_offer / public_offer_respond. First accept wins (server-side, atomic).
// Every server value is inserted as text, never HTML.
import { api, friendlyError, WAITLIST_VIA_FUNCTION } from './api.js';
import { initWlCaptcha, wlCaptchaToken, resetWlCaptcha } from './wl-captcha.js';
import { $, h, muted, toast } from './ui.js';
import { fmtTime, todayISO, addDays, fmtLongDate } from './time.js';
import { normalizeName, contactError, waitlistRangeError } from './validate.js';

const KEY = (slug) => `nit-access:${slug}`;
const TOKEN_RE = /^[0-9a-f]{64}$/;
export function getTokens(slug) {
  try { return (JSON.parse(localStorage.getItem(KEY(slug)) || '[]')).filter((t) => TOKEN_RE.test(t)).slice(0, 10); } catch { return []; }
}
export function addToken(slug, t) {
  if (!slug || !TOKEN_RE.test(t || '')) return;
  const list = [t, ...getTokens(slug).filter((x) => x !== t)].slice(0, 10);
  try { localStorage.setItem(KEY(slug), JSON.stringify(list)); } catch { /* storage disabled: inbox just stays empty */ }
}
const dayOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const when = (ts) => `${fmtLongDate(dayOf(ts))}, ${fmtTime(ts)}`;

const RESULT = {
  booked: 'התור נקבע ✔', taken: 'מישהו אחר הקדים ותפס את התור. נשארתם ברשימת ההמתנה.', lost: 'מישהו אחר הקדים ותפס את התור. נשארתם ברשימת ההמתנה.',
  already_accepted: 'כבר אישרתם את ההצעה הזו.', declined: 'ההצעה נדחתה. נשארתם ברשימת ההמתנה.', timeout: 'פג תוקף ההצעה.',
  expired: 'פג תוקף ההצעה.', cancelled: 'ההצעה בוטלה.', invalid: 'הקישור לא תקין או שפג תוקפו.',
};

async function respond(slug, token, accept, after) {
  try { const r = await api.offerRespond(slug, token, accept);
    if (r.status === 'booked') toast(`התור נקבע ל-${when(r.starts_at)} ✔`); else toast(RESULT[r.status] || RESULT.invalid, r.status !== 'declined');
    after?.(r); }
  catch (e) { toast(friendlyError(e), true); }
}

// ---------- offer page ----------
export async function renderOffer(slug, token, box) {
  box.replaceChildren(muted('טוען…'));
  const r = TOKEN_RE.test(token) ? await api.offer(slug, token).catch(() => ({ status: 'invalid' })) : { status: 'invalid' };
  if (r.status !== 'open') { box.replaceChildren(h('h2', {}, 'הצעה מרשימת ההמתנה'), h('p', { id: 'offer-status' }, RESULT[r.status] || RESULT.invalid)); return; }
  const done = (res) => box.replaceChildren(h('h2', {}, 'הצעה מרשימת ההמתנה'),
    h('p', { id: 'offer-status' }, res.status === 'booked' ? `התור נקבע ל-${when(res.starts_at)} ✔` : RESULT[res.status] || RESULT.invalid));
  const acc = h('button', { type: 'button', class: 'btn primary', id: 'offer-accept', onclick: () => { acc.disabled = dec.disabled = true; respond(slug, token, true, done); } }, 'אישור התור');
  const dec = h('button', { type: 'button', class: 'btn ghost', id: 'offer-decline', onclick: () => { acc.disabled = dec.disabled = true; respond(slug, token, false, done); } }, 'לא מתאים לי');
  box.replaceChildren(h('h2', {}, 'התפנה תור בשבילכם!'),
    h('div', { class: 'summary' }, h('div', {}, h('b', {}, r.service_name), r.staff_name ? [' אצל ', h('b', {}, r.staff_name)] : null),
      h('div', {}, when(r.slot_start)), h('div', { class: 'muted' }, `ההצעה בתוקף עד ${fmtTime(r.expires_at)}${r.status === 'open' ? ' – מי שמאשר ראשון מקבל' : ''}`)),
    h('div', { class: 'actions' }, dec, acc));
}

// ---------- inbox ----------
const KIND = { confirm: 'התור נקבע', reminder: 'תזכורת לתור', reminder_24h: 'תזכורת לתור', reminder_2h: 'תזכורת לתור', cancel: 'התור בוטל', waitlist_offer: 'התפנה תור מרשימת ההמתנה' };
const ENTRY = { waiting: 'ממתינים', offered: 'יש הצעה!', booked: 'נקבע תור', cancelled: 'בוטל', expired: 'הסתיים' };
let pollTimer = null;
export async function renderInbox(slug) {
  const card = $('#inbox-step'), box = $('#inbox');
  const tokens = getTokens(slug);
  if (!tokens.length) { card.classList.add('hidden'); return; }
  let r; try { r = await api.inbox(slug, tokens); } catch { return; }
  const entries = r.entries || [], notes = r.notifications || [];
  if (!entries.length && !notes.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const rerender = () => renderInbox(slug);
  const entryItem = (e) => h('div', { class: 'item', 'data-entry-id': e.entry_id },
    h('span', {}, h('b', {}, e.service_name), ' · ', e.date_from === e.date_to ? fmtLongDate(e.date_from) : `${fmtLongDate(e.date_from)} – ${fmtLongDate(e.date_to)}`,
      e.window_from ? ` ${e.window_from.slice(0, 5)}–${e.window_to.slice(0, 5)}` : '', h('small', { class: 'muted' }, ` · ${ENTRY[e.status] || ''}`)),
    e.offer?.status === 'open' && e.offer.token
      ? h('span', { class: 'offer-inline' }, `${when(e.offer.slot_start)} (עד ${fmtTime(e.offer.expires_at)}) `,
          h('button', { type: 'button', class: 'btn small primary inbox-accept', onclick: () => respond(slug, e.offer.token, true, rerender) }, 'אישור'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => respond(slug, e.offer.token, false, rerender) }, 'דחייה'))
      : null,
    e.status === 'waiting' || e.status === 'offered'
      ? h('button', { type: 'button', class: 'btn small ghost inbox-leave', onclick: async () => {
          for (const t of tokens) { try { if (await api.waitlistCancel(slug, t, e.entry_id)) { toast('יצאתם מרשימת ההמתנה'); break; } } catch (err) { toast(friendlyError(err), true); break; } }
          rerender(); } }, 'יציאה מהרשימה')
      : null);
  const noteItem = (n) => h('div', { class: 'item' }, h('span', {}, h('b', {}, KIND[n.kind] || 'הודעה'),
    n.starts_at ? ` · ${when(n.starts_at)}` : '',
    (n.service_name && n.service_name !== 'null') ? ` · ${n.service_name}` : '',
    n.at ? h('small', { class: 'muted' }, ` · ${when(n.at)}`) : null));
  const parts = [];
  if (entries.length) parts.push(h('div', {}, h('h3', {}, 'רשימות המתנה'), h('div', { class: 'list' }, ...entries.map(entryItem).filter(Boolean))));
  if (notes.length) parts.push(h('div', {}, h('h3', {}, 'הודעות'), h('div', { class: 'list' }, ...notes.slice(0, 10).map(noteItem).filter(Boolean))));
  box.replaceChildren(...parts);
}
export function startInboxPolling(slug) {
  renderInbox(slug);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') renderInbox(slug); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderInbox(slug); });
}

// ---------- join ----------
export function initWaitlist(slug, selection) {
  const card = $('#waitlist-step'), dlg = $('#wl-dialog'), form = $('#wl-form');
  card.classList.remove('hidden');
  $('#wl-open').addEventListener('click', () => {
    const sel = selection();
    if (!sel.serviceId) { toast('בחרו קודם שירות', true); return; }
    const min = todayISO();
    form.elements.from.min = form.elements.to.min = min;
    form.elements.from.max = form.elements.to.max = addDays(min, 30);
    form.elements.from.value = form.elements.to.value = sel.date && sel.date >= min ? sel.date : min;
    $('#wl-summary').textContent = sel.label || '';
    $('#wl-error').textContent = '';
    dlg.showModal(); form.elements.name.focus();
    if (WAITLIST_VIA_FUNCTION) initWlCaptcha($('#wl-captcha'));
  });
  $('#wl-cancel').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements, sel = selection(), btn = $('#wl-submit');
    const name = normalizeName(f.name.value), phone = f.phone.value.trim();
    const cerr = contactError(name, phone);
    if (cerr) { $('#wl-error').textContent = cerr; return; }
    // Clamp dates to the inputs' min/max before range checks.
    const min = f.from.min || todayISO(), max = f.from.max || addDays(min, 30);
    if (f.from.value && f.from.value < min) f.from.value = min;
    if (f.from.value && f.from.value > max) f.from.value = max;
    if (f.to.value && f.to.value < min) f.to.value = min;
    if (f.to.value && f.to.value > max) f.to.value = max;
    const rerr = waitlistRangeError(f.from.value, f.to.value, f.tfrom.value, f.tto.value);
    if (rerr) { $('#wl-error').textContent = rerr; return; }
    f.name.value = name;
    const captcha = WAITLIST_VIA_FUNCTION ? wlCaptchaToken() : '';
    if (WAITLIST_VIA_FUNCTION && !captcha) { $('#wl-error').textContent = 'נא להשלים את בדיקת האבטחה.'; return; }
    btn.disabled = true; $('#wl-error').textContent = '';
    try {
      const res = await api.waitlistJoin({ slug, staffId: sel.staffId, serviceId: sel.serviceId, from: f.from.value, to: f.to.value,
        timeFrom: f.tfrom.value, timeTo: f.tto.value, name, phone, token: getTokens(slug)[0], captcha });
      addToken(slug, res.access_token);
      dlg.close();
      // same message whatever the server decided (it never says whether a number is blocked)
      toast('נרשמתם לרשימת ההמתנה ✔ אם יתפנה תור תופיע כאן הודעה.');
      renderInbox(slug);
    } catch (e) { $('#wl-error').textContent = friendlyError(e); }
    finally { btn.disabled = false; if (WAITLIST_VIA_FUNCTION) resetWlCaptcha(); }
  });
}
