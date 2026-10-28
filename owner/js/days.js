// Special days: manual closed days / special hours + calendar holidays (B8 moved from Settings).
import { sb, q, heError, hhmm } from './sb.js';
import { h, muted, toast, providerLabel } from '../../js/ui.js';
import { todayISO, fmtLongDate } from '../../js/time.js';
import { renderHolidays } from './holidays.js';

const KIND = { holiday: 'חג (סגור)', eve: 'ערב חג (קיצור שעות)', closed: 'סגור', special_hours: 'שעות מיוחדות' };
let showPast = false;

export async function renderDays(root, ctx) {
  const rerender = () => renderDays(root, ctx);
  let qy = sb.from('special_days').select('*').eq('business_id', ctx.business.id).order('date');
  if (!showPast) qy = qy.gte('date', todayISO());
  const days = await q(qy);
  const staffName = (id) => ctx.staff.find((s) => s.id === id)?.display_name;
  const act = async (fn, ok) => { try { await fn(); toast(ok); rerender(); } catch (e) { toast(heError(e), true); } };
  const desc = (d) => `${KIND[d.kind]}${d.kind === 'eve' || d.kind === 'special_hours' ? ` ${hhmm(d.open_time) || ''}${d.open_time ? '–' : 'עד '}${hhmm(d.close_time) || ''}` : ''}`;

  const item = (d) => h('div', { class: `item${d.overridden ? ' overridden' : ''}`, 'data-day-id': d.id },
    h('span', {}, h('strong', {}, fmtLongDate(d.date)), ' · ', d.name || '', ' ', h('small', { class: 'muted' }, desc(d)),
      d.staff_id ? h('small', {}, ` · ${staffName(d.staff_id) || ''}`) : null),
    h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'מחיקה', onclick: () => act(() => q(sb.from('special_days').delete().eq('id', d.id).select('id')), 'נמחק') }, 'מחיקה'));

  const form = h('form', { class: 'row', id: 'day-form' },
    h('label', {}, 'תאריך', h('input', { type: 'date', name: 'date', required: true, min: todayISO() })),
    h('label', {}, 'סוג', h('select', { name: 'kind' }, ['closed', 'special_hours', 'eve', 'holiday'].map((k) => h('option', { value: k }, KIND[k])))),
    h('label', {}, 'פתיחה', h('input', { type: 'time', name: 'open', step: 300 })),
    h('label', {}, 'סגירה', h('input', { type: 'time', name: 'close', step: 300 })),
    h('label', {}, 'שם', h('input', { name: 'name', placeholder: 'למשל: אירוע משפחתי' })),
    h('label', {}, 'למי', h('select', { name: 'staff' }, h('option', { value: '' }, 'כל העסק'), ctx.staff.map((s) => h('option', { value: s.id }, s.display_name)))),
    h('button', { class: 'btn small primary' }, '+ הוספה'));
  form.addEventListener('submit', (e) => { e.preventDefault(); const f = form;
    const timed = f.kind.value === 'special_hours' || f.kind.value === 'eve';
    if (f.kind.value === 'special_hours' && (!f.open.value || !f.close.value)) return toast('לשעות מיוחדות צריך שעת פתיחה וסגירה', true);
    act(() => q(sb.from('special_days').insert({ business_id: ctx.business.id, staff_id: f.staff.value || null, date: f.date.value, kind: f.kind.value,
      name: f.name.value || null, source: 'manual', open_time: timed ? f.open.value || null : null,
      close_time: timed ? f.close.value || (f.kind.value === 'eve' ? ctx.policies.eve_close_time : null) : null }).select('id')), 'היום נוסף');
  });

  const manual = days;
  root.replaceChildren(
    renderHolidays(ctx),
    h('div', { class: 'card' }, h('h2', {}, 'הוספת יום מיוחד'), form,
      h('p', { class: 'muted' }, `יום ידני גובר על חג מהלוח. יום של ${providerLabel(ctx.business)} מסוים גובר על יום של כל העסק.`)),
    h('div', { class: 'card', id: 'manual-days' }, h('h2', {}, 'ימים ידניים'), h('div', { class: 'list' }, manual.length ? manual.map(item) : muted('אין'))),
    h('p', { class: 'muted', id: 'calendar-days' }, 'ברירות מחדל לחגים (סגירה / ערב חג): בלשונית ההגדרות.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showPast, onchange: (e) => { showPast = e.target.checked; rerender(); } }), 'הצגת ימים שעברו'));
}
