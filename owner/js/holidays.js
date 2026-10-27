// Upcoming holidays + eves (global calendar) with this business's rule and a per-date owner override.
// Server enforces everything (slot grid + booking); writes are owner-only via RLS on holiday_overrides.
import { sb, q, rpc, heError, hhmm } from './sb.js';
import { h, muted, toast } from '../../js/ui.js';
import { fmtLongDate } from '../../js/time.js';

const MODES = [['', 'ברירת מחדל'], ['closed', 'סגור'], ['open', 'פתוח כרגיל'], ['hours', 'שעות מיוחדות']];
const KIND = { holiday: 'חג', eve: 'ערב חג' };

function ruleText(r) {
  if (r.rule_source === 'manual') return 'יום ידני (בלשונית ימים מיוחדים) גובר';
  if (r.closed) return 'סגור';
  if (r.open_time || r.close_time) return `${hhmm(r.open_time) ? hhmm(r.open_time) + '–' : 'עד '}${hhmm(r.close_time)}`;
  return 'פתוח כרגיל';
}

export function renderHolidays(ctx) {
  const card = h('div', { class: 'card', id: 'holidays' }, h('h2', {}, 'חגים וערבי חג'), muted('טוען…'));
  const isOwner = !ctx.role || ctx.role === 'owner';
  const load = async () => {
    let rows;
    try { rows = await rpc('owner_holidays', { p_business_id: ctx.business.id }); }
    catch (e) { card.replaceChildren(h('h2', {}, 'חגים וערבי חג'), muted(heError(e))); return; }
    const p = ctx.policies;
    const item = (r) => {
      const mode = h('select', { class: 'hol-mode', disabled: !isOwner }, MODES.map(([v, t]) => h('option', { value: v, selected: (r.override_mode || '') === v }, t)));
      const open = h('input', { type: 'time', class: 'hol-open', step: 300, value: hhmm(r.override_open) || '' });
      const close = h('input', { type: 'time', class: 'hol-close', step: 300, value: hhmm(r.override_close) || '' });
      const times = h('span', { class: 'hol-times', hidden: mode.value !== 'hours' }, 'מ-', open, ' עד ', close);
      for (const el of [open, close]) el.disabled = !isOwner;
      const save = h('button', { type: 'button', class: 'btn small primary hol-save', disabled: !isOwner }, 'שמירה');
      mode.addEventListener('change', () => { times.hidden = mode.value !== 'hours'; });
      save.addEventListener('click', async () => {
        const m = mode.value;
        try {
          if (!m) await q(sb.from('holiday_overrides').delete().eq('business_id', ctx.business.id).eq('date', r.date).select('date'));
          else {
            if (m === 'hours' && !(open.value && close.value && open.value < close.value)) return toast('שעות מיוחדות: צריך פתיחה לפני סגירה', true);
            const rowsUp = await q(sb.from('holiday_overrides').upsert({ business_id: ctx.business.id, date: r.date, mode: m,
              open_time: m === 'hours' ? open.value : null, close_time: m === 'hours' ? close.value : null }).select('date'));
            if (!rowsUp.length) throw new Error('permission denied');
          }
          toast('נשמר'); load();
        } catch (e) { toast(heError(e), true); }
      });
      return h('div', { class: 'item', 'data-holiday': r.date },
        h('span', {}, h('strong', {}, fmtLongDate(r.date)), ' · ', r.name_he || r.name, ' ', h('small', { class: 'muted' }, `(${KIND[r.kind]})`),
          h('br'), h('small', { class: 'hol-rule' }, 'כרגע: ', ruleText(r))),
        h('span', { class: 'row' }, mode, times, save));
    };
    card.replaceChildren(h('h2', {}, 'חגים וערבי חג'),
      h('p', { class: 'muted' }, `ברירת מחדל: ${p.auto_holidays === false ? 'חגים לא נסגרים' : 'סגור בחגים'}; ${p.auto_holidays === false || p.eve_shorten === false ? 'ערבי חג כרגיל' : `ערב חג עד ${hhmm(p.eve_close_time) || '14:00'}`}. אפשר לשנות כל תאריך בנפרד.`),
      isOwner ? null : muted('רק בעל/ת העסק יכול/ה לשנות.'),
      h('div', { class: 'list' }, rows.length ? rows.map(item) : muted('אין חגים בטווח (הלוח מתעדכן אוטומטית מ-Hebcal).')));
  };
  load();
  return card;
}
