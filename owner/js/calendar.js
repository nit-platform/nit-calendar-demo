// Daily + weekly calendar per barber, from owner_day_view (wait steps + appointments placed inside them).
import { sb, q, rpc, heError, parseRange, hhmm } from './sb.js';
import { $, h, muted, toast, providerLabel } from '../../js/ui.js';
import { fmtTime, todayISO, addDays, fmtLongDate, minutesOfDay, hhmmToMin, minToHHMM } from '../../js/time.js';

const st = { staffId: null, date: todayISO(), mode: 'day' };
const PX = 1.6; // px per minute
const STATUS = { pending: 'ממתין', confirmed: 'מאושר', cancelled: 'בוטל', completed: 'הושלם', no_show: 'לא הגיע' };
const KIND = { work: 'עבודה', wait: 'המתנה', buffer: 'מרווח' };
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();

async function dayInfo(staffId, businessId, iso) {
  const [hours, rules, offs] = await Promise.all([
    q(sb.from('working_hours').select('start_time,end_time').eq('staff_id', staffId).eq('weekday', weekday(iso)).order('start_time')),
    rpc('owner_day_rule', { p_staff_id: staffId, p_date: iso }),   // same rule the server uses for slots + booking
    q(sb.from('time_off').select('*').eq('staff_id', staffId)),
  ]);
  const r = rules[0];
  let sd = null;
  if (r?.closed) sd = { kind: 'closed', name: r.name };
  else if (r?.open_time || r?.close_time) sd = { kind: r.open_time ? 'special_hours' : 'eve', name: r.name, open_time: r.open_time, close_time: r.close_time };
  else if (r?.source === 'override') sd = { kind: 'open', name: r.name };
  const off = offs.filter((o) => o.recurring_weekday === weekday(iso) || (o.period && onDate(parseRange(o.period), iso)));
  return { hours, sd, off };
}
// does a [from, to) period touch this local date (business tz)?
function onDate(r, iso) {
  if (!r) return false; const [a, b] = r;
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' });
  return s.format(a) <= iso && (s.format(new Date(b - 1)) >= iso);
}

function groupAppts(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.appointment_id)) m.set(r.appointment_id, { id: r.appointment_id, service: r.service_name, customer: r.customer_name,
      phone: r.customer_phone, status: r.status, segs: [], fill: false });
    const a = m.get(r.appointment_id); a.segs.push(r); a.fill ||= r.is_dead_time_fill;
  }
  for (const a of m.values()) { a.start = a.segs[0].seg_start; a.end = a.segs.at(-1).seg_end; }
  return [...m.values()].sort((x, y) => new Date(x.start) - new Date(y.start));
}

function openAppt(a, ctx, rerender) {
  const f = $('#appt-form');
  const act = async (status) => {
    try {
      await q(sb.from('appointments').update(status === 'cancelled' ? { status, cancel_reason: 'בוטל ע"י העסק' } : { status }).eq('id', a.id).select('id'));
      $('#appt-dialog').close(); toast(status === 'cancelled' ? 'התור בוטל' : 'סומן כ"לא הגיע"'); rerender();
    } catch (e) { toast(heError(e), true); }
  };
  const confirmAppt = async (approve) => {
    try {
      await rpc('owner_confirm_appointment', { p_appointment_id: a.id, p_approve: approve });
      $('#appt-dialog').close(); toast(approve ? 'התור אושר' : 'הבקשה נדחתה'); rerender();
    } catch (e) { toast(heError(e), true); }
  };
  const closed = ['cancelled', 'no_show', 'completed'].includes(a.status);
  const pending = a.status === 'pending';
  f.replaceChildren(
    h('h2', {}, `${fmtTime(a.start)}–${fmtTime(a.end)} · ${a.service}`),
    h('div', { class: 'summary' },
      h('div', {}, h('strong', {}, a.customer || '—'), ' ', a.phone ? h('bdi', { dir: 'ltr' }, h('a', { href: 'tel:' + a.phone }, a.phone)) : ''),
      h('div', {}, 'סטטוס: ', STATUS[a.status] || a.status, a.fill ? h('span', { class: 'badge' }, ' משובץ בזמן המתנה ') : ''),
      pending ? h('p', { class: 'muted' }, 'ממתין לאישור — השעה שמורה עד לאישור, דחייה, או מועד התור.') : null,
      h('ul', { style: 'margin:6px 0 0;padding-inline-start:18px' }, a.segs.map((s) =>
        h('li', {}, `${fmtTime(s.seg_start)}–${fmtTime(s.seg_end)} ${s.step_name === 'buffer' ? 'מרווח' : s.step_name} (${KIND[s.kind]})`)))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', value: 'close' }, 'סגירה'),
      pending ? h('button', { type: 'button', class: 'btn primary', onclick: () => confirmAppt(true) }, 'אישור תור') : null,
      pending ? h('button', { type: 'button', class: 'btn danger', onclick: () => confirm('לדחות את הבקשה?') && confirmAppt(false) }, 'דחייה') : null,
      closed || pending ? null : h('button', { type: 'button', class: 'btn outline', id: 'appt-noshow', onclick: () => act('no_show') }, 'לא הגיע'),
      closed || pending ? null : h('button', { type: 'button', class: 'btn danger', id: 'appt-cancel', onclick: () => confirm('לבטל את התור?') && act('cancelled') }, 'ביטול תור')));
  $('#appt-dialog').showModal();
}

