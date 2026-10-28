// Booking flow for ONE provider (legacy staff slug, or a business slug + chosen provider): service -> date -> free/busy grid -> dialog (name + phone) -> book / hold+Google.
// Privacy: the page only learns whether a time is free; busy times carry no name, service or other detail.
import { api, friendlyError, HOLD_VIA_FUNCTION } from './api.js';
import { $, h, muted, toast, shekel, providerLabel } from './ui.js';
import { fmtTime, todayISO, addDays, fmtLongDate, fmtShortWeekday, dayOfMonth } from './time.js';
import { DAYS_AHEAD } from './config.js';
import { addToken, renderInbox } from './waitlist.js';
import { saveManageLink, bookingManageLink } from './manage.js';
import * as auth from './auth.js';
import { setWelcomeSkip } from './welcome.js';
import { initBookCaptcha, bookCaptchaToken, resetBookCaptcha } from './book-captcha.js';

const state = { scope: null, barber: null, services: [], serviceId: null, date: todayISO(), pending: null };
const HOLD_KEY = 'nit-pending-hold';

function savePendingHold(payload) {
  try { sessionStorage.setItem(HOLD_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
}
function loadPendingHold() {
  try {
    const raw = sessionStorage.getItem(HOLD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearPendingHold() {
  try { sessionStorage.removeItem(HOLD_KEY); } catch { /* ignore */ }
}

export async function initBooking({ scope, barber }) {
  state.scope = scope; state.barber = barber;
  if (barber) loadServices();
  const di = $('#date-input');
  di.min = todayISO(); di.max = addDays(todayISO(), DAYS_AHEAD); di.value = state.date;
  di.addEventListener('change', () => di.value && setDate(di.value));
  $('#date-prev').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('#date-next').addEventListener('click', () => setDate(addDays(state.date, 1)));
  renderDateStrip();
  $('#book-cancel').addEventListener('click', () => $('#book-dialog').close());
  $('#book-form').addEventListener('submit', submitBooking);
  // After Google OAuth return: finish held booking if any.
  resumeHeldBooking().catch(() => {});
}

/** Current choice, for the waitlist dialog. */
export function selection() {
  const svc = state.services.find((s) => s.service_id === state.serviceId);
  return { staffId: state.scope?.staffId ?? null, serviceId: state.serviceId, date: state.date,
           label: svc ? `${svc.name}${state.barber?.display_name ? ` אצל ${state.barber.display_name}` : ''}` : '' };
}

/** Business link: switch to another provider of the same business. */
export function selectStaff(staffId, barber) {
  state.scope = { ...state.scope, staffId }; state.barber = barber;
  state.serviceId = null; state.services = []; slotReq++;
  $('#slots').replaceChildren(muted('בחרו שירות ותאריך'));
  loadServices();
}

let svcReq = 0;
async function loadServices() {
  const box = $('#service-list'), my = ++svcReq;
  box.replaceChildren(muted('טוען…'));
  try { const list = await api.listServices(state.scope); if (my !== svcReq) return; state.services = list; renderServices(); }
  catch (e) { if (my === svcReq) box.replaceChildren(muted(friendlyError(e))); }
}

function describeSteps(steps) {
  if (!steps || steps.length < 2) return '';
  return steps.map((s) => `${s.name} ${s.max_duration_min ? `${s.duration_min}–${s.max_duration_min}` : s.duration_min}′${s.is_blocking ? '' : ' (המתנה)'}`).join(' → ');
}

const priceText = (s) => (s.price_varies ? `החל מ-${shekel(s.price)}` : shekel(s.price));

function renderServices() {
  const box = $('#service-list');
  if (!state.services.length) {
    box.replaceChildren(muted(state.barber.display_name ? `ל${providerLabel(state.barber)} זה אין שירותים` : 'אין כרגע שירותים זמינים'));
    return;
  }
  box.replaceChildren(...state.services.map((s) =>
    h('button', { class: 'svc', type: 'button', 'aria-pressed': String(s.service_id === state.serviceId),
                  onclick: () => { state.serviceId = s.service_id; renderServices(); loadSlots(); } },
      h('span', {}, h('b', {}, s.name), h('small', {}, describeSteps(s.steps) || `${s.total_duration_min} דק׳`)),
      h('span', { class: 'price' }, priceText(s)))));
}

function setDate(iso) {
  const min = todayISO(), max = addDays(min, DAYS_AHEAD);
  if (iso < min || iso > max) return;
  state.date = iso; $('#date-input').value = iso; renderDateStrip(); loadSlots();
}

function renderDateStrip() {
  const days = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(todayISO(), i));
  const strip = $('#date-strip');
  strip.replaceChildren(...days.map((d) =>
    h('button', { class: 'day-chip', type: 'button', 'aria-pressed': String(d === state.date), onclick: () => setDate(d) },
      h('small', {}, fmtShortWeekday(d)), dayOfMonth(d))));
  const sel = strip.querySelector('[aria-pressed=true]');
  if (sel) try { sel.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ }
}

let slotReq = 0;
export async function loadSlots() {
  const box = $('#slots');
  if (!state.serviceId || !state.barber) return;
  const my = ++slotReq;
  box.replaceChildren(muted('טוען שעות…'));
  try {
    const rows = await api.slotGrid(state.scope, state.serviceId, state.date);
    if (my !== slotReq) return;
    renderSlots(rows);
  } catch (e) { if (my === slotReq) box.replaceChildren(muted(friendlyError(e))); }
}

function renderSlots(rows) {
  const box = $('#slots');
  if (!rows.some((r) => r.available)) {
    box.replaceChildren(muted(rows.length ? `אין שעות פנויות ב${fmtLongDate(state.date)}` : `אין קבלת קהל ב${fmtLongDate(state.date)}`));
    return;
  }
  const fills = rows.filter((r) => r.available && r.is_dead_time_fill);
  const rest = rows.filter((r) => !(r.available && r.is_dead_time_fill)).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  const btn = (r) => r.available
    ? h('button', { class: 'slot' + (r.is_dead_time_fill ? ' fill' : ''), type: 'button',
        'aria-label': `${fmtTime(r.slot_start)}${r.is_dead_time_fill ? ' – בזמן המתנה' : ''}`, onclick: () => openDialog(r) },
        fmtTime(r.slot_start))
    : h('button', { class: 'slot busy', type: 'button', disabled: '', 'aria-disabled': 'true',
        'aria-label': `${fmtTime(r.slot_start)} – תפוס` }, fmtTime(r.slot_start));
  const parts = [];
  if (fills.length) parts.push(h('div', { class: 'slot-group fill-group' },
    h('h3', {}, '⭐ מומלץ'), h('div', { class: 'slot-grid' }, fills.map(btn))));
  const by = { 'בוקר': [], 'צהריים': [], 'ערב': [] };
  for (const r of rest) { const hr = Number(fmtTime(r.slot_start).slice(0, 2)); by[hr < 12 ? 'בוקר' : hr < 16 ? 'צהריים' : 'ערב'].push(r); }
  for (const [label, list] of Object.entries(by)) if (list.length)
    parts.push(h('div', { class: 'slot-group' }, h('h3', {}, label), h('div', { class: 'slot-grid' }, list.map(btn))));
  box.replaceChildren(...parts);
  try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ }
}

async function openDialog(slot) {
  const svc = state.services.find((s) => s.service_id === state.serviceId);
  state.pending = slot;
  $('#book-summary').replaceChildren(
    state.barber.display_name
      ? h('div', {}, h('b', {}, svc.name), ' אצל ', h('b', {}, state.barber.display_name))
      : h('div', {}, h('b', {}, svc.name)),
    h('div', {}, `${fmtLongDate(state.date)}, `, h('bdi', { dir: 'ltr' }, `${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}`)),
    h('div', {}, `מחיר: ${priceText(svc)}`),
    slot.is_dead_time_fill ? h('div', {}, h('span', { class: 'badge' }, 'בזמן המתנה ביומן')) : null);
  $('#book-error').textContent = '';
  const session = auth.googleSignInEnabled() ? await auth.getCustomerSession() : null;
  const note = $('#book-auth-note'), holdNote = $('#book-hold-note'), cap = $('#book-captcha');
  const needsHold = state.scope.kind === 'biz' && auth.googleSignInEnabled() && !session;
  if (note) note.classList.toggle('hidden', !session);
  if (holdNote) holdNote.classList.toggle('hidden', !needsHold);
  if (cap) {
    if (needsHold && HOLD_VIA_FUNCTION) {
      await initBookCaptcha(cap);
    } else {
      cap.classList.add('hidden');
    }
  }
  const submit = $('#book-submit');
  if (submit) submit.textContent = needsHold ? 'שמירת שעה והתחברות' : 'קבע תור';
  $('#book-dialog').showModal();
  $('#book-form').elements.name.focus();
}

function finishBookSuccess(res) {
  $('#book-dialog').close();
  const pending = res.status === 'pending';
  toast(pending
    ? `הבקשה נשלחה לאישור העסק · ${fmtTime(res.starts_at)}`
    : `התור נקבע ל-${fmtTime(res.starts_at)} ✔`);
  if (res.manage_token && state.scope.kind === 'biz') {
    saveManageLink(state.scope.slug, res.manage_token);
    const href = bookingManageLink(state.scope.slug, res.manage_token);
    const note = h('div', { class: 'card manage-note' },
      h('p', {}, pending
        ? 'התור ממתין לאישור העסק. השעה שמורה. שמרו את הקישור לניהול / ביטול:'
        : 'שמרו את הקישור לניהול התור (צפייה / ביטול / שינוי מועד):'),
      h('p', {}, h('a', { href, id: 'manage-link' }, 'ניהול התור שלי')));
    const book = $('#view-book');
    const oldN = book.querySelector('.manage-note');
    if (oldN) oldN.remove();
    book.prepend(note);
  }
  if (state.scope.kind === 'biz' && res.access_token) { addToken(state.scope.slug, res.access_token); renderInbox(state.scope.slug); }
  loadSlots();
}

async function submitBooking(ev) {
  ev.preventDefault();
  const f = ev.target, btn = $('#book-submit');
  const name = f.elements.name.value.trim(), phone = f.elements.phone.value.trim();
  if (name.length < 2) { $('#book-error').textContent = 'נא להזין שם'; return; }
  btn.disabled = true; $('#book-error').textContent = '';
  try {
    const session = auth.googleSignInEnabled() ? await auth.getCustomerSession() : null;
    const needsHold = state.scope.kind === 'biz' && auth.googleSignInEnabled() && !session;

    if (needsHold) {
      const captcha = bookCaptchaToken();
      if (HOLD_VIA_FUNCTION && !captcha) {
        $('#book-error').textContent = 'נא להשלים את בדיקת האבטחה.';
        return;
      }
      const hold = await api.holdSlot({
        scope: state.scope, serviceId: state.serviceId, startsAt: state.pending.slot_start, captcha,
      });
      resetBookCaptcha();
      savePendingHold({
        slug: state.scope.slug,
        staffId: hold.staff_id ?? state.scope.staffId,
        serviceId: hold.service_id ?? state.serviceId,
        startsAt: hold.starts_at ?? state.pending.slot_start,
        holdToken: hold.hold_token,
        expiresAt: hold.expires_at,
        name, phone,
      });
      // Avoid welcome loop after OAuth return.
      setWelcomeSkip(state.scope.slug);
      $('#book-dialog').close();
      toast('השעה נשמרה. מתחברים עם Google…');
      await auth.signInWithGoogle();
      return;
    }

    const res = await api.book({ scope: state.scope, serviceId: state.serviceId,
                                 startsAt: state.pending.slot_start, name, phone });
    finishBookSuccess(res);
  } catch (e) {
    $('#book-error').textContent = friendlyError(e);
    resetBookCaptcha();
    if ((e.message || '').includes('slot not available')) loadSlots();
  } finally { btn.disabled = false; }
}

/** After Google redirect: confirm held booking once. */
export async function resumeHeldBooking() {
  const pending = loadPendingHold();
  if (!pending?.holdToken) return;
  if (!auth.googleSignInEnabled()) return;
  const session = await auth.getCustomerSession();
  if (!session) return; // still unsigned — leave hold for later / expiry
  clearPendingHold();
  try {
    const res = await api.confirmHold({
      slug: pending.slug, holdToken: pending.holdToken, name: pending.name, phone: pending.phone,
    });
    // Ensure scope is biz for manage link UI
    if (!state.scope) state.scope = { kind: 'biz', slug: pending.slug, staffId: pending.staffId };
    finishBookSuccess(res);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('hold expired') || msg.includes('slot not available')) {
      try {
        const alts = await api.holdAlternatives({
          scope: { kind: 'biz', slug: pending.slug, staffId: pending.staffId },
          serviceId: pending.serviceId, around: pending.startsAt,
        });
        const n = Array.isArray(alts) ? alts.length : (alts?.length || 0);
        toast(n ? `השריון פג. יש ${n} שעות חלופיות קרובות — בחרו מחדש.` : friendlyError(e), true);
      } catch {
        toast(friendlyError(e), true);
      }
      loadSlots();
    } else {
      toast(friendlyError(e), true);
    }
  }
}
