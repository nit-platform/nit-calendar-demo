// App entry. The URL slug (?b=<slug>, /b/<slug> or #/b/<slug>) is resolved as:
//   1. a business booking link (public_business) -> that business only, with a provider picker
//      (or no picker when the owner turned off customers_choose_provider: a free provider is auto-assigned);
//   2. otherwise a legacy per-provider demo link (demo_barber, e.g. /b/avi);
//   3. no slug at all -> the demo business (DEFAULT_BUSINESS_SLUG).
// Every value from the server is inserted as text (textContent / text nodes), never as HTML.
import { api, friendlyError } from './api.js';
import { $, h, muted, providerLabel, toast } from './ui.js';
import { fmtWhen } from './time.js';
import { getSlug, slugAttempt, canonicalize, hasAuthCallback } from './router.js';
import { initBooking, selectStaff, selection } from './booking.js';
import { initWaitlist, startInboxPolling, renderOffer } from './waitlist.js';
import { renderManage } from './manage.js';
import { DEFAULT_BUSINESS_SLUG } from './config.js';
import * as auth from './auth.js';
import { maybeShowWelcome, hideWelcome } from './welcome.js';

// Customer page: free/busy only. The full day calendar is for the business owner (owner_day_view, authenticated).
function show(name) { for (const id of ['view-book', 'view-missing', 'view-offer', 'view-manage']) $('#' + id).classList.toggle('hidden', id !== 'view-' + name); }

function customerDisplayName(session) {
  const u = session?.user;
  if (!u) return '';
  const md = u.user_metadata || {};
  return (md.full_name || md.name || u.email || 'מחובר').trim();
}


/** Reload «התורים שלי» for the signed-in customer (after book / cancel). */
export async function refreshMyAppts(slug) {
  const myStep = $('#my-appts-step');
  const box = $('#my-appts');
  if (!myStep || !box || !slug) return;
  if (!auth.googleSignInEnabled()) return;
  const session = await auth.getCustomerSession();
  if (!session) return;
  myStep.classList.remove('hidden');
  try {
    const list = await api.myAppointments(slug);
    if (!list.length) {
      box.replaceChildren(muted('אין תורים קרובים לעסק הזה.'));
      return;
    }
    box.replaceChildren(...list.map((a) => {
      const kids = [
        h('span', {}, `${a.service_name || 'תור'} · ${a.status}`),
        h('span', { class: 'muted', dir: 'ltr' }, fmtWhen(a.starts_at)),
      ];
      if (a.can_cancel && a.appointment_id) {
        kids.push(h('button', {
          type: 'button', class: 'btn small danger my-appt-cancel',
          'data-appt': a.appointment_id,
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            if (!confirm('לבטל את התור?')) return;
            btn.disabled = true;
            try {
              await api.cancelMyAppointment(slug, a.appointment_id);
              toast('התור בוטל');
              await refreshMyAppts(slug);
              // Slots may free up for waitlist / rebook.
              try {
                const { loadSlots } = await import('./booking.js');
                if (typeof loadSlots === 'function') loadSlots();
              } catch { /* optional */ }
            } catch (e) {
              toast(friendlyError(e), true);
              btn.disabled = false;
            }
          },
        }, 'ביטול'));
      }
      return h('div', { class: 'item', 'data-appt': a.appointment_id || '' }, ...kids);
    }));
  } catch {
    box.replaceChildren(muted('לא ניתן לטעון תורים כרגע.'));
  }
}