async function renderDay(box, ctx, rerender) {
  const [rows, info] = await Promise.all([rpc('owner_day_view', { p_staff_id: st.staffId, p_date: st.date }),
    dayInfo(st.staffId, ctx.business.id, st.date)]);
  const appts = groupAppts(rows);
  const mins = rows.flatMap((r) => [minutesOfDay(r.seg_start), minutesOfDay(r.seg_end) || 1440]);
  let open = info.hours.map((x) => hhmmToMin(x.start_time)), close = info.hours.map((x) => hhmmToMin(x.end_time));
  if (info.sd?.kind === 'special_hours' || info.sd?.kind === 'eve') { if (info.sd.open_time) open = [hhmmToMin(info.sd.open_time)]; if (info.sd.close_time) close = [hhmmToMin(info.sd.close_time)]; }
  const from = Math.floor(Math.min(...open, ...mins, 9 * 60) / 60) * 60, to = Math.ceil(Math.max(...close, ...mins, 17 * 60) / 60) * 60;
  const y = (m) => (m - from) * PX;
  const tl = h('div', { class: 'tl', id: 'timeline', style: `height:${(to - from) * PX}px` });
  // closed time = outside working hours, time off
  const shade = (a, b, title) => tl.append(h('div', { class: 'off', title, style: `top:${y(a)}px;height:${(b - a) * PX}px` }));
  const closedAll = ['holiday', 'closed'].includes(info.sd?.kind) || !info.hours.length;
  if (closedAll) shade(from, to, 'סגור');
  else {
    const iv = info.sd && open.length === 1 && info.sd.kind !== 'holiday' ? [[open[0], close[0]]] : info.hours.map((x) => [hhmmToMin(x.start_time), hhmmToMin(x.end_time)]);
    let cur = from; for (const [a, b] of iv) { if (a > cur) shade(cur, a, 'מחוץ לשעות'); cur = Math.max(cur, b); } if (cur < to) shade(cur, to, 'מחוץ לשעות');
  }
  for (const o of info.off) {
    if (o.recurring_weekday != null) shade(hhmmToMin(o.recurring_start), hhmmToMin(o.recurring_end), o.note || 'הפסקה');
    else shade(from, to, o.note || 'חופשה');
  }
  for (let m = from; m <= to; m += 60) tl.append(h('div', { class: 'hr', style: `top:${y(m)}px` }, h('span', {}, minToHHMM(m))));
  for (const a of appts) for (const s of a.segs) {
    const top = y(minutesOfDay(s.seg_start)), ht = Math.max(((new Date(s.seg_end) - new Date(s.seg_start)) / 60000) * PX - 1, 10);
    const cls = `blk ${s.kind} ${s.is_dead_time_fill ? 'fill' : ''} st-${a.status}`;
    tl.append(h('button', { type: 'button', class: cls, 'data-appt': a.id, style: `top:${top}px;height:${ht}px`, onclick: () => openAppt(a, ctx, rerender) },
      s.kind === 'buffer' ? '' : `${fmtTime(s.seg_start)} ${a.customer || ''} · ${s.kind === 'wait' ? '⏳ ' : ''}${s.step_name}`));
  }
  const note = info.sd ? h('p', { class: 'day-note' }, `${info.sd.name || ''} ${{ holiday: '(סגור)', closed: '(סגור)', eve: `(עד ${hhmm(info.sd.close_time)})`, special_hours: `(${hhmm(info.sd.open_time)}–${hhmm(info.sd.close_time)})`, open: '(פתוח כרגיל)' }[info.sd.kind]}`) : null;
  box.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'day-head' }, h('h2', {}, fmtLongDate(st.date)), h('span', { class: 'muted' }, `${appts.length} תורים`)), note,
    h('p', { class: 'legend' }, h('span', {}, h('span', { class: 'dot work' }), 'עבודה'), h('span', {}, h('span', { class: 'dot wait' }), 'המתנה (זמן מת)'),
      h('span', {}, h('span', { class: 'dot fill' }), 'תור משובץ בהמתנה'), h('span', {}, h('span', { class: 'dot buf' }), 'מרווח')),
    rows.length || !closedAll ? tl : muted('יום סגור, אין תורים.')));
}

