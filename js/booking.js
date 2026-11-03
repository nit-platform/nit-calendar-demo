// Booking flow for ONE provider (legacy staff slug, or a business slug + chosen provider): service -> date -> available slots only -> dialog (name + phone) -> book / hold+Google.
// Privacy: the picker shows only free times; unavailable/taken hours are omitted (no greyed busy buttons).
// K2/K3/K4 (booking-1min): nearest free slot shortcut, auto-skip single service, jump-to-next-free-day CTA.
// Remember details: name+phone only in localStorage per business slug (never tokens/secrets).
import { api, friendlyError, HOLD_VIA_FUNCTION } from './api.js';
import { $, h, muted, toast, shekel, providerLabel } from './ui.js';
import { fmtTime, todayISO, addDays, fmtLongDate, fmtShortWeekday, dayOfMonth } from './time.js';
import { normalizeName, contactError } from './validate.js';
import { DAYS_AHEAD } from './config.js';
import { addToken, renderInbox } from './waitlist.js';
import { saveManageLink, bookingManageLink } from './manage.js';
import * as auth from './auth.js';
import { setWelcomeSkip } from './welcome.js';
import { initBookCaptcha, bookCaptchaToken, resetBookCaptcha } from './book-captcha.js';

const state = { scope: null, provider: null, services: [], serviceId: null, date: todayISO(), pending: null };
const HOLD_KEY = 'nit-pending-hold';
const REMEMBER_KEY = (slug) => `nit-remember:${slug}`;

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

/** Non-sensitive contact recall only (name + phone). Never tokens or secrets. */
function loadRemembered(slug) {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(REMEMBER_KEY(slug));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
    const phone = typeof o.phone === 'string' ? o.phone.trim().slice(0, 32) : '';
    if (name.length < 2 || phone.length < 9) return null;
    return { name, phone };
  } catch { return null; }
}
function saveRemembered(slug, name, phone) {
  if (!slug) return;
  try {
    localStorage.setItem(REMEMBER_KEY(slug), JSON.stringify({ name: String(name).trim().slice(0, 60), phone: String(phone).trim().slice(0, 32) }));
  } catch { /* storage disabled */ }
}
function clearRemembered(slug) {
  if (!slug) return;
  try { localStorage.removeItem(REMEMBER_KEY(slug)); } catch { /* ignore */ }
}
function rememberSlug() {
  return state.scope?.slug || null;
}

export async function initBooking({ scope, provider }) {
  state.scope = scope; state.provider = provider;
  if (provider) loadServices();
  else {
    hideQuickSlot();
    const svcStep = $('#service-step');
    if (svcStep) svcStep.classList.remove('hidden');
  }
  const di = $('#date-input');
  di.min = todayISO(); di.max = addDays(todayISO(), DAYS_AHEAD); di.value = state.date;
  const onDateInput = () => {
    if (!di.value) return;
    const min = di.min, max = di.max;
    if (di.value < min) {
      di.value = min;
      toast('התאריך מוקדם מדי — עודכן ליום הראשון הזמין', true);
      setDate(min); return;
    }
    if (di.value > max) {
      di.value = max;
      toast('התאריך מאוחר מדי — עודכן ליום האחרון הזמין', true);
      setDate(max); return;
    }
    setDate(di.value);
  };
  di.addEventListener('change', onDateInput);
  di.addEventListener('input', onDateInput);
  $('#date-prev').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('#date-next').addEventListener('click', () => setDate(addDays(state.date, 1)));
  wireDateStripScroll();
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
           label: svc ? `${svc.name}${state.provider?.display_name ? ` אצל ${state.provider.display_name}` : ''}` : '' };
}

/** Business link: switch to another provider of the same business. */
export function selectStaff(staffId, provider) {
  state.scope = { ...state.scope, staffId }; state.provider = provider;
  state.serviceId = null; state.services = []; slotReq++; quickReq++;
  hideQuickSlot();
  const svcStep = $('#service-step');
  if (svcStep) svcStep.classList.remove('hidden');
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
  const svcStep = $('#service-step');
  if (!state.services.length) {
    if (svcStep) svcStep.classList.remove('hidden');
    hideQuickSlot();
    box.replaceChildren(muted(state.provider.display_name ? `ל${providerLabel(state.provider)} זה אין שירותים` : 'אין כרגע שירותים זמינים'));
    return;
  }
  // K3: single service — silent select + hide card; load slots immediately.
  if (state.services.length === 1) {
    const only = state.services[0];
    state.serviceId = only.service_id;
    if (svcStep) svcStep.classList.add('hidden');
    box.replaceChildren();
    loadSlots();
    refreshQuickSlot();
    return;
  }
  if (svcStep) svcStep.classList.remove('hidden');
  // Keep prior selection if still present; otherwise wait for a tap (no silent multi pick).
  if (state.serviceId && !state.services.some((s) => s.service_id === state.serviceId)) {
    state.serviceId = null;
  }
  box.replaceChildren(...state.services.map((s) =>
    h('button', { class: 'svc', type: 'button', 'aria-pressed': String(s.service_id === state.serviceId),
                  onclick: () => { state.serviceId = s.service_id; renderServices(); loadSlots(); refreshQuickSlot(); } },
      h('span', {}, h('b', {}, s.name), h('small', {}, describeSteps(s.steps) || `${s.total_duration_min} דק׳`)),
      h('span', { class: 'price' }, priceText(s)))));
  if (state.serviceId) {
    loadSlots();
    refreshQuickSlot();
  } else {
    hideQuickSlot();
    // Preview nearest slot using the first service so the shortcut appears before a manual pick.
    refreshQuickSlot({ previewServiceId: state.services[0].service_id });
  }
}

