// Business details + per-business policies (all values live in the businesses / policies tables).
import { sb, q, heError, hhmm } from './sb.js';
import { h, toast, DEFAULT_PROVIDER_LABEL, providerLabel } from '../../js/ui.js';
import { reloadContext } from './app.js';
import { renderBookingLink } from './bookinglink.js';

// [column, label, type, extra]
const POLICY_FIELDS = [
  ['wait_duration_mode', 'תכנון זמני המתנה עם טווח', 'select', { options: [['max', 'לפי המקסימום (בטוח)'], ['min', 'לפי המינימום (צפוף)']] }],
  ['slot_step_min', 'קפיצות בין שעות (דקות)', 'number', { min: 1 }],
  ['min_notice_min', 'הזמנה לפחות X דקות מראש', 'number', { min: 0 }],
  ['max_days_ahead', 'אפשר להזמין עד X ימים קדימה', 'number', { min: 1 }],
  ['cancel_min_hours', 'ביטול עד X שעות לפני', 'number', { min: 0 }],
  ['hold_minutes', 'שמירת שעה בזמן הזמנה (דקות)', 'number', { min: 1 }],
  ['no_show_limit', 'חסימה אחרי X אי-הגעות', 'number', { min: 0 }],
  ['auto_holidays', 'סנכרון חגים אוטומטי (Hebcal)', 'checkbox'],
  ['eve_close_time', 'שעת סגירה בערב חג', 'time'],
  ['demo_max_bookings_per_phone_day', 'הדגמה: מקס׳ תורים לטלפון ביום', 'number', { min: 0 }],
  ['demo_max_bookings_per_hour', 'הדגמה: מקס׳ תורים בשעה (כל העסק)', 'number', { min: 0 }],
  ['reminder_24h', 'תזכורת 24 שעות לפני', 'checkbox'],
  ['reminder_2h', 'תזכורת שעתיים לפני', 'checkbox'],
];

function input([col, label, type, extra = {}], val) {
  if (type === 'checkbox') return h('label', { class: 'check' }, h('input', { type, name: col, checked: !!val }), label);
  if (type === 'select') return h('label', {}, label, h('select', { name: col }, extra.options.map(([v, t]) => h('option', { value: v, selected: val === v }, t))));
  return h('label', {}, label, h('input', { type, name: col, value: type === 'time' ? hhmm(val) : val ?? '', required: true, min: extra.min, step: type === 'time' ? 300 : undefined }));
}

export async function renderSettings(root, ctx) {
  const p = ctx.policies, b = ctx.business;
  const fields = POLICY_FIELDS.filter(([c]) => c in p);   // only columns that exist in this database
  const bizForm = h('form', { class: 'card', id: 'biz-form' }, h('h2', {}, 'פרטי העסק'),
    h('div', { class: 'row' }, h('label', {}, 'שם העסק', h('input', { name: 'name', value: b.name, required: true })),
      h('label', {}, 'וואטסאפ', h('input', { name: 'phone_whatsapp', value: b.phone_whatsapp || '', dir: 'ltr', inputmode: 'tel' })),
      h('label', {}, 'כינוי לנותן שירות (למשל ספר, מטפלת)', h('input', { name: 'provider_label', id: 'provider-label', value: b.provider_label || '',
        maxlength: 30, placeholder: DEFAULT_PROVIDER_LABEL, pattern: '[^<>]*', title: 'עד 30 תווים, ללא < או >' }))),
    // owner-only (DB guard). Off: the booking page shows no names and a free provider is assigned automatically.
    'customers_choose_provider' in b
      ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'customers_choose_provider', id: 'choose-provider',
            checked: b.customers_choose_provider !== false }),
          `לקוחות בוחרים ${providerLabel(b)} (כשכבוי: שיבוץ אוטומטי של הפנוי הראשון, בלי שמות בדף ההזמנה)`)
      : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, 'שמירה')));
  bizForm.addEventListener('submit', async (e) => { e.preventDefault();
    const label = bizForm.provider_label.value.trim();
    if (label.length > 30 || /[<>]/.test(label)) { toast('כינוי לנותן שירות: עד 30 תווים, ללא < או >', true); return; }
    const patch = { name: bizForm.name.value.trim(), phone_whatsapp: bizForm.phone_whatsapp.value.trim() || null };
    if ((label || null) !== (b.provider_label ?? null)) patch.provider_label = label || null;   // only owners may change it (DB-enforced)
    const choose = bizForm.elements.customers_choose_provider;
    if (choose && choose.checked !== (b.customers_choose_provider !== false)) patch.customers_choose_provider = choose.checked;   // owner only (DB)
    try { const [row] = await q(sb.from('businesses').update(patch).eq('id', b.id).select('*'));
      if (!row) throw new Error('permission denied'); Object.assign(ctx.business, row); document.querySelector('#biz-name').textContent = row.name; bizForm.provider_label.value = row.provider_label || ''; toast('נשמר'); }
    catch (err) { toast(heError(err), true); if (choose) choose.checked = b.customers_choose_provider !== false; } });

  const polForm = h('form', { class: 'card', id: 'policy-form' }, h('h2', {}, 'כללי הזמנה ויומן'),
    h('div', { class: 'list' }, fields.map((f) => input(f, p[f[0]]))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, 'שמירה')));
  polForm.addEventListener('submit', async (e) => { e.preventDefault();
    const patch = {};
    for (const [c, , t] of fields) { const el = polForm.elements[c]; patch[c] = t === 'checkbox' ? el.checked : t === 'number' ? Number(el.value) : el.value; }
    try { await q(sb.from('policies').update(patch).eq('business_id', b.id).select('business_id')); await reloadContext(); toast('ההגדרות נשמרו'); }
    catch (err) { toast(heError(err), true); } });
  root.replaceChildren(...(b.public_slug ? [renderBookingLink(ctx)] : []), bizForm, polForm);
}
