// Daily + weekly calendar per staff member, from owner_day_view (wait steps + appointments placed inside them).
import { sb, q, rpc, heError, parseRange, hhmm } from './sb.js';
import { $, h, muted, toast, providerLabel } from '../../js/ui.js';
import { askDangerConfirm } from './confirm.js';
import { fmtTime, todayISO, addDays, fmtLongDate, minutesOfDay, hhmmToMin, minToHHMM } from '../../js/time.js';
import { getSetupSteps, isSetupDismissed, dismissSetup, openTab } from './app.js';
import { bookingUrl } from './bookinglink.js';

const st = { staffId: null, date: todayISO(), mode: 'day' };
const PX = 1.6; // px per minute
const STATUS = { pending: 'ממתין', confirmed: 'מאושר', cancelled: 'בוטל', completed: 'הושלם', no_show: 'לא הגיע' };
const KIND = { work: 'עבודה', wait: 'המתנה', buffer: 'מרווח' };


function emptyCalDismissKey(bizId) { return bizId ? `nit-empty-cal-dismiss:${bizId}` : ''; }

async function copyBookingLink(ctx) {
  const slug = ctx.business?.public_slug;
  if (!slug) { openTab('settings'); toast('בחרו מזהה קישור בהגדרות'); return; }
  const url = bookingUrl(slug);
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק — שלחו ללקוח'); }
  catch { toast('לא ניתן להעתיק', true); }
}

/** B5: first-run checklist card (calendar tab). */
function setupChecklistCard(ctx) {
  if (isSetupDismissed()) return null;
  const steps = getSetupSteps();
  if (!steps.length || steps.every((s) => s.ok)) return null;
  const next = steps.find((s) => !s.ok);
  const rows = steps.map((s) => h('li', { class: s.ok ? 'setup-check-ok' : 'setup-check-todo' },
    s.ok ? `✓ ${s.label}` : `○ ${s.label}`,
    (!s.ok && s.tab === next?.tab)
      ? h('button', {
          type: 'button', class: 'btn small primary setup-check-cta',
          onclick: () => (s.tab === 'settings' && ctx.business.public_slug
            ? copyBookingLink(ctx)
            : openTab(s.tab)),
        }, s.cta || 'המשך')
      : null));
  return h('div', { class: 'card setup-check-card', id: 'setup-checklist' },
    h('h2', {}, 'ברוכים הבאים 👋'),
    h('p', { class: 'muted' }, 'עוד צעד אחד והלקוחות מתחילים'),
    h('ul', { class: 'setup-check-list' }, ...rows),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => {
        dismissSetup();
        const el = document.getElementById('setup-checklist');
        el?.remove();
      } }, 'סגירה')));
}