function setDate(iso) {
  const min = todayISO(), max = addDays(min, DAYS_AHEAD);
  if (iso < min || iso > max) return;
  state.date = iso; $('#date-input').value = iso; renderDateStrip(); loadSlots();
}

/** Customer-facing end = start + service duration (excludes buffer_after / layout buffer step). */
function customerSlotEnd(slotStart, durationMin) {
  const ms = new Date(slotStart).getTime() + Number(durationMin || 0) * 60000;
  return new Date(ms).toISOString();
}

function wireDateStripScroll() {
  const strip = $('#date-strip');
  const prev = $('#strip-prev'), next = $('#strip-next');
  if (!strip || strip.dataset.scrollWired) return;
  strip.dataset.scrollWired = '1';
  const step = () => Math.max(120, Math.floor(strip.clientWidth * 0.7));
  if (prev) prev.addEventListener('click', () => { strip.scrollBy({ left: step(), behavior: 'smooth' }); }); // RTL: left = toward start
  if (next) next.addEventListener('click', () => { strip.scrollBy({ left: -step(), behavior: 'smooth' }); });
  const sync = () => {
    const wrap = strip.closest('.date-strip-wrap');
    if (!wrap) return;
    const max = strip.scrollWidth - strip.clientWidth - 2;
    const sl = Math.abs(strip.scrollLeft);
    wrap.classList.toggle('at-start', sl <= 2);
    wrap.classList.toggle('at-end', sl >= max);
  };
  strip.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  setTimeout(sync, 0);
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
  if (!state.serviceId || !state.provider) return;
  const my = ++slotReq;
  box.replaceChildren(muted('טוען שעות…'));
  try {
    const rows = await api.slotGrid(state.scope, state.serviceId, state.date);
    if (my !== slotReq) return;
    renderSlots(rows);
  } catch (e) { if (my === slotReq) box.replaceChildren(muted(friendlyError(e))); }
}

/** Prefer a regular free slot; fall back to dead-time fill. */
function pickBestSlot(rows) {
  const free = (rows || []).filter((r) => r.available);
  if (!free.length) return null;
  const nonFill = free.filter((r) => !r.is_dead_time_fill)
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  if (nonFill.length) return nonFill[0];
  return free.slice().sort((a, b) => a.slot_start.localeCompare(b.slot_start))[0];
}

/** Scan dates [fromDate..max] for the first day with an available slot. */
async function findFirstAvailable({ fromDate, serviceId, reqRef } = {}) {
  const svcId = serviceId || state.serviceId;
  if (!svcId || !state.provider || !state.scope) return null;
  const today = todayISO();
  const max = addDays(today, DAYS_AHEAD);
  let d = fromDate || today;
  if (d < today) d = today;
  for (; d <= max; d = addDays(d, 1)) {
    if (reqRef && reqRef.current !== reqRef.mine) return null;
    let rows;
    try { rows = await api.slotGrid(state.scope, svcId, d); }
    catch { continue; }
    if (reqRef && reqRef.current !== reqRef.mine) return null;
    const slot = pickBestSlot(rows);
    if (slot) return { date: d, slot, rows };
  }
  return null;
}

