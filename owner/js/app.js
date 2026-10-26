// Owner dashboard entry: auth (email OTP / Google), business context, tabs.
import { sb, q, rpc, heError, ownerUrl } from './sb.js';
import { $, toast } from '../../js/ui.js';
import { renderCalendar } from './calendar.js';
import { renderServices } from './services.js';
import { renderHours } from './hours.js';
import { renderDays } from './days.js';
import { renderSettings } from './settings.js';

const VIEWS = ['loading', 'login', 'nobiz', 'calendar', 'services', 'hours', 'days', 'settings'];
const TABS = { calendar: renderCalendar, services: renderServices, hours: renderHours, days: renderDays, settings: renderSettings };
function show(name) { for (const v of VIEWS) $('#view-' + v).classList.toggle('hidden', v !== name); }

/** shared context for all tabs; reloaded after edits that change it */
export const ctx = { user: null, business: null, staff: [], services: [], policies: null };
export async function reloadContext() {
  const b = ctx.business.id;
  [ctx.staff, ctx.services, [ctx.policies]] = await Promise.all([
    q(sb.from('staff').select('*').eq('business_id', b).order('created_at')),
    q(sb.from('services').select('*').eq('business_id', b).order('created_at')),
    q(sb.from('policies').select('*').eq('business_id', b)),
  ]);
}

// ---------- login ----------
let otpEmail = '';
const loginErr = (m) => { $('#login-error').textContent = m || ''; };
$('#login-google').addEventListener('click', async () => {
  loginErr();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ownerUrl() } });
  if (error) loginErr(heError(error));
});
$('#otp-email-form').addEventListener('submit', async (e) => {
  e.preventDefault(); loginErr();
  otpEmail = new FormData(e.target).get('email').trim().toLowerCase();
  const btn = e.target.querySelector('button'); btn.disabled = true;
  // shouldCreateUser: a new address gets an account, but sees nothing until it has an invite/membership.
  const { error } = await sb.auth.signInWithOtp({ email: otpEmail, options: { shouldCreateUser: true } });
  btn.disabled = false;
  if (error) return loginErr(heError(error));
  $('#otp-sent').textContent = `שלחנו קוד וקישור כניסה אל ${otpEmail}`;
  $('#otp-email-form').classList.add('hidden'); $('#otp-code-form').classList.remove('hidden');
  $('#otp-code-form [name=token]').focus();
});
$('#otp-back').addEventListener('click', () => { $('#otp-code-form').classList.add('hidden'); $('#otp-email-form').classList.remove('hidden'); });
$('#otp-code-form').addEventListener('submit', async (e) => {
  e.preventDefault(); loginErr();
  const token = new FormData(e.target).get('token').trim();
  const { error } = await sb.auth.verifyOtp({ email: otpEmail, token, type: 'email' });
  if (error) return loginErr(heError(error));
  start();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

// ---------- tabs ----------
let current = 'calendar';
export async function openTab(name) {
  current = name;
  for (const b of document.querySelectorAll('#tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  show(name);
  const root = $('#view-' + name);
  try { await TABS[name](root, ctx); } catch (e) { root.replaceChildren(Object.assign(document.createElement('div'), { className: 'card', textContent: heError(e) })); }
}
$('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) openTab(t.dataset.tab); });

// ---------- boot ----------
async function start() {
  show('loading');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('login'); return; }
  ctx.user = session.user;
  $('#who').textContent = session.user.email || '';
  $('#logout').classList.remove('hidden');
  try {
    await rpc('claim_owner_invites', {});            // links a verified, invited email to its business (idempotent)
    const businesses = await q(sb.from('businesses').select('*').order('created_at'));
    if (!businesses.length) { show('nobiz'); return; }
    const saved = localStorage.getItem('nit-owner-business');
    ctx.business = businesses.find((b) => b.id === saved) || businesses[0];
    await reloadContext();
  } catch (e) { show('nobiz'); toast(heError(e), true); return; }
  $('#biz-name').textContent = ctx.business.name;
  document.title = `${ctx.business.name} – ניהול`;
  $('#tabs').classList.remove('hidden');
  openTab(current);
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') show('login'); });
start();