/** B6: empty-day share CTA until first appointment / dismiss. */
function emptyDayShareCard(ctx, hasAnyApptToday) {
  if (hasAnyApptToday) return null;
  const key = emptyCalDismissKey(ctx.business?.id);
  if (key && localStorage.getItem(key)) return null;
  const slug = ctx.business?.public_slug;
  return h('div', { class: 'card empty-cal-cta', id: 'empty-cal-cta' },
    h('p', {}, 'עדיין אין תורים להיום.'),
    h('p', { class: 'muted' }, slug
      ? 'שלחו את הקישור ללקוח ראשון.'
      : 'השלימו שיתוף קישור בהגדרות, ואז שלחו ללקוח.'),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', class: 'btn primary', id: 'empty-cal-copy',
        onclick: () => copyBookingLink(ctx),
      }, slug ? 'העתקת קישור הזמנה' : 'מעבר להגדרות קישור'),
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => {
          if (key) localStorage.setItem(key, '1');
          document.getElementById('empty-cal-cta')?.remove();
        },
      }, 'סגירה')));
}


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
      pending ? h('button', { type: 'button', class: 'btn danger', id: 'appt-reject', onclick: async () => {
        if (await askDangerConfirm({ title: 'דחיית בקשה?', body: 'לדחות את הבקשה? השעה תתפנה.', yesLabel: 'כן, דחו' })) await confirmAppt(false);
      } }, 'דחייה') : null,
      closed || pending ? null : h('button', { type: 'button', class: 'btn outline', id: 'appt-noshow', onclick: () => act('no_show') }, 'לא הגיע'),
      closed || pending ? null : h('button', { type: 'button', class: 'btn danger', id: 'appt-cancel', onclick: async () => {
        if (await askDangerConfirm({ title: 'ביטול התור?', body: 'לבטל את התור?', yesLabel: 'כן, בטל' })) await act('cancelled');
      } }, 'ביטול תור')));
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
    const top = y(minutesOfDay(s.seg_start));
    const ht = Math.max(((new Date(s.seg_end) - new Date(s.seg_start)) / 60000) * PX - 1, 28);
    const short = ht < 44 ? ' short' : '';
    const cls = `blk ${s.kind}${short} ${s.is_dead_time_fill ? 'fill' : ''} st-${a.status}`;
    tl.append(h('button', { type: 'button', class: cls, 'data-appt': a.id, style: `top:${top}px;height:${ht}px`, onclick: () => openAppt(a, ctx, rerender) },
      s.kind === 'buffer' ? '' : `${fmtTime(s.seg_start)} ${a.customer || ''} · ${s.kind === 'wait' ? '⏳ ' : ''}${s.step_name}`));
  }
  const note = info.sd ? h('p', { class: 'day-note' }, `${info.sd.name || ''} ${{ holiday: '(סגור)', closed: '(סגור)', eve: `(עד ${hhmm(info.sd.close_time)})`, special_hours: `(${hhmm(info.sd.open_time)}–${hhmm(info.sd.close_time)})`, open: '(פתוח כרגיל)' }[info.sd.kind]}`) : null;
  const dayCard = h('div', { class: 'card' },
    h('div', { class: 'day-head' }, h('h2', {}, fmtLongDate(st.date)), h('span', { class: 'muted' }, `${appts.length} תורים`)), note,
    h('p', { class: 'legend' }, h('span', {}, h('span', { class: 'dot work' }), 'עבודה'), h('span', {}, h('span', { class: 'dot wait' }), 'המתנה (זמן מת)'),
      h('span', {}, h('span', { class: 'dot fill' }), 'תור משובץ בהמתנה'), h('span', {}, h('span', { class: 'dot buf' }), 'מרווח')),
    rows.length || !closedAll ? tl : muted('יום סגור, אין תורים.'));
  const kids = [];
  const emptyCta = emptyDayShareCard(ctx, appts.length > 0);
  if (emptyCta) kids.push(emptyCta);
  kids.push(dayCard);
  box.replaceChildren(...kids);
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
      appts.length ? appts.map((a) => {
        const open = () => openAppt(a, ctx, () => renderCalendar($('#view-calendar'), ctx));
        return h('button', { type: 'button', class: 'appt-line', onclick: open,
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
          h('time', {}, `${fmtTime(a.start)}–${fmtTime(a.end)}`), h('span', {}, a.customer || '—', ' ', h('small', {}, a.service)),
          a.fill ? h('span', { class: 'tag fill' }, 'בהמתנה') : null,
          a.segs.some((s) => s.kind === 'wait') ? h('small', {}, '⏳ ' + a.segs.filter((s) => s.kind === 'wait').map((s) => `${fmtTime(s.seg_start)}–${fmtTime(s.seg_end)}`).join(', ')) : null,
          a.status !== 'confirmed' ? h('span', { class: `tag ${a.status}` }, STATUS[a.status]) : null);
      }) : muted('אין תורים'));
  })));
}

export async function renderCalendar(root, ctx) {
  const staff = ctx.staff.filter((s) => s.is_active);
  if (!staff.length) { root.replaceChildren(h('div', { class: 'card' }, muted(`אין אף ${providerLabel(ctx.business)} פעיל.`))); return; }
  if (!staff.some((s) => s.id === st.staffId)) st.staffId = staff[0].id;
  const body = h('div', {});
  const rerender = () => renderCalendar(root, ctx);
  const step = st.mode === 'week' ? 7 : 1;
  const checklist = setupChecklistCard(ctx);
  const toolbar = h('div', { class: 'card toolbar' },
      h('select', { id: 'cal-staff', 'aria-label': providerLabel(ctx.business), onchange: (e) => { st.staffId = e.target.value; rerender(); } },
        staff.map((s) => h('option', { value: s.id, selected: s.id === st.staffId }, s.display_name))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'תצוגה' }, ['day', 'week'].map((m) => h('button', { type: 'button', 'aria-pressed': String(st.mode === m), id: 'mode-' + m,
        onclick: () => { st.mode = m; rerender(); } }, m === 'day' ? 'יום' : 'שבוע'))),
      h('div', { class: 'date-row', style: 'flex:1 1 100%' },
        h('button', { class: 'icon-btn', id: 'cal-prev', type: 'button', 'aria-label': st.mode === 'week' ? 'שבוע קודם' : 'יום קודם', onclick: () => { st.date = addDays(st.date, -step); rerender(); } }, '◀'),
        h('input', { type: 'date', id: 'cal-date', value: st.date, 'aria-label': 'תאריך', onchange: (e) => { if (e.target.value) { st.date = e.target.value; rerender(); } } }),
        h('button', { class: 'icon-btn', id: 'cal-next', type: 'button', 'aria-label': st.mode === 'week' ? 'שבוע הבא' : 'יום הבא', onclick: () => { st.date = addDays(st.date, step); rerender(); } }, '▶'),
        h('button', { class: 'btn small outline', type: 'button', onclick: () => { st.date = todayISO(); rerender(); } }, 'היום')));
  root.replaceChildren(...(checklist ? [checklist, toolbar, body] : [toolbar, body]));
  body.append(muted('טוען…'));
  try { await (st.mode === 'week' ? renderWeek(body, ctx) : renderDay(body, ctx, rerender)); }
  catch (e) { body.replaceChildren(h('div', { class: 'card' }, heError(e))); }
}