function renderSlots(rows) {
  const box = $('#slots');
  if (!rows.some((r) => r.available)) {
    // K4: CTA to jump to the next free day (not only a muted line).
    const emptyMsg = rows.length
      ? `אין שעות פנויות ב${fmtLongDate(state.date)}`
      : `אין קבלת קהל ב${fmtLongDate(state.date)}`;
    const jump = h('button', {
      type: 'button', class: 'btn primary', id: 'jump-next-free',
      onclick: () => jumpToNextFreeDay(),
    }, 'מחפשים יום פנוי…');
    jump.disabled = true;
    box.replaceChildren(
      h('p', { class: 'muted', id: 'slots-empty-msg' }, emptyMsg),
      h('div', { class: 'actions slots-empty-actions' }, jump),
      h('p', { class: 'muted small' }, 'או בחרו יום אחר למעלה ↑'),
    );
    // Resolve label asynchronously so the button shows the concrete date when found.
    (async () => {
      const found = await findFirstAvailable({ fromDate: addDays(state.date, 1) });
      if (!box.contains(jump)) return;
      if (!found) {
        jump.textContent = 'אין ימים פנויים בטווח';
        jump.disabled = true;
        jump.classList.remove('primary');
        jump.classList.add('ghost');
        return;
      }
      jump.disabled = false;
      jump.dataset.jumpDate = found.date;
      jump.textContent = `קפצו ליום הפנוי הבא — ${fmtLongDate(found.date)}`;
    })().catch(() => {
      if (box.contains(jump)) {
        jump.textContent = 'לא ניתן לבדוק ימים נוספים כרגע';
        jump.disabled = true;
      }
    });
    return;
  }
  // Only available slots — taken/unavailable hours are not shown at all.
  const fills = rows.filter((r) => r.available && r.is_dead_time_fill);
  const rest = rows.filter((r) => r.available && !r.is_dead_time_fill)
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  const btn = (r) => h('button', { class: 'slot' + (r.is_dead_time_fill ? ' fill' : ''), type: 'button',
      'aria-label': `${fmtTime(r.slot_start)}${r.is_dead_time_fill ? ' – בזמן המתנה' : ''}`, onclick: () => openDialog(r) },
      fmtTime(r.slot_start));
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

async function jumpToNextFreeDay() {
  const btn = $('#jump-next-free');
  const known = btn?.dataset?.jumpDate;
  if (known) { setDate(known); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'מחפשים…'; }
  const found = await findFirstAvailable({ fromDate: addDays(state.date, 1) });
  if (!found) {
    toast('אין ימים פנויים בטווח', true);
    if (btn) { btn.textContent = 'אין ימים פנויים בטווח'; btn.disabled = true; }
    return;
  }
  setDate(found.date);
}

let quickReq = 0;
function hideQuickSlot() {
  const step = $('#quick-slot-step');
  if (step) step.classList.add('hidden');
  const body = $('#quick-slot-body');
  if (body) body.replaceChildren();
}

async function refreshQuickSlot({ previewServiceId } = {}) {
  const step = $('#quick-slot-step'), body = $('#quick-slot-body');
  if (!step || !body) return;
  const svcId = state.serviceId || previewServiceId;
  if (!svcId || !state.provider) { hideQuickSlot(); return; }
  const my = ++quickReq;
  const reqRef = { get current() { return quickReq; }, mine: my };
  step.classList.remove('hidden');
  body.replaceChildren(muted('בודקים זמינות…'));
  const found = await findFirstAvailable({ fromDate: todayISO(), serviceId: svcId, reqRef });
  if (my !== quickReq) return;
  if (!found) {
    body.replaceChildren(muted('אין שעה פנויה בטווח הקרוב'));
    return;
  }
  const svc = state.services.find((s) => s.service_id === svcId);
  const applySelection = () => {
    // If preview used another service, commit it before opening the dialog.
    if (state.serviceId !== svcId) {
      state.serviceId = svcId;
      renderServices();
    }
    if (state.date !== found.date) {
      state.date = found.date;
      $('#date-input').value = found.date;
      renderDateStrip();
    }
    openDialog(found.slot);
    // Keep grid in sync after dialog opens.
    loadSlots();
  };
  const kids = [
    h('p', { class: 'quick-slot-meta' },
      h('bdi', { dir: 'ltr' }, `${fmtLongDate(found.date)} · ${fmtTime(found.slot.slot_start)}`),
      svc ? ` · ${svc.name}` : '',
      state.provider.display_name ? ` אצל ${state.provider.display_name}` : ''),
  ];
  if (found.slot.is_dead_time_fill) {
    kids.push(h('p', { class: 'muted small' }, '⭐ בזמן המתנה ביומן'));
  }
  kids.push(h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn primary', id: 'quick-slot-book', onclick: applySelection },
      'קבעו את השעה הזו')));
  body.replaceChildren(...kids);
}

