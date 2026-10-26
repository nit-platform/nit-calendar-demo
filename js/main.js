// App entry: one standalone page per barber (slug in the URL). No barber list exists anywhere.
import { api, friendlyError } from './api.js';
import { $, muted } from './ui.js';
import { getSlug, canonicalize } from './router.js';
import { initBooking } from './booking.js';

// Customer page: free/busy only. The full day calendar is for the business owner (owner_day_view, authenticated).
function show(name) { for (const id of ['view-book', 'view-missing']) $('#' + id).classList.toggle('hidden', id !== 'view-' + name); }

function notFound() { show('missing'); document.title = 'NIT – הדף לא נמצא'; }

async function start() {
  const slug = getSlug();
  if (!slug) return notFound();
  let barber;
  try { barber = await api.barber(slug); }
  catch (e) { if ((e.message || '').includes('barber not found')) return notFound();
              $('#service-list').replaceChildren(muted(friendlyError(e))); return; }
  if (!barber) return notFound();
  canonicalize(slug);
  $('#barber-title').replaceChildren(barber.display_name, Object.assign(document.createElement('span'), { textContent: 'קביעת תור' }));
  $('#biz-name').textContent = barber.business_name;
  document.title = `${barber.display_name} · ${barber.business_name} – קביעת תור`;
  show('book');
  await initBooking({ slug, barber });
}
start();

// A hash-only change (e.g. typing #/b/<slug>) does not reload the page; reload if the barber changed.
const initialSlug = getSlug();
window.addEventListener('hashchange', () => { if (getSlug() !== initialSlug) location.reload(); });
