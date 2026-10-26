// App entry: one standalone page per barber (slug in the URL). No barber list exists anywhere.
import { api, friendlyError } from './api.js';
import { $, muted } from './ui.js';
import { getSlug, canonicalize } from './router.js';
import { initBooking } from './booking.js';
import { initDayView, showDay, load as loadDay } from './dayview.js';

const views = { book: $('#view-book'), day: $('#view-day'), missing: $('#view-missing') };
let dayLoaded = false;

function switchTo(name) {
  for (const [k, el] of Object.entries(views)) el.classList.toggle('hidden', k !== name);
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on));
  });
  if (name === 'day' && !dayLoaded) { dayLoaded = true; loadDay(); }
  if (name !== 'missing') history.replaceState(null, '', location.pathname + location.search + (name === 'day' ? '#day' : ''));
}

function notFound() { $('.tabs').classList.add('hidden'); switchTo('missing'); document.title = 'NIT – הדף לא נמצא'; }

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
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTo(t.dataset.view)));
  initDayView({ slug });
  await initBooking({ slug, barber, onBookedCb: (ctx) => { dayLoaded = true; showDay(ctx); } });
  if (location.hash === '#day') switchTo('day');
}
start();

// A hash-only change (e.g. typing #/b/<slug>) does not reload the page; reload if the barber changed.
const initialSlug = getSlug();
window.addEventListener('hashchange', () => { if (getSlug() !== initialSlug) location.reload(); });
