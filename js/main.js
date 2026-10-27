// App entry. The URL slug (?b=<slug>, /b/<slug> or #/b/<slug>) is resolved as:
//   1. a business booking link (public_business) -> that business only, with a provider picker
//      (or no picker when the owner turned off customers_choose_provider: a free provider is auto-assigned);
//   2. otherwise a legacy per-provider demo link (demo_barber, e.g. /b/avi);
//   3. no slug at all -> the demo business (DEFAULT_BUSINESS_SLUG).
// Every value from the server is inserted as text (textContent / text nodes), never as HTML.
import { api, friendlyError } from './api.js';
import { $, h, muted, providerLabel } from './ui.js';
import { getSlug, canonicalize } from './router.js';
import { initBooking, selectStaff, selection } from './booking.js';
import { initWaitlist, startInboxPolling, renderOffer } from './waitlist.js';
import { DEFAULT_BUSINESS_SLUG } from './config.js';

// Customer page: free/busy only. The full day calendar is for the business owner (owner_day_view, authenticated).
function show(name) { for (const id of ['view-book', 'view-missing', 'view-offer']) $('#' + id).classList.toggle('hidden', id !== 'view-' + name); }

function notFound() { show('missing'); document.title = 'NIT – הדף לא נמצא'; }
const isNotFound = (e) => /business not found|barber not found/.test(e?.message || '');

function setTitle(main, biz) {
  $('#barber-title').replaceChildren(main, Object.assign(document.createElement('span'), { textContent: 'קביעת תור' }));
  $('#biz-name').textContent = biz;
}

async function startBusiness(slug, biz, explicit) {
  const offer = new URLSearchParams(location.search).get('offer');
  if (offer !== null) {          // ?b=<slug>&offer=<token>: the offer page only (token never leaves the URL/server call)
    setTitle(biz.business_name, ''); document.title = `${biz.business_name} – הצעה מרשימת המתנה`;
    show('offer');
    await renderOffer(slug, offer.toLowerCase(), $('#offer-box'));
    $('#offer-back').href = location.pathname + '?b=' + encodeURIComponent(slug);
    return;
  }
  if (explicit) canonicalize(slug);
  if (biz.waitlist_enabled !== false) initWaitlist(slug, selection);
  startInboxPolling(slug);
  setTitle(biz.business_name, '');
  document.title = `${biz.business_name} – קביעת תור`;
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

async function start() {
  const fromUrl = getSlug();
  const slug = fromUrl || DEFAULT_BUSINESS_SLUG;
  try {
    let biz = null;
    try { biz = await api.business(slug); } catch (e) { if (!isNotFound(e)) throw e; }
    if (biz) return await startBusiness(slug, biz, !!fromUrl);
    if (!fromUrl) return notFound();
    let barber = null;
    try { barber = await api.barber(slug); } catch (e) { if (!isNotFound(e)) throw e; }
    if (!barber) return notFound();
    await startStaff(slug, barber);
  } catch (e) { show('book'); $('#service-list').replaceChildren(muted(friendlyError(e))); }
}
start();

// A hash-only change (e.g. typing #/b/<slug>) does not reload the page; reload if the slug changed.
const initialSlug = getSlug();
window.addEventListener('hashchange', () => { if (getSlug() !== initialSlug) location.reload(); });
