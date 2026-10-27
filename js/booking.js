// Booking flow for ONE provider (legacy staff slug, or a business slug + chosen provider): service -> date -> free/busy grid -> dialog (name + phone) -> demo_book.
// Privacy: the page only learns whether a time is free; busy times carry no name, service or other detail.
import { api, friendlyError } from './api.js';
import { $, h, muted, toast, shekel, providerLabel } from './ui.js';
import { fmtTime, todayISO, addDays, fmtLongDate, fmtShortWeekday, dayOfMonth } from './time.js';
import { DAYS_AHEAD } from './config.js';

const state = { scope: null, barber: null, services: [], serviceId: null, date: todayISO(), pending: null };

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

function renderServices() {
  const box = $('#service-list');
  if (!state.services.length) { box.replaceChildren(muted(`ל${providerLabel(state.barber)} זה אין שירותים`)); return; }
  box.replaceChildren(...state.services.map((s) =>
    h('button', { class: 'svc', type: 'button', 'aria-pressed': String(s.service_id === state.serviceId),
                  onclick: () => { state.serviceId = s.service_id; renderServices(); loadSlots(); } },
      h('span', {}, h('b', {}, s.name), h('small', {}, describeSteps(s.steps) || `${s.total_duration_min} דק׳`)),
      h('span', { class: 'price' }, shekel(s.price)))));
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
  const sel = strip.querySelector('[aria-pressed=true]');   // scroll only the strip, never the page
  if (sel) strip.scrollLeft = sel.offsetLeft - strip.clientWidth / 2 + sel.offsetWidth / 2;
}

let slotReq = 0;
export async function loadSlots() {
  const box = $('#slots');
  if (!state.serviceId || !state.barber) return;
  const my = ++slotReq;
  box.replaceChildren(muted('טוען שעות…'));
  try {
    const rows = await api.slotGrid(state.scope, state.serviceId, state.date);
    if (my !== slotReq) return;               // a newer request superseded this one
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
    h('h3', {}, '⭐ מומלץ – נכנס בזמן המתנה ביומן'), h('div', { class: 'slot-grid' }, fills.map(btn))));
  const by = { 'בוקר': [], 'צהריים': [], 'ערב': [] };
  for (const r of rest) { const hr = Number(fmtTime(r.slot_start).slice(0, 2)); by[hr < 12 ? 'בוקר' : hr < 16 ? 'צהריים' : 'ערב'].push(r); }
  for (const [label, list] of Object.entries(by)) if (list.length)
    parts.push(h('div', { class: 'slot-group' }, h('h3', {}, label), h('div', { class: 'slot-grid' }, list.map(btn))));
  box.replaceChildren(...parts);
}

function openDialog(slot) {
  const svc = state.services.find((s) => s.service_id === state.serviceId);
  state.pending = slot;
  $('#book-summary').replaceChildren(
    h('div', {}, h('b', {}, svc.name), ' אצל ', h('b', {}, state.barber.display_name)),
    h('div', {}, `${fmtLongDate(state.date)}, `, h('bdi', { dir: 'ltr' }, `${fmtTime(slot.slot_start)}–${fmtTime(slot.slot_end)}`)),
    h('div', {}, `מחיר: ${shekel(svc.price)}`),
    slot.is_dead_time_fill ? h('div', {}, h('span', { class: 'badge' }, 'בזמן המתנה ביומן')) : null);
  $('#book-error').textContent = '';
  $('#book-dialog').showModal();
  $('#book-form').elements.name.focus();
}

async function submitBooking(ev) {
  ev.preventDefault();
  const f = ev.target, btn = $('#book-submit');
  const name = f.elements.name.value.trim(), phone = f.elements.phone.value.trim();
  if (name.length < 2) { $('#book-error').textContent = 'נא להזין שם'; return; }
  btn.disabled = true; $('#book-error').textContent = '';
  try {
    const res = await api.book({ scope: state.scope, serviceId: state.serviceId,
                                 startsAt: state.pending.slot_start, name, phone });
    $('#book-dialog').close();
    toast(`התור נקבע ל-${fmtTime(res.starts_at)} ✔`);
    loadSlots();
  } catch (e) {
    $('#book-error').textContent = friendlyError(e);
    if ((e.message || '').includes('slot not available')) loadSlots();
  } finally { btn.disabled = false; }
}
