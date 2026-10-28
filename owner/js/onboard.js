// K1 onboarding wizard: 6 steps → business draft after step 1 via owner_create_business RPC.
import { sb, q, rpc, heError } from './sb.js';
import { h, toast, providerLabel, DEFAULT_PROVIDER_LABEL } from '../../js/ui.js';
import { SLUG_RE, RESERVED, slugError, bookingUrl } from './bookinglink.js';

const PRESETS = ['ספר', 'מטפלת', 'מאמן', 'קוסמטיקאית', 'נותן שירות', 'אחר…'];
const NAME_MIN = 2, NAME_MAX = 80;

function suggestSlug(name) {
  const s = String(name || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (s.length >= 3 && SLUG_RE.test(s) && !RESERVED.has(s)) return s;
  return '';
}

function errBox() { return h('p', { class: 'form-error hidden', role: 'alert', id: 'onboard-error' }); }
function showErr(root, msg) {
  const el = root.querySelector('#onboard-error') || root.querySelector('.form-error');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

/** @param {(biz: object) => void|Promise<void>} onDone @param {() => void} onCancel */
export async function renderOnboard(root, { user, onDone, onCancel }) {
  const state = {
    step: 1,
    business: null,
    staff: [],
    service: null,
    hoursApplied: false,
  };

  const go = async (n) => { state.step = n; await paint(); };
  async function paint() {
    root.replaceChildren(await stepView());
  }

  async function stepView() {
    const progress = h('div', { class: 'onboard-progress', 'aria-label': `שלב ${state.step} מתוך 6` },
      ...[1, 2, 3, 4, 5, 6].map((i) => h('span', { class: i === state.step ? 'on' : (i < state.step ? 'done' : '') }, String(i))));
    const card = h('div', { class: 'card onboard-card', id: `onboard-step-${state.step}` });
    if (state.step === 1) card.append(...step1(card));
    else if (state.step === 2) card.append(...step2(card));
    else if (state.step === 3) card.append(...step3(card));
    else if (state.step === 4) card.append(...step4(card));
    else if (state.step === 5) card.append(...await step5(card));
    else card.append(...step6(card));
    return h('div', { class: 'onboard', id: 'view-onboard-inner' },
      h('div', { class: 'onboard-top' },
        h('h2', {}, 'הקמת עסק חדש'),
        progress,
        h('button', { type: 'button', class: 'btn link onboard-exit', onclick: () => onCancel?.() },
          state.business ? 'המשך אחר כך' : 'ביטול')),
      card);
  }

  function step1(card) {
    const other = h('input', { name: 'provider_other', maxlength: '30', placeholder: 'כינוי חופשי', class: 'hidden', autocomplete: 'off' });
    const sel = h('select', { name: 'provider_preset', id: 'onboard-provider' },
      ...PRESETS.map((p) => h('option', { value: p }, p)));
    sel.value = 'נותן שירות';
    sel.addEventListener('change', () => {
      const isOther = sel.value === 'אחר…';
      other.classList.toggle('hidden', !isOther);
      if (isOther) other.focus();
    });
    const form = h('form', { id: 'onboard-form-1', novalidate: '' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, '1. פרטי העסק'),
      h('label', {}, 'שם העסק', h('input', { name: 'name', required: true, maxlength: String(NAME_MAX), autocomplete: 'organization', placeholder: 'למשל: הסטודיו של נועה' })),
      h('label', {}, 'כינוי לנותן שירות', sel, other),
      h('label', {}, 'וואטסאפ (אופציונלי)', h('input', { name: 'phone', dir: 'ltr', maxlength: '40', inputmode: 'tel', autocomplete: 'tel', placeholder: '+972…' })),
      h('p', { class: 'muted' }, 'אזור זמן: Asia/Jerusalem'),
      errBox(),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', id: 'onboard-next-1' }, 'המשך')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, '');
      const name = form.name.value.trim().replace(/\s+/g, ' ');
      if (name.length < NAME_MIN || name.length > NAME_MAX || /[<>]/.test(name)) {
        showErr(form, `שם העסק חייב להיות בין ${NAME_MIN} ל-${NAME_MAX} תווים, ללא < או >.`);
        form.name.focus(); return;
      }
      let label = sel.value === 'אחר…' ? other.value.trim() : sel.value;
      if (!label || label === 'אחר…') { showErr(form, 'בחרו כינוי לנותן שירות.'); return; }
      if (label.length > 30 || /[<>]/.test(label)) { showErr(form, 'כינוי לא תקין (עד 30 תווים, ללא <>).'); return; }
      if (label === DEFAULT_PROVIDER_LABEL) label = null; // DB default wording via UI helper
      const phone = form.phone.value.trim() || null;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const row = await rpc('owner_create_business', {
          p_name: name,
          p_provider_label: label,
          p_phone_whatsapp: phone,
          p_customers_choose_provider: true,
          p_public_slug: null,
        });
        state.business = row;
        toast('העסק נוצר — אפשר להמשיך או לחזור אחר כך');
        await go(2);
      } catch (err) {
        showErr(form, heError(err));
      } finally { btn.disabled = false; }
    });
    return [form];
  }

  function step2(card) {
    const label = providerLabel(state.business);
    const list = h('div', { class: 'list', id: 'onboard-staff-list' });
    const refreshList = () => {
      list.replaceChildren(...(state.staff.length
        ? state.staff.map((s) => h('div', { class: 'item' }, h('span', {}, s.display_name)))
        : [h('p', { class: 'muted' }, `עדיין אין ${label}. הוסיפו לפחות אחד.`)]));
    };
    refreshList();
    const form = h('form', { id: 'onboard-form-2' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, `2. צוות — ${label}`),
      list,
      h('div', { class: 'row' },
        h('label', {}, 'שם', h('input', { name: 'display_name', required: true, maxlength: '60', placeholder: `שם ה${label}`, autocomplete: 'off' }))),
      errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn', id: 'onboard-add-staff' }, `+ עוד ${label}`),
        h('button', { type: 'button', class: 'btn primary', id: 'onboard-next-2' }, 'המשך')));
    const choose = h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'choose', checked: state.business.customers_choose_provider !== false }),
      `לקוחות בוחרים ${label}`);
    form.append(choose);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, '');
      const name = form.display_name.value.trim();
      if (name.length < 2 || name.length > 60 || /[<>]/.test(name)) {
        showErr(form, 'השם חייב להיות בין 2 ל-60 תווים, ללא < או >.'); return;
      }
      const btn = form.querySelector('#onboard-add-staff'); btn.disabled = true;
      try {
        const [row] = await q(sb.from('staff').insert({
          business_id: state.business.id, display_name: name, role: 'barber', is_active: true,
        }).select('*'));
        state.staff.push(row);
        form.display_name.value = '';
        refreshList();
        toast('נוסף');
      } catch (err) { showErr(form, heError(err)); }
      finally { btn.disabled = false; }
    });
    form.querySelector('#onboard-next-2').addEventListener('click', async () => {
      showErr(form, '');
      if (!state.staff.length) { showErr(form, `הוסיפו לפחות ${label} אחד.`); return; }
      const want = form.choose.checked;
      if (want !== (state.business.customers_choose_provider !== false)) {
        try {
          const [row] = await q(sb.from('businesses').update({ customers_choose_provider: want })
            .eq('id', state.business.id).select('*'));
          if (row) Object.assign(state.business, row);
        } catch (err) { showErr(form, heError(err)); return; }
      }
      await go(3);
    });
    return [form];
  }

  function step3(card) {
    const form = h('form', { id: 'onboard-form-3' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, '3. שעות עבודה'),
      h('p', { class: 'muted' }, 'תבנית מהירה: ימי חול 09:00–17:00, שישי 09:00–13:00, שבת סגור. אותן שעות לכל הצוות.'),
      errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', id: 'onboard-skip-hours' }, 'עריכה מתקדמת אחר כך'),
        h('button', { type: 'submit', class: 'btn primary', id: 'onboard-apply-hours' }, 'החלת התבנית')));
    const apply = async () => {
      showErr(form, '');
      const rows = [];
      for (const st of state.staff) {
        for (let d = 0; d <= 4; d++) rows.push({ staff_id: st.id, weekday: d, start_time: '09:00', end_time: '17:00' });
        rows.push({ staff_id: st.id, weekday: 5, start_time: '09:00', end_time: '13:00' });
      }
      try {
        if (rows.length) await q(sb.from('working_hours').insert(rows).select('id'));
        state.hoursApplied = true;
        toast('השעות נשמרו');
        await go(4);
      } catch (err) { showErr(form, heError(err)); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    form.querySelector('#onboard-skip-hours').addEventListener('click', () => go(4));
    return [form];
  }

  function step4(card) {
    const waitToggle = h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'has_wait', id: 'onboard-has-wait' }),
      'יש שלב המתנה באמצע (לא חוסם ביומן)');
    const waitFields = h('div', { class: 'row hidden', id: 'onboard-wait-fields' },
      h('label', {}, 'המתנה (דק׳)', h('input', { name: 'wait_min', type: 'number', min: '1', max: '180', value: '10' })),
      h('label', {}, 'עד (דק׳)', h('input', { name: 'wait_max', type: 'number', min: '1', max: '180', value: '20' })));
    waitToggle.querySelector('input').addEventListener('change', (e) => {
      waitFields.classList.toggle('hidden', !e.target.checked);
    });
    const form = h('form', { id: 'onboard-form-4' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, '4. שירות ראשון'),
      h('label', {}, 'שם השירות', h('input', { name: 'svc_name', required: true, maxlength: '80', placeholder: 'למשל: ייעוץ / תספורת / טיפול' })),
      h('div', { class: 'row' },
        h('label', {}, 'משך (דק׳)', h('input', { name: 'duration', type: 'number', required: true, min: '5', max: '480', value: '30' })),
        h('label', {}, 'מחיר (₪)', h('input', { name: 'price', type: 'number', required: true, min: '0', step: '1', value: '100' }))),
      waitToggle,
      waitFields,
      h('p', { class: 'muted' }, 'בזמן המתנה אפשר לשבץ שירות קצר אחר, אם תסמנו זאת אחר כך בהגדרות השירות.'),
      errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', id: 'onboard-skip-svc' }, 'דילוג'),
        h('button', { type: 'submit', class: 'btn primary' }, 'שמירת שירות')));
    form.querySelector('#onboard-skip-svc').addEventListener('click', () => go(5));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, '');
      const name = form.svc_name.value.trim();
      const duration = Number(form.duration.value);
      const price = Number(form.price.value);
      if (name.length < 2 || /[<>]/.test(name)) { showErr(form, 'שם שירות לא תקין.'); return; }
      if (!(duration >= 5 && duration <= 480)) { showErr(form, 'משך לא תקין.'); return; }
      if (!(price >= 0)) { showErr(form, 'מחיר לא תקין.'); return; }
      const hasWait = form.has_wait.checked;
      const waitMin = Number(form.wait_min.value) || 10;
      const waitMax = Number(form.wait_max.value) || waitMin;
      if (hasWait && (waitMin < 1 || waitMax < waitMin)) { showErr(form, 'טווח המתנה לא תקין.'); return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const [svc] = await q(sb.from('services').insert({
          business_id: state.business.id, name, base_price: price, is_active: true,
        }).select('*'));
        const steps = [{ service_id: svc.id, step_order: 1, name, duration_min: duration, is_blocking: true }];
        if (hasWait) {
          steps.push({
            service_id: svc.id, step_order: 2, name: 'המתנה', duration_min: waitMin,
            max_duration_min: waitMax, is_blocking: false, wait_duration_mode: 'min', allow_overlap: false,
          });
        }
        await q(sb.from('service_steps').insert(steps).select('id'));
        if (state.staff.length) {
          await q(sb.from('staff_services').insert(
            state.staff.map((st) => ({ staff_id: st.id, service_id: svc.id })),
          ).select('staff_id'));
        }
        state.service = svc;
        toast('השירות נשמר');
        await go(5);
      } catch (err) { showErr(form, heError(err)); }
      finally { btn.disabled = false; }
    });
    return [form];
  }

  async function step5(card) {
    const suggested = suggestSlug(state.business.name) || state.business.public_slug || '';
    const input = h('input', {
      name: 'slug', id: 'onboard-slug', value: suggested, dir: 'ltr', required: true,
      minlength: '3', maxlength: '40', pattern: '[a-z0-9][a-z0-9\\-]*[a-z0-9]',
      autocomplete: 'off', spellcheck: 'false',
    });
    const preview = h('p', { class: 'muted', id: 'onboard-slug-preview', dir: 'ltr' }, suggested ? bookingUrl(suggested) : '');
    const status = h('p', { class: 'muted', id: 'onboard-slug-status' });
    let checkTimer;
    const check = async () => {
      const slug = input.value.trim().toLowerCase();
      input.value = slug;
      preview.textContent = slug ? bookingUrl(slug) : '';
      const local = slugError(slug);
      if (local) { status.textContent = local; status.className = 'form-error'; return false; }
      try {
        const res = await rpc('owner_slug_available', { p_slug: slug });
        if (res === 'available') { status.textContent = 'פנוי'; status.className = 'muted ok'; return true; }
        if (res === 'taken') { status.textContent = 'הקישור הזה כבר תפוס.'; status.className = 'form-error'; return false; }
        status.textContent = 'קישור לא תקין.'; status.className = 'form-error'; return false;
      } catch (err) { status.textContent = heError(err); status.className = 'form-error'; return false; }
    };
    input.addEventListener('input', () => {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(check, 350);
    });
    const form = h('form', { id: 'onboard-form-5' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, '5. קישור הזמנה'),
      h('p', { class: 'muted' }, 'זה הקישור שתשלחו ללקוחות. שינוי מאוחר יותר ישבור קישורים ישנים.'),
      h('label', {}, 'מזהה הקישור', input),
      preview, status, errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', id: 'onboard-skip-slug' }, 'להשאיר אוטומטי'),
        h('button', { type: 'submit', class: 'btn primary' }, 'שמירת קישור')));
    // initial availability check
    setTimeout(check, 0);
    form.querySelector('#onboard-skip-slug').addEventListener('click', () => go(6));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, '');
      const okAvail = await check();
      if (!okAvail) return;
      const slug = input.value.trim().toLowerCase();
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const [row] = await q(sb.from('businesses').update({ public_slug: slug })
          .eq('id', state.business.id).select('*'));
        if (!row) throw new Error('permission denied');
        Object.assign(state.business, row);
        toast('הקישור נשמר');
        await go(6);
      } catch (err) { showErr(form, heError(err)); }
      finally { btn.disabled = false; }
    });
    return [form];
  }

  function step6(card) {
    const b = state.business;
    const href = b.public_slug ? bookingUrl(b.public_slug) : '';
    const wa = href
      ? `https://wa.me/?text=${encodeURIComponent(`שלום! לקביעת תור: ${href}`)}`
      : null;
    const box = h('div', { id: 'onboard-finish' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, '6. הכל מוכן'),
      h('ul', { class: 'onboard-summary' },
        h('li', {}, `עסק: ${b.name}`),
        h('li', {}, `צוות: ${state.staff.length}`),
        h('li', {}, state.service ? `שירות: ${state.service.name}` : 'שירות: יושלם בהמשך'),
        h('li', {}, href ? h('span', {}, 'קישור: ', h('a', { href, target: '_blank', rel: 'noopener', dir: 'ltr' }, href))
          : 'קישור: אוטומטי / להשלים בהגדרות')),
      errBox(),
      h('div', { class: 'actions' },
        wa ? h('a', { class: 'btn outline', href: wa, target: '_blank', rel: 'noopener', id: 'onboard-wa' }, 'שליחת הקישור בוואטסאפ') : null,
        h('button', { type: 'button', class: 'btn primary', id: 'onboard-to-calendar' }, 'לעבור ליומן')));
    box.querySelector('#onboard-to-calendar').addEventListener('click', async () => {
      try { await onDone?.(state.business); }
      catch (err) { showErr(box, heError(err)); }
    });
    return [box];
  }

  await paint();
}
