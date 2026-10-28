// Staff (service providers) CRUD: display_name + is_active. Deactivate preferred over delete when appointments exist.
import { sb, q, heError } from './sb.js';
import { h, muted, toast, providerLabel } from '../../js/ui.js';
import { reloadContext, refreshSetupBanner } from './app.js';

const NAME_MIN = 2;
const NAME_MAX = 60;

function validateName(raw) {
  const name = (raw || '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, msg: `השם חייב להיות בין ${NAME_MIN} ל-${NAME_MAX} תווים.` };
  if (/[<>]/.test(name)) return { ok: false, msg: 'השם לא יכול לכלול את התווים < או >.' };
  return { ok: true, name };
}

function staffCard(st, ctx, label, rerender) {
  const form = h('form', { class: 'staff-form', 'data-staff-id': st?.id || 'new' },
    h('div', { class: 'row' },
      h('label', {}, 'שם', h('input', {
        name: 'display_name', required: true, maxlength: String(NAME_MAX),
        value: st?.display_name || '', placeholder: `למשל שם ה${label}`, autocomplete: 'off',
      })),
      st ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'is_active', checked: st.is_active }), 'פעיל') : null),
    h('p', { class: 'form-error hidden', role: 'alert' }),
    h('div', { class: 'actions' },
      st ? h('button', { type: 'button', class: 'btn ghost staff-deactivate', onclick: async () => {
        if (!confirm(`להשבית את "${st.display_name}"? (מומלץ במקום מחיקה אם יש תורים)`)) return;
        try {
          await q(sb.from('staff').update({ is_active: false }).eq('id', st.id).select('id'));
          await reloadContext(); await refreshSetupBanner(); toast('הושבת'); rerender();
        } catch (e) { toast(heError(e), true); }
      } }, 'השבתה') : null,
      st ? h('button', { type: 'button', class: 'btn ghost staff-delete', onclick: async () => {
        if (!confirm(`למחוק את "${st.display_name}"? אם יש תורים, עדיף להשבית.`)) return;
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
      const patch = { display_name: v.name, is_active: st ? form.is_active.checked : true };
      if (st) await q(sb.from('staff').update(patch).eq('id', st.id).select('id'));
      else await q(sb.from('staff').insert({ ...patch, business_id: ctx.business.id, role: 'barber' }).select('id'));
      await reloadContext(); await refreshSetupBanner(); toast(st ? 'נשמר' : 'נוסף'); rerender();
    } catch (err) {
      errEl.textContent = heError(err); errEl.classList.remove('hidden');
      toast(heError(err), true);
    } finally { btn.disabled = false; }
  });

  if (!st) {
    return h('div', { class: 'card staff-card', id: 'staff-add' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, `+ הוספת ${label}`), form);
  }
  return h('details', { class: 'card staff-card', open: false, 'data-staff-id': st.id },
    h('summary', {},
      h('span', {}, st.display_name, st.is_active ? '' : ' (לא פעיל)'),
      h('span', { class: 'muted' }, st.is_active ? 'פעיל' : 'מושבת')),
    form);
}

export async function renderStaff(root, ctx) {
  const label = providerLabel(ctx.business);
  const rerender = () => renderStaff(root, ctx);
  const list = ctx.staff.length
    ? ctx.staff.map((s) => staffCard(s, ctx, label, rerender))
    : [h('div', { class: 'card', id: 'staff-empty' },
        muted(`עדיין אין ${label}. הוסיפו את הראשון כדי לפתוח יומן ושעות.`))];
  root.replaceChildren(...list, staffCard(null, ctx, label, rerender));
}