function applyRememberedToForm() {
  const form = $('#book-form');
  if (!form) return;
  const remembered = loadRemembered(rememberSlug());
  const nameEl = form.elements.name, phoneEl = form.elements.phone;
  const remBox = $('#book-remember');
  const remPanel = $('#book-remembered');
  const fields = $('#book-contact-fields');
  if (remembered) {
    nameEl.value = remembered.name;
    phoneEl.value = remembered.phone;
    if (remBox) remBox.checked = true;
    if (remPanel) {
      remPanel.classList.remove('hidden');
      remPanel.replaceChildren(
        h('p', {}, 'נקבע על שם: ', h('b', {}, remembered.name), ' · ', h('bdi', { dir: 'ltr' }, remembered.phone)),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn small ghost', id: 'book-forget', onclick: () => {
            clearRemembered(rememberSlug());
            if (remBox) remBox.checked = false;
            nameEl.value = ''; phoneEl.value = '';
            remPanel.classList.add('hidden');
            remPanel.replaceChildren();
            if (fields) fields.classList.remove('hidden');
            nameEl.focus();
            toast('פרטי הקשר נמחקו מהמכשיר');
          } }, 'שכחו אותי'),
          h('button', { type: 'button', class: 'btn small ghost', id: 'book-edit-contact', onclick: () => {
            if (fields) fields.classList.remove('hidden');
            nameEl.focus();
          } }, 'שינוי פרטים')),
      );
    }
  } else {
    if (remBox) remBox.checked = false;
    if (remPanel) { remPanel.classList.add('hidden'); remPanel.replaceChildren(); }
  }
  if (fields) fields.classList.remove('hidden');
}

async function openDialog(slot) {
  const svc = state.services.find((s) => s.service_id === state.serviceId);
  if (!svc) return;
  state.pending = slot;
  // Customer duration excludes buffer_after (included in slot_end for scheduling only).
  const endTs = customerSlotEnd(slot.slot_start, svc.total_duration_min);
  const summaryKids = [
    state.provider.display_name
      ? h('div', {}, h('b', {}, svc.name), ' אצל ', h('b', {}, state.provider.display_name))
      : h('div', {}, h('b', {}, svc.name)),
    h('div', {}, `${fmtLongDate(state.date)}, `, h('bdi', { dir: 'ltr' }, `${fmtTime(slot.slot_start)}–${fmtTime(endTs)}`),
      ` · ${svc.total_duration_min} דק׳`),
    h('div', {}, `מחיר: ${priceText(svc)}`),
  ];
  if (slot.is_dead_time_fill) {
    summaryKids.push(h('div', {}, h('span', { class: 'badge' }, 'בזמן המתנה ביומן')));
  }
  $('#book-summary').replaceChildren(...summaryKids);
  $('#book-error').textContent = '';
  applyRememberedToForm();
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
  const nameEl = $('#book-form').elements.name;
  if (nameEl && !nameEl.value) nameEl.focus();
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
  if (state.scope.kind === 'biz') {
    if (res.access_token) addToken(state.scope.slug, res.access_token);
    // Always refresh inbox after book so «התור נקבע» appears even when access_token is not re-issued.
    renderInbox(state.scope.slug);
    setTimeout(() => renderInbox(state.scope.slug), 1200);
    import('./main.js').then((m) => m.refreshMyAppts?.(state.scope.slug)).catch(() => {});
  }
  loadSlots();
  refreshQuickSlot();
}

async function submitBooking(ev) {
  ev.preventDefault();
  const f = ev.target, btn = $('#book-submit');
  const nameEl = f.elements.name, phoneEl = f.elements.phone;
  const name = normalizeName(nameEl.value), phone = phoneEl.value.trim();
  nameEl.value = name; // trim spaces-only before validity
  const cerr = contactError(name, phone);
  nameEl.setCustomValidity(cerr && /שם/.test(cerr) ? cerr : '');
  phoneEl.setCustomValidity(cerr && /טלפון/.test(cerr) ? cerr : '');
  if (cerr) {
    $('#book-error').textContent = cerr;
    ( /שם/.test(cerr) ? nameEl : phoneEl).reportValidity();
    return;
  }
  nameEl.setCustomValidity(''); phoneEl.setCustomValidity('');
  const wantRemember = !!(f.elements.remember && f.elements.remember.checked);
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
      // Remember preference applies after a successful confirm; stash flag with hold for resume.
      savePendingHold({
        slug: state.scope.slug,
        staffId: hold.staff_id ?? state.scope.staffId,
        serviceId: hold.service_id ?? state.serviceId,
        startsAt: hold.starts_at ?? state.pending.slot_start,
        holdToken: hold.hold_token,
        expiresAt: hold.expires_at,
        name, phone,
        remember: wantRemember,
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
    const slug = rememberSlug();
    if (wantRemember) saveRemembered(slug, name, phone);
    else clearRemembered(slug);
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
    if (pending.remember) saveRemembered(pending.slug, pending.name, pending.phone);
    else if (pending.remember === false) clearRemembered(pending.slug);
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
