// Staff (service providers) CRUD: display_name + is_active. Deactivate preferred over delete when appointments exist.
// New providers go through owner_add_staff so they get active-service links + default/peer working hours.
import { sb, q, rpc, heError } from './sb.js';
import { h, muted, toast, providerLabel } from '../../js/ui.js';
import { reloadContext, refreshSetupBanner, openTab } from './app.js';
import { askDangerConfirm } from './confirm.js';

const NAME_MIN = 2;
const NAME_MAX = 60;

function validateName(raw) {
  const name = (raw || '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, msg: `השם חייב להיות בין ${NAME_MIN} ל-${NAME_MAX} תווים.` };
  if (/[<>]/.test(name)) return { ok: false, msg: 'השם לא יכול לכלול את התווים < או >.' };
  return { ok: true, name };
}

function bookingGap(st, meta) {
  const noHours = !(meta.hours > 0);
  const noSvc = !(meta.services > 0);
  if (!st?.is_active || (!noHours && !noSvc)) return null;
  const reasons = [];
  if (noHours) reasons.push('אין שעות עבודה');
  if (noSvc) reasons.push('לא משויך לשירות');
  return `לא מופיע בדף ההזמנה: ${reasons.join(' / ')}`;
}

function staffCard(st, ctx, label, rerender, meta) {
  const gap = st ? bookingGap(st, meta || { hours: 0, services: 0 }) : null;
  const warn = gap ? h('div', { class: 'staff-booking-warn', role: 'status' },
    h('p', {}, gap),
    h('div', { class: 'staff-warn-actions' },
      h('button', { type: 'button', class: 'btn small primary staff-fix-defaults', onclick: async () => {
        try {
          await rpc('owner_staff_ensure_defaults', { p_staff_id: st.id });
          await reloadContext(); await refreshSetupBanner(); toast('עודכן להופעה בדף ההזמנה'); rerender();
        } catch (e) { toast(heError(e), true); }
      } }, 'תיקון מהיר'),
      (!(meta?.hours > 0) ? h('button', { type: 'button', class: 'btn small outline', onclick: () => openTab('hours') }, 'לשעות עבודה') : null),
      (!(meta?.services > 0) ? h('button', { type: 'button', class: 'btn small outline', onclick: () => openTab('services') }, 'לשיוך שירותים') : null),
    )) : null;

  const form = h('form', { class: 'staff-form', 'data-staff-id': st?.id || 'new' },
    h('div', { class: 'row' },
      h('label', {}, 'שם', h('input', {
        name: 'display_name', required: true, maxlength: String(NAME_MAX),
        value: st?.display_name || '', placeholder: `למשל שם ה${label}`, autocomplete: 'off',
      })),
      st ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'is_active', checked: st.is_active }), 'פעיל') : null),
    warn,
    h('p', { class: 'form-error hidden', role: 'alert' }),
    h('div', { class: 'actions' },
      st ? h('button', { type: 'button', class: 'btn ghost staff-deactivate', onclick: async () => {
        if (!(await askDangerConfirm({
          title: 'השבתת נותן שירות?',
          body: `להשבית את "${st.display_name}"? (מומלץ במקום מחיקה אם יש תורים)`,
          yesLabel: 'כן, השביתו',
        }))) return;
        try {
          await q(sb.from('staff').update({ is_active: false }).eq('id', st.id).select('id'));
          await reloadContext(); await refreshSetupBanner(); toast('הושבת'); rerender();
        } catch (e) { toast(heError(e), true); }
      } }, 'השבתה') : null,
      st ? h('button', { type: 'button', class: 'btn ghost staff-delete', onclick: async () => {
        if (!(await askDangerConfirm({
          title: 'מחיקת נותן שירות?',
          body: `למחוק את "${st.display_name}"? אם יש תורים, עדיף להשבית.`,
          yesLabel: 'כן, מחקו',
        }))) return;
        try {
          await q(sb.from('staff').delete().eq('id', st.id).select('id'));
          await reloadContext(); await refreshSetupBanner(); toast('נמחק'); rerender();
        } catch (e) {
          toast(/foreign key|23503/.test((e.message || '') + (e.code || ''))
            ? 'יש תורים משויכים. השביתו במקום למחוק.' : heError(e), true);
        }
      } }, 'מחיקה') : null,
      h('button', { type: 'submit', class: 'btn primary' }, st ? 'שמירה' : `+ הוספת ${label}`)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    errEl.textContent = ''; errEl.classList.add('hidden');
    const v = validateName(form.display_name.value);
    if (!v.ok) { errEl.textContent = v.msg; errEl.classList.remove('hidden'); form.display_name.focus(); return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (st) {
        await q(sb.from('staff').update({
          display_name: v.name, is_active: form.is_active.checked,
        }).eq('id', st.id).select('id'));
      } else {
        await rpc('owner_add_staff', { p_business_id: ctx.business.id, p_display_name: v.name });
      }
      await reloadContext(); await refreshSetupBanner(); toast(st ? 'נשמר' : 'נוסף'); rerender();
    } catch (err) {
      errEl.textContent = heError(err); errEl.classList.remove('hidden');
      toast(heError(err), true);
    } finally { btn.disabled = false; }
  });

  if (!st) {
    return h('div', { class: 'card staff-card', id: 'staff-add' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, `+ הוספת ${label}`),
      h('p', { class: 'muted staff-add-hint' },
        'נותן שירות חדש יקושר אוטומטית לכל השירותים הפעילים ויקבל שעות עבודה (מהצוות הקיים או תבנית ברירת מחדל).'),
      form);
  }
  const summaryExtra = gap
    ? h('span', { class: 'staff-gap-badge', title: gap }, 'לא בדף ההזמנה')
    : h('span', { class: 'muted' }, st.is_active ? 'פעיל' : 'מושבת');
  return h('details', {
    class: 'card staff-card' + (gap ? ' staff-incomplete' : ''),
    open: !!gap, 'data-staff-id': st.id,
  },
    h('summary', {},
      h('span', {}, st.display_name, st.is_active ? '' : ' (לא פעיל)'),
      summaryExtra),
    form);
}

async function loadStaffMeta(staff) {
  const ids = staff.map((s) => s.id);
  const meta = Object.fromEntries(ids.map((id) => [id, { hours: 0, services: 0 }]));
  if (!ids.length) return meta;
  const [wh, ss] = await Promise.all([
    q(sb.from('working_hours').select('staff_id').in('staff_id', ids)),
    q(sb.from('staff_services').select('staff_id').in('staff_id', ids)),
  ]);
  for (const r of wh) meta[r.staff_id].hours += 1;
  for (const r of ss) meta[r.staff_id].services += 1;
  return meta;
}

export async function renderStaff(root, ctx) {
  const label = providerLabel(ctx.business);
  const meta = await loadStaffMeta(ctx.staff);
  const rerender = () => renderStaff(root, ctx);
  const list = ctx.staff.length
    ? ctx.staff.map((s) => staffCard(s, ctx, label, rerender, meta[s.id]))
    : [h('div', { class: 'card', id: 'staff-empty' },
        muted(`עדיין אין ${label}. הוסיפו את הראשון כדי לפתוח יומן ושעות.`))];
  root.replaceChildren(...list, staffCard(null, ctx, label, rerender, null));
}
