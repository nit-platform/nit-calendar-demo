// Services + steps editor: durations, wait range, wait_duration_mode, allow_overlap, prices, active,
// per-barber price/offer, and which services may be placed inside this service's wait.
import { sb, q, heError } from './sb.js';
import { h, muted, toast, shekel, providerLabel } from '../../js/ui.js';
import { reloadContext } from './app.js';

const num = (v) => (v === '' || v == null ? null : Number(v));
const field = (label, attrs) => h('label', {}, label, h('input', attrs));
const check = (label, attrs) => h('label', { class: 'check' }, h('input', { type: 'checkbox', ...attrs }), label);

function stepRow(s, i) {
  const wait = s && !s.is_blocking;
  const row = h('div', { class: 'step-row', 'data-step-id': s?.id || '' },
    h('div', { class: 'row' },
      field('מס׳', { name: 'step_order', type: 'number', min: 1, value: s?.step_order ?? i + 1, required: true, style: 'max-width:70px' }),
      field('שם השלב', { name: 'name', value: s?.name || '', required: true }),
      field('דקות', { name: 'duration_min', type: 'number', min: 1, value: s?.duration_min ?? 15, required: true, style: 'max-width:90px' })),
    h('div', { class: 'row' },
      check('המתנה (לא חוסם)', { name: 'wait', checked: wait }),
      field('עד (דקות, טווח)', { name: 'max_duration_min', type: 'number', min: 1, value: s?.max_duration_min ?? '', style: 'max-width:110px' }),
      h('label', {}, 'תכנון לפי', h('select', { name: 'wait_duration_mode' },
        [['', 'ברירת מחדל של העסק'], ['max', 'מקסימום'], ['min', 'מינימום']].map(([v, t]) => h('option', { value: v, selected: (s?.wait_duration_mode || '') === v }, t)))),
      check('מותר לשבץ בהמתנה', { name: 'allow_overlap', checked: s ? s.allow_overlap : true }),
      h('button', { type: 'button', class: 'btn small ghost', onclick: (e) => e.target.closest('.step-row').remove() }, '🗑 מחיקת שלב')));
  return row;
}

async function saveService(form, svc, ctx, steps) {
  const fd = (n) => form.querySelector(`[name=${n}]`);
  const bId = ctx.business.id;
  const patch = { name: fd('svc_name').value.trim(), base_price: num(fd('base_price').value) ?? 0, buffer_after_min: num(fd('buffer_after_min').value) ?? 0,
    is_insertable: fd('is_insertable').checked, is_active: fd('is_active').checked };
  let id = svc?.id;
  if (id) await q(sb.from('services').update(patch).eq('id', id).select('id'));
  else id = (await q(sb.from('services').insert({ ...patch, business_id: bId }).select('id')))[0].id;
  // steps: delete removed ones, then write all (orders first moved out of the way to avoid unique clashes)
  const rows = [...form.querySelectorAll('.step-row')].map((r) => {
    const g = (n) => r.querySelector(`[name=${n}]`); const wait = g('wait').checked;
    return { id: r.dataset.stepId || undefined, service_id: id, step_order: num(g('step_order').value), name: g('name').value.trim(),
      duration_min: num(g('duration_min').value), max_duration_min: wait ? num(g('max_duration_min').value) : null, is_blocking: !wait,
      wait_duration_mode: g('wait_duration_mode').value || null, allow_overlap: g('allow_overlap').checked };
  });
  const keep = rows.filter((r) => r.id).map((r) => r.id);
  const gone = steps.filter((s) => !keep.includes(s.id)).map((s) => s.id);
  if (gone.length) await q(sb.from('service_steps').delete().in('id', gone).select('id'));
  for (const [i, r] of rows.filter((r) => r.id).entries()) await q(sb.from('service_steps').update({ step_order: 1000 + i }).eq('id', r.id).select('id'));
  for (const r of rows) {
    const { id: sid, ...v } = r;
    if (sid) await q(sb.from('service_steps').update(v).eq('id', sid).select('id'));
    else await q(sb.from('service_steps').insert(v).select('id'));
  }
  // per-barber offer + price override
  for (const st of ctx.staff) {
    const on = form.querySelector(`[name=offer_${st.id}]`).checked, price = num(form.querySelector(`[name=price_${st.id}]`).value);
    if (on) await q(sb.from('staff_services').upsert({ staff_id: st.id, service_id: id, price_override: price }).select('staff_id'));
    else await q(sb.from('staff_services').delete().eq('staff_id', st.id).eq('service_id', id).select('staff_id'));
  }
  // services allowed inside this service's wait
  const guests = [...form.querySelectorAll('[name^=guest_]')];
  if (guests.length) {
    await q(sb.from('service_overlap_rules').delete().eq('host_service_id', id).select('host_service_id'));
    const ins = guests.filter((g) => g.checked).map((g) => ({ host_service_id: id, guest_service_id: g.name.slice(6) }));
    if (ins.length) await q(sb.from('service_overlap_rules').insert(ins).select('host_service_id'));
  }
  return id;
}

