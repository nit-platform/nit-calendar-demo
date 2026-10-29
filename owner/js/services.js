// Services + steps editor: simple (one blocking step) by default; advanced multi-step with wait.
// Durations, wait range, wait_duration_mode, allow_overlap, prices, active, per-staff offer,
// and which services may be placed inside this service's wait.
import { sb, q, heError } from './sb.js';
import { $, h, muted, toast, shekel, providerLabel } from '../../js/ui.js';
import { reloadContext } from './app.js';

const NAME_PLACEHOLDER = 'למשל: ייעוץ / טיפול / פגישה';
const WAIT_HELP = 'בזמן הזה אפשר לשבץ שירות קצר אחר, אם סימנתם למטה.';

const num = (v) => (v === '' || v == null ? null : Number(v));
const field = (label, attrs) => h('label', {}, label, h('input', attrs));
const check = (label, attrs) => h('label', { class: 'check' }, h('input', { type: 'checkbox', ...attrs }), label);

/** True when the service already has wait gaps or more than one step. */
function needsAdvanced(steps) {
  return steps.length > 1 || steps.some((s) => s && !s.is_blocking);
}

function askDeleteConfirm(svcName) {
  const dlg = $('#svc-confirm');
  const body = $('#svc-confirm-body');
  if (!dlg || typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm(`למחוק את "${svcName}"? (אם יש לו תורים, עדיף לסמן "לא פעיל")`));
  }
  if (body) {
    body.textContent = `למחוק את "${svcName}"? אם יש לו תורים, עדיף לסמן «לא פעיל» במקום מחיקה.`;
  }
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'yes');
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
  });
}

/** Horizontal preview: מריחה → ⏳ המתנה → שטיפה with durations. */
function stepsTimeline(steps) {
  const list = (steps || []).filter(Boolean);
  if (!list.length) return null;
  const kids = [];
  list.forEach((s, i) => {
    if (i) kids.push(h('span', { class: 'svc-tl-arrow', 'aria-hidden': 'true' }, '→'));
    const wait = !s.is_blocking;
    const dur = wait && s.max_duration_min != null && s.max_duration_min !== ''
      ? `${s.duration_min}–${s.max_duration_min} דק׳`
      : `${s.duration_min} דק׳`;
    kids.push(h('span', { class: wait ? 'svc-tl-chip wait' : 'svc-tl-chip work' },
      wait ? `⏳ ${s.name || 'המתנה'}` : (s.name || 'שלב'),
      h('small', {}, dur)));
  });
  return h('div', { class: 'svc-timeline', dir: 'ltr', role: 'img', 'aria-label': 'תרשים שלבי השירות' }, ...kids);
}

function stepRow(s, i, { advanced } = { advanced: true }) {
  const wait = s && !s.is_blocking;
  const adv = h('div', { class: 'row step-adv' + (advanced ? '' : ' hidden') },
    h('label', { class: 'check wait-check' },
      h('input', { type: 'checkbox', name: 'wait', checked: wait }),
      'המתנה (לא חוסם)',
      h('button', {
        type: 'button', class: 'hint-btn', title: WAIT_HELP,
        'aria-label': WAIT_HELP,
        onclick: (e) => { e.preventDefault(); toast(WAIT_HELP); },
      }, '?')),
    field('עד (דקות, טווח)', { name: 'max_duration_min', type: 'number', min: 1, value: s?.max_duration_min ?? '', style: 'max-width:110px' }),
    h('label', {}, 'תכנון לפי', h('select', { name: 'wait_duration_mode' },
      [['', 'ברירת מחדל של העסק'], ['max', 'מקסימום'], ['min', 'מינימום']].map(([v, t]) =>
        h('option', { value: v, selected: (s?.wait_duration_mode || '') === v }, t)))),
    check('מותר לשבץ בהמתנה', { name: 'allow_overlap', checked: s ? s.allow_overlap : true }),
    h('button', { type: 'button', class: 'btn small ghost', onclick: (e) => e.target.closest('.step-row').remove() }, 'מחיקת שלב'));

  const row = h('div', { class: 'step-row', 'data-step-id': s?.id || '' },
    h('div', { class: 'row' },
      field('מס׳', { name: 'step_order', type: 'number', min: 1, value: s?.step_order ?? i + 1, required: true, style: 'max-width:70px', ...(advanced ? {} : { class: 'hidden-input' }) }),
      field(advanced ? 'שם השלב' : 'שם השלב (פנימי)', { name: 'name', value: s?.name || (advanced ? '' : 'שלב 1'), required: advanced, ...(advanced ? {} : { class: 'hidden-input' }) }),
      field('דקות', { name: 'duration_min', type: 'number', min: 1, value: s?.duration_min ?? 30, required: true, style: 'max-width:90px' })),
    adv);
  if (!advanced) {
    // Simple mode: one blocking step — hide order/name clutter; keep inputs for save.
    row.querySelectorAll('.hidden-input').forEach((inp) => {
      const lab = inp.closest('label');
      if (lab) lab.classList.add('visually-hidden');
    });
    // Ensure wait is off in simple mode
    const w = row.querySelector('[name=wait]');
    if (w) w.checked = false;
  }
  return row;
}

