// Business details + per-business policies (all values live in the businesses / policies tables).
// K4: policy fields split into <details> sections; demo_* only when businesses.is_demo (server-enforced too).
import { sb, q, heError, hhmm } from './sb.js';
import { h, toast, DEFAULT_PROVIDER_LABEL, providerLabel } from '../../js/ui.js';
import { reloadContext } from './app.js';
import { renderBookingLink } from './bookinglink.js';
import { renderHolidays } from './holidays.js';

// [column, label, type, extra]
const BOOKING_FIELDS = [
  ['wait_duration_mode', 'תכנון זמני המתנה עם טווח', 'select', { options: [['max', 'לפי המקסימום (בטוח)'], ['min', 'לפי המינימום (צפוף)']] }],
  ['slot_step_min', 'קפיצות בין שעות (דקות)', 'number', { min: 1 }],
  ['min_notice_min', 'הזמנה לפחות X דקות מראש', 'number', { min: 0 }],
  ['max_days_ahead', 'אפשר להזמין עד X ימים קדימה', 'number', { min: 1 }],
  ['cancel_min_hours', 'ביטול עד X שעות לפני', 'number', { min: 0 }],
  ['hold_minutes', 'שמירת שעה בזמן הזמנה (דקות)', 'number', { min: 1 }],
  ['no_show_limit', 'חסימה אחרי X אי-הגעות', 'number', { min: 0 }],
  ['require_owner_confirm_unverified', 'אישור ידני לתורים ממספר שלא אומת', 'checkbox'],
];
const REMINDER_FIELDS = [
  ['reminder_confirm', 'הודעת אישור מיד אחרי קביעת תור', 'checkbox'],
  ['reminder_first_min', 'תזכורת ראשונה: X דקות לפני (0 = כבוי)', 'number', { min: 0, max: 10080 }],
  ['reminder_second_min', 'תזכורת שנייה: X דקות לפני (0 = כבוי)', 'number', { min: 0, max: 10080 }],
  ['quiet_start', 'שעות שקט: מ-', 'time'],
  ['quiet_end', 'שעות שקט: עד', 'time'],
  ['quiet_shabbat', 'לא לשלוח בשבת (מיום ו׳ 16:00)', 'checkbox'],
  ['quiet_holidays', 'לא לשלוח בחגים', 'checkbox'],
];
const WAITLIST_FIELDS = [
  ['waitlist_enabled', 'רשימת המתנה פעילה', 'checkbox'],
  ['waitlist_mode', 'הצעת תור שהתפנה', 'select', { options: [['fifo', 'לפי סדר ההרשמה (אחד בכל פעם)'], ['broadcast', 'לכולם, הראשון שמאשר']] }],
  ['waitlist_timeout_min', 'זמן לאישור הצעה (דקות)', 'number', { min: 5, max: 1440 }],
  ['last_minute_rule', 'תור של הרגע האחרון', 'select', { options: [['broadcast', 'לכולם, הראשון שמאשר'], ['fifo', 'לפי הסדר']] }],
];
const HOLIDAY_DEFAULT_FIELDS = [
  ['auto_holidays', 'חגים לפי לוח השנה: סגור בחג (ברירת מחדל)', 'checkbox'],
  ['eve_shorten', 'ערב חג: יום מקוצר (ברירת מחדל)', 'checkbox'],
  ['eve_close_time', 'ערב חג: סגירה בשעה', 'time'],
];
const DEMO_FIELDS = [
  ['demo_max_bookings_per_phone_day', 'הדגמה: מקס׳ תורים לטלפון ביום', 'number', { min: 0 }],
  ['demo_max_bookings_per_hour', 'הדגמה: מקס׳ תורים בשעה (כל העסק)', 'number', { min: 0 }],
];
const NON_OWNER_NOTE = 'רק בעל/ת העסק יכול/ה לשנות את ההגדרות.';

function input([col, label, type, extra = {}], val) {
  if (type === 'checkbox') return h('label', { class: 'check' }, h('input', { type, name: col, checked: !!val }), label);
  if (type === 'select') return h('label', {}, label, h('select', { name: col }, extra.options.map(([v, t]) => h('option', { value: v, selected: val === v }, t))));
  return h('label', {}, label, h('input', { type, name: col, value: type === 'time' ? hhmm(val) : val ?? '', required: true, min: extra.min, max: extra.max, step: type === 'time' ? 300 : undefined }));
}

function section(id, title, fieldDefs, policies, { open = true } = {}) {
  const fields = fieldDefs.filter(([c]) => c in policies);
  if (!fields.length) return null;
  return h('details', { class: 'settings-sec', id, open: open ? '' : undefined },
    h('summary', {}, title),
    h('div', { class: 'sec-body list' }, fields.map((f) => input(f, policies[f[0]]))));
}

export async function renderSettings(root, ctx) {
  const p = ctx.policies, b = ctx.business;
  const allFields = [...BOOKING_FIELDS, ...REMINDER_FIELDS, ...WAITLIST_FIELDS, ...HOLIDAY_DEFAULT_FIELDS,
    ...(b.is_demo ? DEMO_FIELDS : [])].filter(([c]) => c in p);

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

  const sections = [
    section('sec-booking', 'הזמנה ויומן', BOOKING_FIELDS, p),
    section('sec-reminders', 'תזכורות ושעות שקט', REMINDER_FIELDS, p),
    section('sec-waitlist', 'רשימת המתנה', WAITLIST_FIELDS, p),
    section('sec-holiday-defaults', 'חגים (ברירות מחדל)', HOLIDAY_DEFAULT_FIELDS, p),
    b.is_demo ? section('sec-demo', 'מגבלות הדגמה', DEMO_FIELDS, p) : null,
  ].filter(Boolean);

  const sticky = h('div', { class: 'policy-sticky actions' },
    h('button', { class: 'btn primary', type: 'submit', disabled: !!ctx.role && ctx.role !== 'owner' }, 'שמירה'));
  const polForm = h('form', { class: 'card policy-card', id: 'policy-form' },
    h('h2', {}, 'כללי הזמנה ויומן'),
    ...sections,
    h('p', { class: 'muted' }, 'ערוץ הודעות: באפליקציה בלבד (SMS / וואטסאפ / אימייל לא פעילים).'),
    ctx.role && ctx.role !== 'owner' ? h('p', { class: 'muted', id: 'policy-owner-only' }, NON_OWNER_NOTE) : null,
    sticky);
  if (ctx.role && ctx.role !== 'owner') for (const el of polForm.elements) el.disabled = true;
  polForm.addEventListener('submit', async (e) => { e.preventDefault();
    const patch = {};
    for (const [c, , t] of allFields) { const el = polForm.elements[c]; if (!el) continue; patch[c] = t === 'checkbox' ? el.checked : t === 'number' ? Number(el.value) : el.value; }
    for (const c of ['reminder_first_min', 'reminder_second_min']) if (c in patch && patch[c] > 0 && patch[c] < 10) { toast('תזכורת: 0 (כבוי) או לפחות 10 דקות', true); return; }
    try { const rows = await q(sb.from('policies').update(patch).eq('business_id', b.id).select('business_id'));
      if (!rows.length) throw new Error('permission denied'); await reloadContext(); toast('ההגדרות נשמרו'); }
    catch (err) { toast(heError(err), true); } });

  // Order (K4): booking link → business details → policy sections → holiday calendar list
  root.replaceChildren(renderBookingLink(ctx), bizForm, polForm, renderHolidays(ctx));
}