async function renderWeek(box, ctx) {
  const start = addDays(st.date, -weekday(st.date));
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const all = await Promise.all(days.map((d) => rpc('owner_day_view', { p_staff_id: st.staffId, p_date: d })));
  box.replaceChildren(h('div', { class: 'week', id: 'week' }, days.map((d, i) => {
    const appts = groupAppts(all[i]);
    return h('div', { class: 'wday' },
      h('h3', {}, fmtLongDate(d),
        h('button', { onclick: () => { st.date = d; st.mode = 'day'; renderCalendar($('#view-calendar'), ctx); } }, 'יום מלא')),
      appts.length ? appts.map((a) => h('div', { class: 'appt-line', onclick: () => openAppt(a, ctx, () => renderCalendar($('#view-calendar'), ctx)) },
        h('time', {}, `${fmtTime(a.start)}–${fmtTime(a.end)}`), h('span', {}, a.customer || '—', ' ', h('small', {}, a.service)),
        a.fill ? h('span', { class: 'tag fill' }, 'בהמתנה') : null,
        a.segs.some((s) => s.kind === 'wait') ? h('small', {}, '⏳ ' + a.segs.filter((s) => s.kind === 'wait').map((s) => `${fmtTime(s.seg_start)}–${fmtTime(s.seg_end)}`).join(', ')) : null,
        a.status !== 'confirmed' ? h('span', { class: `tag ${a.status}` }, STATUS[a.status]) : null)) : muted('אין תורים'));
  })));
}

export async function renderCalendar(root, ctx) {
  const staff = ctx.staff.filter((s) => s.is_active);
  if (!staff.length) { root.replaceChildren(h('div', { class: 'card' }, muted(`אין אף ${providerLabel(ctx.business)} פעיל.`))); return; }
  if (!staff.some((s) => s.id === st.staffId)) st.staffId = staff[0].id;
  const body = h('div', {});
  const rerender = () => renderCalendar(root, ctx);
  const step = st.mode === 'week' ? 7 : 1;
  root.replaceChildren(
    h('div', { class: 'card toolbar' },
      h('select', { id: 'cal-staff', 'aria-label': providerLabel(ctx.business), onchange: (e) => { st.staffId = e.target.value; rerender(); } },
        staff.map((s) => h('option', { value: s.id, selected: s.id === st.staffId }, s.display_name))),
      h('div', { class: 'seg' }, ['day', 'week'].map((m) => h('button', { 'aria-pressed': String(st.mode === m), id: 'mode-' + m,
        onclick: () => { st.mode = m; rerender(); } }, m === 'day' ? 'יום' : 'שבוע'))),
      h('div', { class: 'date-row', style: 'flex:1 1 100%' },
        h('button', { class: 'icon-btn', 'aria-label': 'קודם', onclick: () => { st.date = addDays(st.date, -step); rerender(); } }, '›'),
        h('input', { type: 'date', id: 'cal-date', value: st.date, onchange: (e) => { if (e.target.value) { st.date = e.target.value; rerender(); } } }),
        h('button', { class: 'icon-btn', 'aria-label': 'הבא', onclick: () => { st.date = addDays(st.date, step); rerender(); } }, '‹'),
        h('button', { class: 'btn small outline', onclick: () => { st.date = todayISO(); rerender(); } }, 'היום'))),
    body);
  body.append(muted('טוען…'));
  try { await (st.mode === 'week' ? renderWeek(body, ctx) : renderDay(body, ctx, rerender)); }
  catch (e) { body.replaceChildren(h('div', { class: 'card' }, heError(e))); }
}