async function saveService(form, svc, ctx, steps) {
  const fd = (n) => form.querySelector(`[name=${n}]`);
  const bId = ctx.business.id;
  const name = fd('svc_name').value.trim();
  if (name.length < 2 || name.length > 80 || /[<>]/.test(name)) {
    throw new Error('שם השירות חייב להיות בין 2 ל-80 תווים, בלי < או >');
  }
  const patch = {
    name,
    base_price: num(fd('base_price').value) ?? 0,
    buffer_after_min: num(fd('buffer_after_min').value) ?? 0,
    is_insertable: fd('is_insertable').checked,
    is_active: fd('is_active').checked,
  };
  let id = svc?.id;
  if (id) await q(sb.from('services').update(patch).eq('id', id).select('id'));
  else id = (await q(sb.from('services').insert({ ...patch, business_id: bId }).select('id')))[0].id;

  const advanced = form.dataset.mode === 'advanced';
  let rows = [...form.querySelectorAll('.step-row')].map((r) => {
    const g = (n) => r.querySelector(`[name=${n}]`);
    const wait = advanced && g('wait').checked;
    return {
      id: r.dataset.stepId || undefined,
      service_id: id,
      step_order: num(g('step_order').value),
      name: (g('name').value.trim() || name),
      duration_min: num(g('duration_min').value),
      max_duration_min: wait ? num(g('max_duration_min').value) : null,
      is_blocking: !wait,
      wait_duration_mode: wait ? (g('wait_duration_mode').value || null) : null,
      allow_overlap: wait ? g('allow_overlap').checked : false,
    };
  });
  if (!rows.length) {
    rows = [{
      service_id: id, step_order: 1, name, duration_min: 30,
      max_duration_min: null, is_blocking: true, wait_duration_mode: null, allow_overlap: false,
    }];
  }
  if (!advanced) {
    // Force single blocking step from the first row
    const r0 = rows[0];
    rows = [{
      ...r0,
      step_order: 1,
      name: r0.name || name,
      is_blocking: true,
      max_duration_min: null,
      wait_duration_mode: null,
      allow_overlap: false,
    }];
  }
  const keep = rows.filter((r) => r.id).map((r) => r.id);
  const gone = steps.filter((s) => !keep.includes(s.id)).map((s) => s.id);
  if (gone.length) await q(sb.from('service_steps').delete().in('id', gone).select('id'));
  for (const [i, r] of rows.filter((r) => r.id).entries()) {
    await q(sb.from('service_steps').update({ step_order: 1000 + i }).eq('id', r.id).select('id'));
  }
  for (const r of rows) {
    const { id: sid, ...v } = r;
    if (sid) await q(sb.from('service_steps').update(v).eq('id', sid).select('id'));
    else await q(sb.from('service_steps').insert(v).select('id'));
  }
  for (const st of ctx.staff) {
    const on = form.querySelector(`[name=offer_${st.id}]`).checked;
    const price = num(form.querySelector(`[name=price_${st.id}]`).value);
    if (on) await q(sb.from('staff_services').upsert({ staff_id: st.id, service_id: id, price_override: price }).select('staff_id'));
    else await q(sb.from('staff_services').delete().eq('staff_id', st.id).eq('service_id', id).select('staff_id'));
  }
  const guests = [...form.querySelectorAll('[name^=guest_]')];
  if (guests.length) {
    await q(sb.from('service_overlap_rules').delete().eq('host_service_id', id).select('host_service_id'));
    const ins = guests.filter((g) => g.checked).map((g) => ({ host_service_id: id, guest_service_id: g.name.slice(6) }));
    if (ins.length) await q(sb.from('service_overlap_rules').insert(ins).select('host_service_id'));
  } else if (!advanced && svc) {
    // Leaving simple mode: clear any leftover overlap rules for this host
    await q(sb.from('service_overlap_rules').delete().eq('host_service_id', id).select('host_service_id'));
  }
  return id;
}

