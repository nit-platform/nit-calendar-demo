// K5/K1/K2/K3/K4 onboarding: type → details(+solo) → service → share+preview.
// Templates are client-side defaults only (editable). Hours + solo staff applied in the background.
import { sb, q, rpc, heError } from './sb.js';
import { h, toast, providerLabel, DEFAULT_PROVIDER_LABEL } from '../../js/ui.js';
import { SLUG_RE, RESERVED, slugError, bookingUrl } from './bookinglink.js';

const NAME_MIN = 2, NAME_MAX = 80;
const TOTAL = 4;

/** Generic business-type templates (no «ספר» / «תספורת»). Hours: weekday 0=Sun … 5=Fri. */
const TEMPLATES = [
  {
    id: 'coach',
    title: 'ייעוץ ואימון',
    provider_label: 'מאמן',
    service: { name: 'פגישת ייעוץ', duration: 50, price: 200 },
    hours: { weekdays: { start: '09:00', end: '18:00' }, friday: null },
  },
  {
    id: 'care',
    title: 'טיפול ובריאות',
    provider_label: 'מטפל/ת',
    service: { name: 'טיפול', duration: 45, price: 250 },
    hours: { weekdays: { start: '09:00', end: '17:00' }, friday: null },
  },
  {
    id: 'beauty',
    title: 'יופי וטיפוח',
    provider_label: 'נותן/ת שירות',
    service: { name: 'תור רגיל', duration: 30, price: 120 },
    hours: { weekdays: { start: '09:00', end: '19:00' }, friday: { start: '09:00', end: '14:00' } },
  },
  {
    id: 'edu',
    title: 'חינוך וחוגים',
    provider_label: 'מדריך/ה',
    service: { name: 'שיעור', duration: 60, price: 150 },
    hours: { weekdays: { start: '14:00', end: '20:00' }, friday: null },
  },
  {
    id: 'general',
    title: 'אחר / כללי',
    provider_label: DEFAULT_PROVIDER_LABEL,
    service: { name: 'פגישה', duration: 30, price: 100 },
    hours: { weekdays: { start: '09:00', end: '17:00' }, friday: { start: '09:00', end: '13:00' } },
  },
];

const LABEL_OPTIONS = [
  'נותן שירות', 'מאמן', 'יועץ', 'מטפל/ת', 'מדריך/ה', 'נותן/ת שירות', 'אחר…',
];

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

function nameFromUser(user, businessName) {
  const md = user?.user_metadata || {};
  const n = (md.full_name || md.name || '').trim();
  if (n.length >= 2 && n.length <= 60 && !/[<>]/.test(n)) return n;
  const bn = String(businessName || '').trim();
  if (bn.length >= 2) return bn.slice(0, 60);
  return 'אני';
}

function hoursLabel(tpl) {
  if (!tpl?.hours) return '';
  const w = tpl.hours.weekdays;
  let s = `א׳–ה׳ ${w.start}–${w.end}`;
  if (tpl.hours.friday) s += `, ו׳ ${tpl.hours.friday.start}–${tpl.hours.friday.end}`;
  return s;
}

async function applyTemplateHours(staff, hours) {
  if (!staff?.length || !hours?.weekdays) return;
  const rows = [];
  for (const st of staff) {
    for (let d = 0; d <= 4; d++) {
      rows.push({
        staff_id: st.id, weekday: d,
        start_time: hours.weekdays.start, end_time: hours.weekdays.end,
      });
    }
    if (hours.friday) {
      rows.push({
        staff_id: st.id, weekday: 5,
        start_time: hours.friday.start, end_time: hours.friday.end,
      });
    }
  }
  if (rows.length) await q(sb.from('working_hours').insert(rows).select('id'));
}

