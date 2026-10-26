// Daily timeline for this page's barber: work / wait / buffer segments, and appointments placed inside a wait.
// Base for the future owner dashboard (swap api.dayView for an authenticated query).
import { api, friendlyError } from './api.js';
import { $, h, muted } from './ui.js';
import { fmtTime, todayISO, addDays, minutesOfDay, hhmmToMin, minToHHMM } from './time.js';

const state = { slug: null, date: todayISO() };
const KIND_LABEL = { work: '', wait: 'המתנה', buffer: 'מרווח' };

export function initDayView({ slug }) {
  state.slug = slug;
  const di = $('#day-date'); di.value = state.date;
  di.addEventListener('change', () => { if (di.value) { state.date = di.value; load(); } });
  $('#day-prev').addEventListener('click', () => shift(-1));
  $('#day-next').addEventListener('click', () => shift(1));
}
function shift(n) { state.date = addDays(state.date, n); $('#day-date').value = state.date; load(); }

export function showDay({ date } = {}) {
  if (date) { state.date = date; $('#day-date').value = date; }
  return load();
}

let req = 0;
export async function load() {
  const box = $('#timeline');
  if (!state.slug) return;
  const my = ++req;
  box.replaceChildren(h('div', { class: 'tl-empty' }, 'טוען…'));
  try {
    const [segs, hours] = await Promise.all([api.dayView(state.slug, state.date), api.dayHours(state.slug, state.date)]);
    if (my === req) render(segs, hours);
  } catch (e) { if (my === req) box.replaceChildren(h('div', { class: 'tl-empty' }, friendlyError(e))); }
}

function render(segs, hours) {
  const box = $('#timeline');
  let from = hours.length ? Math.min(...hours.map((x) => hhmmToMin(x.start_time))) : 9 * 60;
  let to = hours.length ? Math.max(...hours.map((x) => hhmmToMin(x.end_time))) : 19 * 60;
  for (const s of segs) { from = Math.min(from, minutesOfDay(s.seg_start)); to = Math.max(to, minutesOfDay(s.seg_end) || 1440); }
  from = Math.floor(from / 60) * 60; to = Math.ceil(to / 60) * 60;
  const ppm = () => `calc(var(--ppm) * ${to - from})`;

  const hoursCol = h('div', { class: 'tl-hours', style: `height:${ppm()}` });
  for (let m = from; m <= to; m += 60)
    hoursCol.append(h('span', { class: 'tl-hour', style: `top:calc(var(--ppm) * ${m - from})` }, minToHHMM(m)));

  const body = h('div', { class: 'tl-body', style: `height:${ppm()}` });
  for (const s of segs) {
    const a = minutesOfDay(s.seg_start), b = minutesOfDay(s.seg_end) || 1440;
    const cls = s.is_dead_time_fill ? 'fill' : s.kind;
    const title = `${fmtTime(s.seg_start)}–${fmtTime(s.seg_end)} · ${s.service_name} · ${s.step_name} · ${s.customer_first_name}`;
    body.append(h('div', { class: `seg ${cls}`, title,
      style: `top:calc(var(--ppm) * ${a - from});height:calc(var(--ppm) * ${b - a} - 2px)` },
      s.kind === 'buffer' ? null : h('b', {}, `${s.customer_first_name} · ${s.service_name}`),
      s.kind === 'buffer' ? KIND_LABEL.buffer
        : [`${s.step_name}${s.kind === 'wait' ? ` (${KIND_LABEL.wait})` : ''} `,
           h('bdi', { dir: 'ltr' }, `${fmtTime(s.seg_start)}–${fmtTime(s.seg_end)}`), s.is_dead_time_fill ? ' ⭐' : '']));
  }
  if (!segs.length) body.append(h('div', { class: 'tl-empty' }, hours.length ? 'אין תורים ביום זה' : 'הספר לא עובד ביום זה'));
  box.replaceChildren(hoursCol, body);
}