function serviceCard(svc, steps, offers, rules, ctx, rerender) {
  const others = ctx.services.filter((s) => s.id !== svc?.id);
  const hasWait = steps.some((s) => !s.is_blocking);
  const form = h('form', { class: 'svc-form', 'data-service-id': svc?.id || 'new' },
    h('div', { class: 'row' },
      field('שם השירות', { name: 'svc_name', value: svc?.name || '', required: true }),
      field('מחיר (₪)', { name: 'base_price', type: 'number', min: 0, step: '0.01', value: svc?.base_price ?? 0, style: 'max-width:110px' }),
      field('מרווח אחרי (דק׳)', { name: 'buffer_after_min', type: 'number', min: 0, value: svc?.buffer_after_min ?? 0, style: 'max-width:110px' })),
    h('div', { class: 'row' }, check('פעיל', { name: 'is_active', checked: svc ? svc.is_active : true }),
      check('אפשר לשבץ אותו בזמני המתנה של שירותים אחרים', { name: 'is_insertable', checked: !!svc?.is_insertable })),
    h('h3', { class: 'sub' }, 'שלבים'),
    h('div', { class: 'steps-tbl' }, (steps.length ? steps : [null]).map((s, i) => stepRow(s, i))),
    h('button', { type: 'button', class: 'btn small outline', onclick: (e) => { const t = e.target.previousElementSibling; t.append(stepRow(null, t.children.length)); } }, '+ שלב'),
    h('h3', { class: 'sub' }, `${providerLabel(ctx.business)} – מחיר אישי`),
    h('div', { class: 'list' }, ctx.staff.map((st) => {
      const o = offers.find((x) => x.staff_id === st.id);
      return h('div', { class: 'row' }, check(st.display_name, { name: 'offer_' + st.id, checked: !!o || !svc }),
        field('מחיר אישי (ריק = רגיל)', { name: 'price_' + st.id, type: 'number', min: 0, step: '0.01', value: o?.price_override ?? '', style: 'max-width:150px' }));
    })),
    svc && hasWait ? h('div', {}, h('h3', { class: 'sub' }, 'מה מותר לשבץ בזמן ההמתנה'),
      others.length ? others.map((g) => check(g.name + (g.is_insertable ? '' : ' (לא מסומן "אפשר לשבץ")'), { name: 'guest_' + g.id, checked: rules.some((r) => r.guest_service_id === g.id) })) : muted('אין שירותים אחרים')) : null,
    h('div', { class: 'actions' },
      svc ? h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
        if (!confirm(`למחוק את "${svc.name}"? (אם יש לו תורים, עדיף לסמן "לא פעיל")`)) return;
        try { await q(sb.from('services').delete().eq('id', svc.id).select('id')); await reloadContext(); toast('השירות נמחק'); rerender(); }
        catch (e) { toast(/foreign key|23503/.test(e.message + e.code) ? 'יש לשירות תורים. סמנו אותו "לא פעיל" במקום למחוק.' : heError(e), true); }
      } }, 'מחיקה') : null,
      h('button', { type: 'submit', class: 'btn primary' }, 'שמירה')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { await saveService(form, svc, ctx, steps); await reloadContext(); toast('נשמר'); rerender(); }
    catch (err) { toast(heError(err), true); } finally { btn.disabled = false; }
  });
  const total = steps.reduce((a, s) => a + s.duration_min, 0);
  return h('details', { class: 'card svc-card', open: !svc },
    h('summary', {}, h('span', {}, svc ? svc.name : '+ שירות חדש', svc && !svc.is_active ? ' (לא פעיל)' : ''),
      svc ? h('span', { class: 'muted' }, `${total} דק׳ · ${shekel(svc.base_price)}`) : null), form);
}

export async function renderServices(root, ctx) {
  const ids = ctx.services.map((s) => s.id);
  const [steps, offers, rules] = ids.length ? await Promise.all([
    q(sb.from('service_steps').select('*').in('service_id', ids).order('step_order')),
    q(sb.from('staff_services').select('*').in('service_id', ids)),
    q(sb.from('service_overlap_rules').select('*').in('host_service_id', ids))]) : [[], [], []];
  const rerender = () => renderServices(root, ctx);
  root.replaceChildren(
    ...ctx.services.map((s) => serviceCard(s, steps.filter((x) => x.service_id === s.id), offers.filter((x) => x.service_id === s.id),
      rules.filter((r) => r.host_service_id === s.id), ctx, rerender)),
    serviceCard(null, [], [], [], ctx, rerender));
  root.lastChild.open = false;
}