/** @param {(biz: object) => void|Promise<void>} onDone @param {() => void} onCancel */
export async function renderOnboard(root, { user, onDone, onCancel }) {
  const state = {
    step: 1,
    templateId: null,
    template: null,
    business: null,
    staff: [],
    service: null,
    hoursApplied: false,
    solo: true,
  };

  const go = async (n) => { state.step = n; await paint(); };
  async function paint() {
    root.replaceChildren(await stepView());
  }

  function progressBar() {
    const left = ['', 'עוד ~3 דק׳', 'עוד ~2 דק׳', 'עוד ~1 דק׳', 'מוכן!'][state.step] || '';
    const names = ['', 'סוג', 'פרטים', 'שירות', 'שיתוף'];
    const pct = Math.round((state.step / TOTAL) * 100);
    return h('div', { class: 'onboard-progress-wrap', 'aria-label': `שלב ${state.step} מתוך ${TOTAL}` },
      h('div', { class: 'onboard-progress-meta' },
        h('span', {}, `שלב ${state.step}/${TOTAL} · ${names[state.step] || ''}`),
        h('span', { class: 'muted' }, left)),
      h('div', { class: 'onboard-progress-track', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('div', { class: 'onboard-progress-fill', style: `width:${pct}%` })),
      h('div', { class: 'onboard-progress' },
        ...[1, 2, 3, 4].map((i) => h('span', {
          class: i === state.step ? 'on' : (i < state.step ? 'done' : ''),
          title: names[i],
        }, i < state.step ? '✓' : String(i)))));
  }

  async function stepView() {
    const card = h('div', { class: 'card onboard-card', id: `onboard-step-${state.step}` });
    if (state.step === 1) card.append(...stepType(card));
    else if (state.step === 2) card.append(...stepDetails(card));
    else if (state.step === 3) card.append(...stepService(card));
    else card.append(...await stepShare(card));
    return h('div', { class: 'onboard', id: 'view-onboard-inner' },
      h('div', { class: 'onboard-top' },
        h('h2', {}, 'הקמת העסק'),
        h('button', { type: 'button', class: 'btn link onboard-exit', onclick: () => onCancel?.() },
          state.business ? 'המשך אחר כך' : 'ביטול')),
      progressBar(),
      card);
  }

  // ---------- 1/4 type (K2) ----------
  function stepType(card) {
    const grid = h('div', { class: 'onboard-types', role: 'listbox', 'aria-label': 'סוג עסק' });
    const next = h('button', { type: 'button', class: 'btn primary', id: 'onboard-next-type', disabled: true }, 'המשך');
    const pick = (tpl) => {
      state.templateId = tpl.id;
      state.template = tpl;
      for (const b of grid.querySelectorAll('.onboard-type')) {
        b.classList.toggle('selected', b.dataset.id === tpl.id);
        b.setAttribute('aria-selected', b.dataset.id === tpl.id ? 'true' : 'false');
      }
      next.disabled = false;
    };
    for (const tpl of TEMPLATES) {
      const btn = h('button', {
        type: 'button', class: 'onboard-type', role: 'option', 'data-id': tpl.id,
        'aria-selected': 'false',
        onclick: () => pick(tpl),
      }, h('strong', {}, tpl.title), h('span', { class: 'muted' }, tpl.service.name));
      grid.append(btn);
    }
    next.addEventListener('click', () => {
      if (!state.template) return;
      go(2);
    });
    return [
      h('h3', { class: 'sub', style: 'margin-top:0' }, 'מה מתאר את העסק שלכם?'),
      h('p', { class: 'muted' }, 'אפשר לשנות הכל אחר כך'),
      grid,
      errBox(),
      h('div', { class: 'actions' }, next),
    ];
  }

  // ---------- 2/4 details + רק אני (K1) ----------
  function stepDetails(card) {
    const tpl = state.template || TEMPLATES.find((t) => t.id === 'general');
    const other = h('input', {
      name: 'provider_other', maxlength: '30', placeholder: 'כינוי חופשי',
      class: 'hidden', autocomplete: 'off',
    });
    const sel = h('select', { name: 'provider_preset', id: 'onboard-provider' },
      ...LABEL_OPTIONS.map((p) => h('option', { value: p }, p)));
    const wantLabel = tpl.provider_label === DEFAULT_PROVIDER_LABEL ? 'נותן שירות' : tpl.provider_label;
    if ([...sel.options].some((o) => o.value === wantLabel)) sel.value = wantLabel;
    else { sel.value = 'אחר…'; other.classList.remove('hidden'); other.value = tpl.provider_label; }
    sel.addEventListener('change', () => {
      const isOther = sel.value === 'אחר…';
      other.classList.toggle('hidden', !isOther);
      if (isOther) other.focus();
    });

    const soloRadio = h('label', { class: 'onboard-radio' },
      h('input', { type: 'radio', name: 'who', value: 'solo', checked: state.solo }),
      h('span', {}, h('b', {}, 'רק אני'), h('small', { class: 'muted' }, ' ניצור אתכם אוטומטית')));
    const teamRadio = h('label', { class: 'onboard-radio' },
      h('input', { type: 'radio', name: 'who', value: 'team', checked: !state.solo }),
      h('span', {}, h('b', {}, 'יש לי צוות'), h('small', { class: 'muted' }, ' — אוסיף שמות')));

    const teamBox = h('div', { class: state.solo ? 'hidden' : '', id: 'onboard-team-box' },
      h('label', {}, 'שם נותן שירות ראשון',
        h('input', {
          name: 'display_name', maxlength: '60', autocomplete: 'off',
          placeholder: 'שם', id: 'onboard-team-name',
        })));

    const form = h('form', { id: 'onboard-form-1', novalidate: '' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, 'פרטי העסק'),
      h('label', {}, 'שם העסק',
        h('input', {
          name: 'name', required: true, maxlength: String(NAME_MAX),
          autocomplete: 'organization', placeholder: 'למשל: הסטודיו של נועה',
        })),
      h('label', {}, 'איך לקרוא לנותן השירות בדף ההזמנה?', sel, other),
      h('label', {}, 'וואטסאפ (אופציונלי)',
        h('input', {
          name: 'phone', dir: 'ltr', maxlength: '40', inputmode: 'tel',
          autocomplete: 'tel', placeholder: '+972…',
        })),
      h('p', { class: 'muted' }, 'אזור זמן: Asia/Jerusalem'),
      h('fieldset', { class: 'onboard-who' },
        h('legend', {}, 'מי מקבל תורים?'), soloRadio, teamRadio, teamBox),
      errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', id: 'onboard-back-1', onclick: () => go(1) }, 'חזרה'),
        h('button', { type: 'submit', class: 'btn primary', id: 'onboard-next-1' }, 'המשיכו — שמירת עסק')));

    form.querySelectorAll('input[name=who]').forEach((r) => {
      r.addEventListener('change', () => {
        state.solo = form.who.value === 'solo';
        teamBox.classList.toggle('hidden', state.solo);
      });
    });

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
      if (label === DEFAULT_PROVIDER_LABEL) label = null;

      state.solo = form.who.value === 'solo';
      let teamName = null;
      if (!state.solo) {
        teamName = form.display_name.value.trim();
        if (teamName.length < 2 || teamName.length > 60 || /[<>]/.test(teamName)) {
          showErr(form, 'השם חייב להיות בין 2 ל-60 תווים, ללא < או >.');
          form.display_name.focus(); return;
        }
      }

      const phone = form.phone.value.trim() || null;
      const choose = !state.solo; // solo → customers don't choose; team → choose by default
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const row = await rpc('owner_create_business', {
          p_name: name,
          p_provider_label: label,
          p_phone_whatsapp: phone,
          p_customers_choose_provider: choose,
          p_public_slug: null,
        });
        state.business = row;

        const staffName = state.solo ? nameFromUser(user, name) : teamName;
        const [st] = await q(sb.from('staff').insert({
          business_id: row.id, display_name: staffName, role: 'provider', is_active: true,
        }).select('*'));
        state.staff = [st];

        await applyTemplateHours(state.staff, tpl.hours);
        state.hoursApplied = true;

        toast('העסק נוצר — אפשר להמשיך או לחזור אחר כך');
        await go(3);
      } catch (err) {
        showErr(form, heError(err));
      } finally { btn.disabled = false; }
    });
    return [form];
  }

  // ---------- 3/4 service ----------
  function stepService(card) {
    const tpl = state.template || TEMPLATES.find((t) => t.id === 'general');
    const svc = tpl.service;
    const advanced = h('div', { class: 'onboard-advanced hidden', id: 'onboard-advanced' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'has_wait', id: 'onboard-has-wait' }),
        'יש שלב המתנה באמצע (לא חוסם ביומן)'),
      h('div', { class: 'row hidden', id: 'onboard-wait-fields' },
        h('label', {}, 'המתנה (דק׳)', h('input', { name: 'wait_min', type: 'number', min: '1', max: '180', value: '10' })),
        h('label', {}, 'עד (דק׳)', h('input', { name: 'wait_max', type: 'number', min: '1', max: '180', value: '20' }))));
    advanced.querySelector('#onboard-has-wait').addEventListener('change', (e) => {
      advanced.querySelector('#onboard-wait-fields').classList.toggle('hidden', !e.target.checked);
    });

    const form = h('form', { id: 'onboard-form-4', novalidate: '' },
      h('h3', { class: 'sub', style: 'margin-top:0' }, 'השירות הראשון שיופיע ללקוחות'),
      h('label', {}, 'שם',
        h('input', {
          name: 'svc_name', required: true, maxlength: '80',
          value: svc.name, placeholder: 'ייעוץ / טיפול / פגישה',
        })),
      h('div', { class: 'row' },
        h('label', {}, 'משך (דק׳)',
          h('input', { name: 'duration', type: 'number', required: true, min: '5', max: '480', value: String(svc.duration) })),
        h('label', {}, 'מחיר (₪)',
          h('input', { name: 'price', type: 'number', required: true, min: '0', step: '1', value: String(svc.price) }))),
      h('p', { class: 'muted' }, `שעות: ${hoursLabel(tpl)} (מהתבנית)`),
      h('button', {
        type: 'button', class: 'btn link', id: 'onboard-toggle-advanced',
        onclick: () => advanced.classList.toggle('hidden'),
      }, '▸ אפשרויות מתקדמות'),
      advanced,
      errBox(),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', id: 'onboard-skip-svc' }, 'דילוג'),
        h('button', { type: 'submit', class: 'btn primary' }, 'שמירה והמשך')));

    form.querySelector('#onboard-skip-svc').addEventListener('click', () => go(4));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, '');
      const name = form.svc_name.value.trim();
      const duration = Number(form.duration.value);
      const price = Number(form.price.value);
      if (name.length < 2 || /[<>]/.test(name)) { showErr(form, 'שם שירות לא תקין.'); return; }
      if (!(duration >= 5 && duration <= 480)) { showErr(form, 'משך לא תקין.'); return; }
      if (!(price >= 0)) { showErr(form, 'מחיר לא תקין.'); return; }
      const hasWait = form.has_wait?.checked;
      const waitMin = Number(form.wait_min?.value) || 10;
      const waitMax = Number(form.wait_max?.value) || waitMin;
      if (hasWait && (waitMin < 1 || waitMax < waitMin)) { showErr(form, 'טווח המתנה לא תקין.'); return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const [svcRow] = await q(sb.from('services').insert({
          business_id: state.business.id, name, base_price: price, is_active: true,
        }).select('*'));
        const steps = [{
          service_id: svcRow.id, step_order: 1, name, duration_min: duration,
          max_duration_min: null, is_blocking: true, wait_duration_mode: null, allow_overlap: false,
        }];
        if (hasWait) {
          steps.push({
            service_id: svcRow.id, step_order: 2, name: 'המתנה', duration_min: waitMin,
            max_duration_min: waitMax, is_blocking: false, wait_duration_mode: 'min',
            allow_overlap: true,
          });
        }
        await q(sb.from('service_steps').insert(steps).select('id'));
        if (state.staff.length) {
          await q(sb.from('staff_services').insert(
            state.staff.map((st) => ({ staff_id: st.id, service_id: svcRow.id })),
          ).select('staff_id'));
        }
        state.service = svcRow;
        toast('השירות נשמר');
        await go(4);
      } catch (err) { showErr(form, heError(err)); }
      finally { btn.disabled = false; }
    });
    return [form];
  }

  // ---------- 4/4 share (K3 + K4 climax) ----------
  async function stepShare(card) {
    const b = state.business;
    let liveSlug = (b.public_slug || '').toLowerCase();
    const latinSuggested = suggestSlug(b.name);
    const activeSlug = liveSlug || latinSuggested || '';
    let href = activeSlug ? bookingUrl(activeSlug) : '';

    const sameOriginPreview = (url) => {
      try { return !!url && new URL(url).origin === location.origin; }
      catch { return false; }
    };

    const linkEl = h('a', {
      href: href || '#', target: '_blank', rel: 'noopener', dir: 'ltr',
      id: 'onboard-share-link', class: 'onboard-share-url',
      'aria-label': 'קישור ההזמנה ללקוחות',
    }, href || 'הקישור יופיע אחרי שמירת מזהה');

    const copyBtn = h('button', {
      type: 'button', class: 'btn primary', id: 'onboard-copy-link',
    }, 'העתקת קישור');

    const waBtn = h('a', {
      class: 'btn outline' + (href ? '' : ' hidden'),
      href: href
        ? `https://wa.me/?text=${encodeURIComponent(`שלום! לקביעת תור אצל ${b.name}: ${href}`)}`
        : '#',
      target: '_blank', rel: 'noopener', id: 'onboard-wa',
    }, 'וואטסאפ');

    const openFull = h('a', {
      class: 'btn link' + (href ? '' : ' hidden'),
      href: href || '#', target: '_blank', rel: 'noopener', id: 'onboard-preview-open',
    }, 'פתיחה בחלון מלא');

    const frame = h('iframe', {
      id: 'onboard-preview-frame',
      class: 'onboard-preview-frame',
      title: 'תצוגה מקדימה של דף ההזמנה',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
    });
    const frameWrap = h('div', {
      class: 'onboard-preview-frame-wrap' + (href && sameOriginPreview(href) ? '' : ' hidden'),
      id: 'onboard-preview-frame-wrap',
    }, frame);
    if (href && sameOriginPreview(href)) frame.src = href;

    const syncShareTargets = (url) => {
      href = url || '';
      linkEl.href = url || '#';
      linkEl.textContent = url || 'הקישור יופיע אחרי שמירת מזהה';
      if (url) {
        waBtn.href = `https://wa.me/?text=${encodeURIComponent(`שלום! לקביעת תור אצל ${b.name}: ${url}`)}`;
        waBtn.classList.remove('hidden');
        openFull.href = url;
        openFull.classList.remove('hidden');
      } else {
        waBtn.classList.add('hidden');
        openFull.classList.add('hidden');
      }
      if (url && sameOriginPreview(url)) {
        frame.src = url;
        frameWrap.classList.remove('hidden');
      } else {
        frame.removeAttribute('src');
        frameWrap.classList.add('hidden');
      }
    };

    copyBtn.addEventListener('click', async () => {
      const url = linkEl.getAttribute('href');
      if (!url || url === '#') { toast('אין עדיין קישור', true); return; }
      try {
        await navigator.clipboard.writeText(url);
        toast('הקישור הועתק — שלחו ללקוח');
        copyBtn.classList.add('onboard-copied');
        setTimeout(() => copyBtn.classList.remove('onboard-copied'), 1200);
      } catch { toast('לא ניתן להעתיק', true); }
    });

    // K4: static card + optional sandboxed iframe (same origin / Pages)
    const preview = h('div', { class: 'onboard-preview', id: 'onboard-preview' },
      h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'כך זה נראה ללקוח'),
      h('div', { class: 'onboard-preview-card' },
        h('strong', {}, b.name),
        h('span', { class: 'muted' }, `בחרו ${providerLabel(b)} · שירות`),
        h('span', { class: 'btn small primary', style: 'pointer-events:none' }, 'קביעת תור')),
      frameWrap,
      openFull);

    const input = h('input', {
      name: 'slug', id: 'onboard-slug',
      value: latinSuggested || liveSlug || '',
      dir: 'ltr', minlength: '3', maxlength: '40',
      pattern: '[a-z0-9][a-z0-9\\-]*[a-z0-9]',
      autocomplete: 'off', spellcheck: 'false',
      'aria-describedby': 'onboard-slug-status',
    });
    const status = h('p', { class: 'muted', id: 'onboard-slug-status' });
    const softHint = h('p', { class: 'muted', id: 'onboard-slug-hint' },
      latinSuggested
        ? 'אפשר לשמור מזהה קריא מהשם, או להשאיר את האוטומטי.'
        : 'נשמור קישור קצר אוטומטי; אפשר לשנות כאן או בהגדרות.');

    let checkTimer;
    const check = async () => {
      const slug = input.value.trim().toLowerCase();
      input.value = slug;
      if (!slug) {
        status.textContent = softHint.textContent;
        status.className = 'muted';
        return false;
      }
      const local = slugError(slug);
      if (local) { status.textContent = local; status.className = 'form-error'; return false; }
      if (liveSlug && slug === liveSlug) {
        status.textContent = 'פנוי · זה הקישור הפעיל';
        status.className = 'muted ok';
        return true;
      }
      try {
        const res = await rpc('owner_slug_available', { p_slug: slug, p_business_id: b.id });
        if (res === 'available') {
          status.textContent = 'פנוי · שינוי ישבור קישורים ישנים';
          status.className = 'muted ok';
          return true;
        }
        if (res === 'taken') {
          status.textContent = 'הקישור הזה כבר תפוס.';
          status.className = 'form-error';
          return false;
        }
        status.textContent = 'קישור לא תקין.';
        status.className = 'form-error';
        return false;
      } catch (err) {
        status.textContent = heError(err);
        status.className = 'form-error';
        return false;
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => { check(); }, 350);
    });
    setTimeout(check, 0);

    const saveSlug = h('button', {
      type: 'button', class: 'btn ghost', id: 'onboard-save-slug',
    }, 'שמירת מזהה');
    saveSlug.addEventListener('click', async () => {
      showErr(card, '');
      const slug = input.value.trim().toLowerCase();
      if (liveSlug && slug === liveSlug) { toast('הקישור כבר פעיל'); return; }
      if (!(await check())) return;
      saveSlug.disabled = true;
      try {
        const [row] = await q(sb.from('businesses').update({ public_slug: slug })
          .eq('id', b.id).select('*'));
        if (!row) throw new Error('permission denied');
        Object.assign(state.business, row);
        liveSlug = (row.public_slug || '').toLowerCase();
        syncShareTargets(bookingUrl(liveSlug));
        toast('הקישור נשמר');
        await check();
      } catch (err) { showErr(card, heError(err)); }
      finally { saveSlug.disabled = false; }
    });

    const skipSlug = h('button', {
      type: 'button', class: 'btn ghost', id: 'onboard-skip-slug',
    }, 'להשאיר אוטומטי');
    skipSlug.addEventListener('click', () => {
      if (liveSlug) {
        input.value = liveSlug;
        syncShareTargets(bookingUrl(liveSlug));
        check();
      }
      toast('נשאר הקישור האוטומטי');
    });

    // Secondary CTA — calendar (emotional primary is copy)
    const toCal = h('button', {
      type: 'button', class: 'btn', id: 'onboard-to-calendar',
    }, 'מעבר ליומן הניהול');

    const box = h('div', { id: 'onboard-finish', class: 'onboard-finish onboard-ready' },
      h('h3', { class: 'sub onboard-ready-title', style: 'margin-top:0' }, '✓ העסק מוכן לקבל תורים'),
      h('p', { class: 'onboard-share-label' }, 'הקישור שלכם'),
      linkEl,
      h('div', { class: 'actions onboard-share-actions' }, copyBtn, waBtn),
      preview,
      h('div', { class: 'onboard-slug-panel', id: 'onboard-form-5' },
        h('p', { class: 'onboard-slug-title' }, 'מזהה הקישור (אופציונלי)'),
        softHint,
        h('label', {}, 'מזהה', input),
        status,
        h('div', { class: 'actions' }, skipSlug, saveSlug)),
      errBox(),
      h('div', { class: 'actions' }, toCal));

    toCal.addEventListener('click', async () => {
      try { await onDone?.(state.business); }
      catch (err) { showErr(box, heError(err)); }
    });
    return [box];
  }


  await paint();
}
