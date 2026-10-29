// Customer manage page (?b=<slug>&manage=<token>): view / cancel / reschedule via manage-token RPCs.
// Token stays in the URL/localStorage only; never sent elsewhere. Hebrew UI.
import { api, friendlyError } from './api.js';
import { $, h, muted, toast, shekel } from './ui.js';
import { fmtTime, fmtLongDate, dayOfTs, todayISO, addDays } from './time.js';
import { DAYS_AHEAD } from './config.js';

function askCancelConfirm() {
  const dlg = $('#mg-confirm');
  if (!dlg || typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm('לבטל את התור?'));
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

const STATUS = {
  pending: 'ממתין לאישור העסק',
  confirmed: 'מאושר',
  cancelled: 'בוטל',
  completed: 'הושלם',
  no_show: 'לא הגיע',
};

function manageUrl(slug, token) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  // Prefer query form so GitHub Pages static hosting keeps the token.
  u.searchParams.set('b', slug);
  u.searchParams.set('manage', token);
  return u.pathname + u.search;
}

export function saveManageLink(slug, token) {
  if (!slug || !token) return;
  try {
    const key = 'nit_manage:' + slug;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const next = [{ token, at: Date.now() }, ...list.filter((x) => x.token !== token)].slice(0, 5);
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function bookingManageLink(slug, token) {
  return manageUrl(slug, token);
}

export async function renderManage(slug, token, box) {
  box.replaceChildren(muted('טוען…'));
  let info;
  try { info = await api.appointmentGet(slug, token); }
  catch (e) { box.replaceChildren(muted(friendlyError(e))); return; }
  if (!info || !info.appointment_id) { box.replaceChildren(muted('הקישור לניהול התור לא תקין או שפג תוקפו.')); return; }

  const paint = (data) => {
    const kids = [
      h('h2', {}, 'ניהול התור'),
      data.status === 'pending'
        ? h('p', { class: 'badge' }, 'ממתין לאישור העסק — השעה שמורה עד לאישור או עד מועד התור')
        : null,
      h('div', { class: 'summary' },
        h('div', {}, h('b', {}, data.service_name || 'שירות'),
          data.staff_name ? [' אצל ', h('b', {}, data.staff_name)] : null),
        h('div', {}, fmtLongDate(dayOfTs(data.starts_at)), ', ',
          h('bdi', { dir: 'ltr' }, `${fmtTime(data.starts_at)}–${fmtTime(data.ends_at)}`)),
        data.price != null ? h('div', {}, `מחיר: ${shekel(data.price)}`) : null,
        h('div', {}, 'סטטוס: ', STATUS[data.status] || data.status)),
    ];
    const actions = [];
    if (data.can_cancel) {
      actions.push(h('button', { type: 'button', class: 'btn danger', id: 'mg-cancel' }, 'ביטול התור'));
    }
    if (data.can_reschedule) {
      actions.push(h('button', { type: 'button', class: 'btn', id: 'mg-resched' }, 'שינוי מועד'));
    }
    if (actions.length) kids.push(h('div', { class: 'actions' }, ...actions));
    kids.push(h('div', { id: 'mg-resched-panel', class: 'hidden' }));
    box.replaceChildren(...kids.filter(Boolean));

    const cancelBtn = $('#mg-cancel');
    if (cancelBtn) cancelBtn.onclick = async () => {
      if (!(await askCancelConfirm())) return;
      cancelBtn.disabled = true;
      try {
        await api.appointmentCancel(slug, token);
        toast('התור בוטל');
        await renderManage(slug, token, box);
      } catch (e) { toast(friendlyError(e), true); cancelBtn.disabled = false; }
    };

    const reschedBtn = $('#mg-resched');
    if (reschedBtn) reschedBtn.onclick = () => openReschedule(slug, token, data, $('#mg-resched-panel'), () => renderManage(slug, token, box));
  };
  paint(info);
}

async function openReschedule(slug, token, data, panel, done) {
  panel.classList.remove('hidden');
  panel.replaceChildren(muted('טוען שעות…'));
  const date = todayISO();
  const choose = data.customers_choose_provider !== false;
  const staffId = choose ? data.staff_id : null;
  const scope = { kind: 'biz', slug, staffId };
  try {
    if (!data.service_id) { panel.replaceChildren(muted('לא נמצא שירות לשינוי מועד.')); return; }
    const pickDate = h('input', { type: 'date', id: 'mg-date', value: date, min: date, max: addDays(date, DAYS_AHEAD) });
    const slotsBox = h('div', { id: 'mg-slots' });
    const load = async () => {
      slotsBox.replaceChildren(muted('טוען…'));
      try {
        const rows = await api.slotGrid(scope, data.service_id, pickDate.value);
        const free = rows.filter((r) => r.available);
        if (!free.length) { slotsBox.replaceChildren(muted('אין שעות פנויות ביום זה')); return; }
        slotsBox.replaceChildren(h('div', { class: 'slot-grid' }, free.map((r) =>
          h('button', { type: 'button', class: 'slot', onclick: async () => {
            try {
              const res = await api.appointmentReschedule(slug, token, {
                staffId, serviceId: data.service_id, startsAt: r.slot_start,
              });
              if (res?.manage_token) {
                saveManageLink(slug, res.manage_token);
                history.replaceState(null, '', manageUrl(slug, res.manage_token));
              }
              toast('המועד עודכן ✔'); done();
            } catch (e) { toast(friendlyError(e), true); }
          } }, fmtTime(r.slot_start)))));
      } catch (e) { slotsBox.replaceChildren(muted(friendlyError(e))); }
    };
    pickDate.onchange = load;
    panel.replaceChildren(h('h3', {}, 'בחרו מועד חדש'), pickDate, slotsBox);
    await load();
  } catch (e) { panel.replaceChildren(muted(friendlyError(e))); }
}