function serviceCard(svc, steps, offers, rules, ctx, rerender) {
  const others = ctx.services.filter((s) => s.id !== svc?.id);
  const startAdvanced = needsAdvanced(steps);
  let advanced = startAdvanced;
  const seedSteps = steps.length ? steps : [null];

  const stepsBox = h('div', { class: 'steps-tbl' },
    ...seedSteps.map((s, i) => stepRow(s, i, { advanced })));
  const timelineHost = h('div', { class: 'svc-tl-host' },
    advanced ? stepsTimeline(steps) : null);
  const addStepBtn = h('button', {
    type: 'button', class: 'btn small outline' + (advanced ? '' : ' hidden'),
    onclick: () => { stepsBox.append(stepRow(null, stepsBox.children.length, { advanced: true })); refreshTimeline(); },
  }, '+ שלב');

  const showGuests = advanced && steps.some((s) => s && !s.is_blocking);
  const guestsBox = h('div', { class: 'svc-guests' + (showGuests ? '' : ' hidden') });
  function paintGuests(visible) {
    guestsBox.classList.toggle('hidden', !visible);
    if (!visible) { guestsBox.replaceChildren(); return; }
    guestsBox.replaceChildren(
      h('h3', { class: 'sub' }, 'מה מותר לשבץ בזמן ההמתנה'),
      ...(others.length
        ? others.map((g) => check(g.name + (g.is_insertable ? '' : ' (לא מסומן "אפשר לשבץ")'), {
          name: 'guest_' + g.id,
          checked: rules.some((r) => r.guest_service_id === g.id),
        }))
        : [muted('אין שירותים אחרים')]));
  }
  paintGuests(showGuests);

  const modeBtn = h('button', {
    type: 'button',
    class: 'btn small outline svc-mode-btn' + (advanced ? ' hidden' : ''),
  }, 'שירות עם שלבי המתנה (מתקדם)');

  const form = h('form', {
    class: 'svc-form',
    'data-service-id': svc?.id || 'new',
    'data-mode': advanced ? 'advanced' : 'simple',
  },
    h('div', { class: 'row' },
      field('שם השירות', {
        name: 'svc_name', value: svc?.name || '', required: true, minlength: 2, maxlength: 80,
        placeholder: NAME_PLACEHOLDER, pattern: '[^<>]{2,80}',
      }),
      field('מחיר (₪)', { name: 'base_price', type: 'number', min: 0, step: '0.01', value: svc?.base_price ?? 0, style: 'max-width:110px' }),
      field('מרווח אחרי (דק׳)', { name: 'buffer_after_min', type: 'number', min: 0, value: svc?.buffer_after_min ?? 0, style: 'max-width:110px' })),
    h('div', { class: 'row' },
      check('פעיל', { name: 'is_active', checked: svc ? svc.is_active : true }),
      check('אפשר לשבץ אותו בזמני המתנה של שירותים אחרים', { name: 'is_insertable', checked: !!svc?.is_insertable })),
    h('h3', { class: 'sub' }, advanced ? 'שלבים' : 'משך השירות'),
    timelineHost,
    stepsBox,
    addStepBtn,
    modeBtn,
    h('p', { class: 'muted svc-simple-hint' + (advanced ? ' hidden' : '') },
      'מצב פשוט: שלב אחד שחוסם את היומן. לשירות עם המתנה באמצע — עברו למתקדם.'),
    h('h3', { class: 'sub' }, `${providerLabel(ctx.business)} – מחיר אישי`),
    h('div', { class: 'list' }, ctx.staff.map((st) => {
      const o = offers.find((x) => x.staff_id === st.id);
      return h('div', { class: 'row' },
        check(st.display_name, { name: 'offer_' + st.id, checked: !!o || !svc }),
        field('מחיר אישי (ריק = רגיל)', {
          name: 'price_' + st.id, type: 'number', min: 0, step: '0.01',
          value: o?.price_override ?? '', style: 'max-width:150px',
        }));
    })),
    guestsBox,
    h('div', { class: 'actions' },
      svc ? h('button', {
        type: 'button', class: 'btn ghost', onclick: async () => {
          if (!(await askDeleteConfirm(svc.name))) return;
          try {
            await q(sb.from('services').delete().eq('id', svc.id).select('id'));
            await reloadContext(); toast('השירות נמחק'); rerender();
          } catch (e) {
            toast(/foreign key|23503/.test(e.message + e.code)
              ? 'יש לשירות תורים. סמנו אותו "לא פעיל" במקום למחוק.'
              : heError(e), true);
          }
        },
      }, 'מחיקה') : null,
      h('button', { type: 'submit', class: 'btn primary' }, 'שמירה')));

  function refreshTimeline() {
    const live = [...stepsBox.querySelectorAll('.step-row')].map((r) => {
      const g = (n) => r.querySelector(`[name=${n}]`);
      return {
        name: g('name')?.value || '',
        duration_min: num(g('duration_min')?.value) || 0,
        max_duration_min: num(g('max_duration_min')?.value),
        is_blocking: !g('wait')?.checked,
      };
    });
    const tl = stepsTimeline(live); timelineHost.replaceChildren(...(tl ? [tl] : []));
    const hasWait = live.some((s) => !s.is_blocking);
    paintGuests(advanced && hasWait);
  }

  function enableAdvanced() {
    if (advanced) return;
    advanced = true;
    form.dataset.mode = 'advanced';
    modeBtn.classList.add('hidden');
    form.querySelector('.svc-simple-hint')?.classList.add('hidden');
    addStepBtn.classList.remove('hidden');
    // Rebuild step rows in advanced mode (preserve values)
    const preserved = [...stepsBox.querySelectorAll('.step-row')].map((r, i) => {
      const g = (n) => r.querySelector(`[name=${n}]`);
      return {
        id: r.dataset.stepId || undefined,
        step_order: num(g('step_order').value) || i + 1,
        name: g('name').value,
        duration_min: num(g('duration_min').value) || 30,
        max_duration_min: num(g('max_duration_min').value),
        is_blocking: !g('wait').checked,
        wait_duration_mode: g('wait_duration_mode').value || null,
        allow_overlap: g('allow_overlap').checked,
      };
    });
    stepsBox.replaceChildren(...(preserved.length ? preserved : [null]).map((s, i) => stepRow(s, i, { advanced: true })));
    const h3 = [...form.querySelectorAll('h3.sub')].find((el) => el.textContent === 'משך השירות');
    if (h3) h3.textContent = 'שלבים';
    refreshTimeline();
    stepsBox.addEventListener('change', refreshTimeline);
    stepsBox.addEventListener('input', refreshTimeline);
  }

  modeBtn.addEventListener('click', enableAdvanced);
  if (advanced) {
    stepsBox.addEventListener('change', refreshTimeline);
    stepsBox.addEventListener('input', refreshTimeline);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await saveService(form, svc, ctx, steps);
      await reloadContext();
      toast('נשמר');
      rerender();
    } catch (err) { toast(heError(err), true); }
    finally { btn.disabled = false; }
  });

  const total = steps.reduce((a, s) => a + (s?.duration_min || 0), 0);
  return h('details', { class: 'card svc-card', open: !svc },
    h('summary', {},
      h('span', {}, svc ? svc.name : '+ שירות חדש', svc && !svc.is_active ? ' (לא פעיל)' : ''),
      svc ? h('span', { class: 'muted' }, `${total} דק׳ · ${shekel(svc.base_price)}`) : null),
    form);
}