let _authSlug = null;
async function refreshAuthBar(slug) {
  _authSlug = slug;
  const bar = $('#auth-bar');
  if (!auth.googleSignInEnabled() || !bar) return;
  bar.classList.remove('hidden');
  const session = await auth.getCustomerSession();
  const btnIn = $('#auth-google'), btnOut = $('#auth-signout'), user = $('#auth-user');
  const status = $('#auth-status');
  const note = $('#book-auth-note');
  const myStep = $('#my-appts-step');
  if (session) {
    const name = customerDisplayName(session);
    btnIn.classList.add('hidden');
    btnOut.classList.remove('hidden');
    user.classList.remove('hidden');
    user.textContent = name;
    if (status) { status.textContent = 'מחובר'; status.classList.remove('hidden'); }
    if (note) note.classList.remove('hidden');
    if (myStep && slug) await refreshMyAppts(slug);
  } else {
    btnIn.classList.remove('hidden');
    btnOut.classList.add('hidden');
    user.classList.add('hidden');
    user.textContent = '';
    if (status) { status.textContent = 'לא מחובר'; status.classList.remove('hidden'); }
    if (note) note.classList.add('hidden');
    // B6: keep «התורים שלי» visible signed-out with a CTA into existing Google sign-in
    if (myStep && slug) {
      myStep.classList.remove('hidden');
      const box = $('#my-appts');
      box.replaceChildren(h('button', {
        type: 'button', class: 'btn google', id: 'my-appts-signin',
        onclick: async () => {
          try { await auth.signInWithGoogle(); }
          catch (e) { toast(friendlyError(e), true); }
        },
      }, 'התחברו כדי לראות את התורים שלכם'));
    } else if (myStep) {
      myStep.classList.add('hidden');
    }
  }
}

function wireAuthBar() {
  const bar = $('#auth-bar');
  if (!auth.googleSignInEnabled()) {
    if (bar) bar.classList.add('hidden');
    return;
  }
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = '1';
  const startGoogle = async () => {
    try { await auth.signInWithGoogle(); }
    catch (e) { toast(friendlyError(e), true); }
  };
  $('#auth-google').addEventListener('click', startGoogle);
  $('#auth-signout').addEventListener('click', async () => {
    await auth.signOutCustomer();
    await refreshAuthBar(_authSlug);
  });
  auth.onAuthChange(() => {
    // After PKCE exchange supabase strips ?code=; then restore pretty /b/<slug>.
    if (_authSlug && !hasAuthCallback()) canonicalize(_authSlug);
    refreshAuthBar(_authSlug);
  });
}


function notFound() {
  show('missing');
  const h = document.querySelector('#view-missing h2');
  if (h) h.textContent = 'העסק לא נמצא';
  document.title = 'NIT – העסק לא נמצא';
}
const isNotFound = (e) => /business not found|barber not found/.test(e?.message || '');

function setTitle(main, biz) {
  const el = $('#business-title') || $('#barber-title');
  el.replaceChildren(main, Object.assign(document.createElement('span'), { textContent: 'קביעת תור' }));
  $('#biz-name').textContent = biz;
}

