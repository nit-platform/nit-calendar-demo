// Working hours per barber + time off (recurring breaks and one-off absences).
import { sb, q, heError, hhmm, WEEKDAYS, parseRange, localToTs, tsToLocal } from './sb.js';
import { h, muted, toast } from '../../js/ui.js';

let staffId = null;
const KINDS = { break: 'הפסקה', vacation: 'חופשה', sick: 'מחלה', other: 'אחר' };
const time = (name, value) => h('input', { type: 'time', name, value: hhmm(value), required: true, step: 300 });

async function guarded(fn, ok, rerender) {
  try { await fn(); toast(ok); rerender(); } catch (e) { toast(heError(e), true); }
}

export async function renderHours(root, ctx) {
  if (!ctx.staff.length) { root.replaceChildren(h('div', { class: 'card' }, muted('אין נותני שירות.'))); return; }
  if (!ctx.staff.some((s) => s.id === staffId)) staffId = ctx.staff[0].id;
  const [wh, offs] = await Promise.all([
    q(sb.from('working_hours').select('*').eq('staff_id', staffId).order('weekday').order('start_time')),
    q(sb.from('time_off').select('*').eq('staff_id', staffId))]);
  const rerender = () => renderHours(root, ctx);

  const hoursCard = h('div', { class: 'card', id: 'hours-card' }, h('h2', {}, 'שעות עבודה'),
    WEEKDAYS.map((dn, wd) => {
      const rows = wh.filter((x) => x.weekday === wd);
      return h('div', { class: 'item', 'data-weekday': wd }, h('strong', { style: 'min-width:56px' }, dn),
        h('div', { class: 'list', style: 'flex:1' },
          rows.length ? rows.map((r) => {
            const f = h('form', { class: 'row', 'data-wh-id': r.id }, time('start_time', r.start_time), '–', time('end_time', r.end_time),
              h('button', { class: 'btn small primary' }, 'שמירה'),
              h('button', { type: 'button', class: 'btn small ghost', onclick: () => guarded(() => q(sb.from('working_hours').delete().eq('id', r.id).select('id')), 'נמחק', rerender) }, '🗑'));
            f.addEventListener('submit', (e) => { e.preventDefault();
              guarded(() => q(sb.from('working_hours').update({ start_time: f.start_time.value, end_time: f.end_time.value }).eq('id', r.id).select('id')), 'נשמר', rerender); });
            return f;
          }) : muted('סגור'),
          h('button', { type: 'button', class: 'btn small outline', style: 'justify-self:start', onclick: () =>
            guarded(() => q(sb.from('working_hours').insert({ staff_id: staffId, weekday: wd, start_time: rows.at(-1)?.end_time || '09:00',
              end_time: rows.length ? '23:59' : '17:00' }).select('id')), 'נוסף טווח', rerender) }, '+ טווח')));
    }));

  const recurring = offs.filter((o) => o.recurring_weekday != null).sort((a, b) => a.recurring_weekday - b.recurring_weekday || a.recurring_start.localeCompare(b.recurring_start));
  const periods = offs.filter((o) => o.period).map((o) => ({ ...o, r: parseRange(o.period) })).sort((a, b) => a.r[0] - b.r[0]);
  const del = (o) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => guarded(() => q(sb.from('time_off').delete().eq('id', o.id).select('id')), 'נמחק', rerender) }, '🗑');
  const fmt = (d) => tsToLocal(d).replace('T', ' ');

  const breakForm = h('form', { class: 'row', id: 'break-form' },
    h('label', {}, 'יום', h('select', { name: 'wd' }, WEEKDAYS.map((d, i) => h('option', { value: i }, d)))),
    h('label', {}, 'מ-', time('s', '13:00')), h('label', {}, 'עד', time('e', '13:30')),
    h('label', {}, 'הערה', h('input', { name: 'note', placeholder: 'צהריים' })), h('button', { class: 'btn small primary' }, '+ הפסקה קבועה'));
  breakForm.addEventListener('submit', (e) => { e.preventDefault(); const f = breakForm;
    guarded(() => q(sb.from('time_off').insert({ staff_id: staffId, kind: 'break', recurring_weekday: Number(f.wd.value),
      recurring_start: f.s.value, recurring_end: f.e.value, note: f.note.value || null }).select('id')), 'ההפסקה נוספה', rerender); });

  const periodForm = h('form', { class: 'row', id: 'period-form' },
    h('label', {}, 'סוג', h('select', { name: 'kind' }, ['vacation', 'sick', 'break', 'other'].map((k) => h('option', { value: k }, KINDS[k])))),
    h('label', {}, 'מתאריך ושעה', h('input', { type: 'datetime-local', name: 'from', required: true })),
    h('label', {}, 'עד', h('input', { type: 'datetime-local', name: 'to', required: true })),
    h('label', {}, 'הערה', h('input', { name: 'note' })), h('button', { class: 'btn small primary' }, '+ היעדרות'));
  periodForm.addEventListener('submit', (e) => { e.preventDefault(); const f = periodForm;
    if (f.to.value <= f.from.value) return toast('שעת הסיום חייבת להיות אחרי ההתחלה', true);
    guarded(() => q(sb.from('time_off').insert({ staff_id: staffId, kind: f.kind.value, note: f.note.value || null,
      period: `[${localToTs(f.from.value)},${localToTs(f.to.value)})` }).select('id')), 'ההיעדרות נוספה', rerender); });

  root.replaceChildren(
    h('div', { class: 'card toolbar' }, h('label', { style: 'flex:1' }, 'נותן שירות', h('select', { id: 'hours-staff', onchange: (e) => { staffId = e.target.value; rerender(); } },
      ctx.staff.map((s) => h('option', { value: s.id, selected: s.id === staffId }, s.display_name))))),
    hoursCard,
    h('div', { class: 'card', id: 'breaks-card' }, h('h2', {}, 'הפסקות קבועות (כל שבוע)'),
      h('div', { class: 'list' }, recurring.length ? recurring.map((o) => h('div', { class: 'item' },
        h('span', {}, `${WEEKDAYS[o.recurring_weekday]} ${hhmm(o.recurring_start)}–${hhmm(o.recurring_end)} `, h('small', { class: 'muted' }, o.note || KINDS[o.kind])), del(o))) : muted('אין')),
      h('h3', { class: 'sub' }, 'הוספה'), breakForm),
    h('div', { class: 'card', id: 'periods-card' }, h('h2', {}, 'חופשות והיעדרויות'),
      h('div', { class: 'list' }, periods.length ? periods.map((o) => h('div', { class: 'item' },
        h('span', {}, h('bdi', {}, `${fmt(o.r[0])} → ${fmt(o.r[1])}`), ' ', h('small', { class: 'muted' }, `${KINDS[o.kind]}${o.note ? ' · ' + o.note : ''}`)), del(o))) : muted('אין')),
      h('h3', { class: 'sub' }, 'הוספה'), periodForm));
}