export async function renderServices(root, ctx) {
  const ids = ctx.services.map((s) => s.id);
  const [steps, offers, rules] = ids.length ? await Promise.all([
    q(sb.from('service_steps').select('*').in('service_id', ids).order('step_order')),
    q(sb.from('staff_services').select('*').in('service_id', ids)),
    q(sb.from('service_overlap_rules').select('*').in('host_service_id', ids))]) : [[], [], []];
  const rerender = () => renderServices(root, ctx);
  const empty = !ctx.services.length
    ? h('div', { class: 'card empty-tab-cta', id: 'empty-services-cta' },
        h('p', {}, 'עדיין אין שירותים.'),
        h('p', { class: 'muted' }, 'הוסיפו שירות אחד לפחות כדי שלקוחות יוכלו לקבוע תור.'),
        h('div', { class: 'actions' },
          h('button', {
            type: 'button', class: 'btn primary',
            onclick: () => document.querySelector('.svc-card summary')?.click?.()
              || document.querySelector('.svc-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          }, 'הוספת שירות')))
    : null;
  root.replaceChildren(
    ...(empty ? [empty] : []),
    ...ctx.services.map((s) => serviceCard(
      s,
      steps.filter((x) => x.service_id === s.id),
      offers.filter((x) => x.service_id === s.id),
      rules.filter((r) => r.host_service_id === s.id),
      ctx, rerender)),
    serviceCard(null, [], [], [], ctx, rerender));
  // Empty list: leave the "+ שירות חדש" card open (B1). Otherwise collapse the blank card.
  if (ctx.services.length) root.lastChild.open = false;
}