async function startBusiness(slug, biz, explicit) {
  const qs = new URLSearchParams(location.search);
  const offer = qs.get('offer');
  const manage = qs.get('manage');
  if (offer !== null) {          // ?b=<slug>&offer=<token>: the offer page only (token never leaves the URL/server call)
    setTitle(biz.business_name, ''); document.title = `${biz.business_name} – הצעה מרשימת המתנה`;
    show('offer'); hideWelcome();
    await renderOffer(slug, offer.toLowerCase(), $('#offer-box'));
    $('#offer-back').href = location.pathname + '?b=' + encodeURIComponent(slug);
    return;
  }
  if (manage !== null) {         // ?b=<slug>&manage=<token>: Hebrew manage page (view/cancel/reschedule)
    setTitle(biz.business_name, ''); document.title = `${biz.business_name} – ניהול תור`;
    show('manage'); hideWelcome();
    await renderManage(slug, manage, $('#manage-box'));
    $('#manage-back').href = location.pathname + '?b=' + encodeURIComponent(slug);
    return;
  }
  // Settle OAuth return before painting auth status (wait for session / toast errors).
  await auth.settleAuthReturn().catch(() => null);
  if (explicit) canonicalize(slug);
  wireAuthBar();
  await refreshAuthBar(slug).catch(() => {});
  if (biz.waitlist_enabled !== false) initWaitlist(slug, selection);
  startInboxPolling(slug);
  setTitle(biz.business_name, '');
  document.title = `${biz.business_name} – קביעת תור`;
  maybeShowWelcome(slug, biz.business_name).catch(() => {});
  const staff = Array.isArray(biz.staff) ? biz.staff : [];
  const asBarber = (s) => ({ display_name: s.display_name, business_name: biz.business_name, provider_label: biz.provider_label });
  const step = $('#staff-step'), list = $('#staff-list');
  if (biz.customers_choose_provider === false) {
    // The business assigns a free provider itself: no names on the page, staffId null.
    step.classList.add('hidden');
    show('book');
    return initBooking({ scope: { kind: 'biz', slug, staffId: null },
                         barber: { display_name: null, business_name: biz.business_name, provider_label: biz.provider_label } });
  }
  step.classList.remove('hidden');
  show('book');
  if (!staff.length) { list.replaceChildren(muted('אין כרגע נותני שירות זמינים')); $('#service-list').replaceChildren(muted('—'));
    return initBooking({ scope: { kind: 'biz', slug, staffId: null }, barber: null }); }
  $('#staff-label').textContent = `בחירת ${providerLabel(biz)}`;
  let current = staff.length === 1 ? staff[0].staff_id : null;
  const render = () => list.replaceChildren(...staff.map((s) =>
    h('button', { class: 'svc staff', type: 'button', 'aria-pressed': String(s.staff_id === current),
                  onclick: () => { if (s.staff_id === current) return; current = s.staff_id; render(); selectStaff(s.staff_id, asBarber(s)); } },
      h('span', {}, h('b', {}, s.display_name)))));
  render();
  if (!current) $('#service-list').replaceChildren(muted(`בחרו ${providerLabel(biz)} כדי לראות שירותים`));
  const first = staff.find((s) => s.staff_id === current);
  await initBooking({ scope: { kind: 'biz', slug, staffId: current }, barber: first ? asBarber(first) : null });
}

async function startStaff(slug, barber) {
  canonicalize(slug);
  setTitle(barber.display_name, barber.business_name);
  document.title = `${barber.display_name} · ${barber.business_name} – קביעת תור`;
  show('book');
  await initBooking({ scope: { kind: 'staff', slug }, barber });
}

const LOAD_TIMEOUT_MS = 12000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label || 'timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function start() {
  const attempt = slugAttempt();
  if (attempt.kind === 'invalid') return notFound();
  const fromUrl = attempt.kind === 'ok' ? attempt.slug : null;
  const slug = fromUrl || DEFAULT_BUSINESS_SLUG;
  try {
    let biz = null;
    try {
      biz = await withTimeout(api.business(slug), LOAD_TIMEOUT_MS, 'business load timeout');
    } catch (e) {
      if (isNotFound(e)) biz = null;
      else if (/timeout/i.test(e?.message || '')) return notFound();
      else throw e;
    }
    if (biz) return await startBusiness(slug, biz, !!fromUrl);
    if (!fromUrl) return notFound();
    let barber = null;
    try {
      barber = await withTimeout(api.barber(slug), LOAD_TIMEOUT_MS, 'barber load timeout');
    } catch (e) {
      if (isNotFound(e)) barber = null;
      else if (/timeout/i.test(e?.message || '')) return notFound();
      else throw e;
    }
    if (!barber) return notFound();
    await startStaff(slug, barber);
  } catch (e) {
    // Network / unexpected errors on an explicit slug → clear not-found, not a hung loader.
    if (fromUrl) return notFound();
    show('book');
    $('#service-list').replaceChildren(muted(friendlyError(e)));
  }
}
start();

// A hash-only change (e.g. typing #/b/<slug>) does not reload the page; reload if the slug changed.
const initialSlug = getSlug();
window.addEventListener('hashchange', () => { if (getSlug() !== initialSlug) location.reload(); });
