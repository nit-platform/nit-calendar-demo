// Owner dashboard entry: auth (email OTP / Google), business context, tabs.
import { sb, q, rpc, heError, ownerUrl } from './sb.js';
import { initCaptcha, captchaToken, resetCaptcha } from './captcha.js';
import { $, h, toast } from '../../js/ui.js';
import { renderCalendar } from './calendar.js';
import { renderStaff } from './staff.js';
import { renderServices } from './services.js';
import { renderHours } from './hours.js';
import { renderDays } from './days.js';
import { renderSettings } from './settings.js';
import { renderWaitlist } from './waitlist.js';

const VIEWS = ['loading', 'login', 'nobiz', 'calendar', 'staff', 'services', 'hours', 'days', 'waitlist', 'settings'];
const TABS = { calendar: renderCalendar, staff: renderStaff, services: renderServices, hours: renderHours, days: renderDays, waitlist: renderWaitlist, settings: renderSettings };
function show(name) { for (const v of VIEWS) $('#view-' + v).classList.toggle('hidden', v !== name); }

/** shared context for all tabs; reloaded after edits that change it */
export const ctx = { user: null, business: null, staff: [], services: [], policies: null, hasHours: false };
export async function reloadContext() {
  const b = ctx.business.id;
  [ctx.staff, ctx.services, [ctx.policies], ctx.role] = await Promise.all([
    q(sb.from('staff').select('*').eq('business_id', b).order('created_at')),
    q(sb.from('services').select('*').eq('business_id', b).order('created_at')),
    q(sb.from('policies').select('*').eq('business_id', b)),
    q(sb.from('business_members').select('role').eq('business_id', b).eq('user_id', ctx.user.id)).then((r) => r[0]?.role || null, () => null),
  ]);
  const ids = ctx.staff.map((s) => s.id);
  ctx.hasHours = ids.length
    ? (await q(sb.from('working_hours').select('id').in('staff_id', ids).limit(1))).length > 0
    : false;
  await refreshSetupBanner();
}

function dismissKey() { return ctx.business ? `nit-setup-dismiss:${ctx.business.id}` : ''; }

/** B10: dismissible setup checklist when staff / hours / active service / public_slug missing. */
export async function refreshSetupBanner() {
  const el = $('#setup-banner');
  if (!el) return;
  if (!ctx.business || !ctx.user) { el.classList.add('hidden'); el.replaceChildren(); return; }
  if (localStorage.getItem(dismissKey())) { el.classList.add('hidden'); el.replaceChildren(); return; }
  // Re-check hours so hours-tab saves (which don't always reloadContext) stay accurate.
  if (ctx.staff) {
    const ids = ctx.staff.map((s) => s.id);
    ctx.hasHours = ids.length
      ? (await q(sb.from('working_hours').select('id').in('staff_id', ids).limit(1))).length > 0
      : false;
  }
  const steps = [
    { ok: ctx.staff.some((s) => s.is_active), tab: 'staff', label: 'צוות' },
    { ok: ctx.hasHours, tab: 'hours', label: 'שעות' },
    { ok: ctx.services.some((s) => s.is_active), tab: 'services', label: 'שירות' },
    { ok: !!ctx.business.public_slug, tab: 'settings', label: 'שיתוף קישור' },
  ];
  if (steps.every((s) => s.ok)) { el.classList.add('hidden'); el.replaceChildren(); return; }
  const links = steps.map((s, i) => {
    const n = `${i + 1} ${s.label}`;
    return s.ok
      ? h('span', { class: 'setup-done' }, n)
      : h('button', { type: 'button', class: 'setup-link', 'data-tab': s.tab }, n);
  });
  el.replaceChildren(
    h('div', { class: 'setup-inner' },
      h('p', {}, 'השלימו את ההגדרה: ', ...links.reduce((a, node, i) => {
        if (i) a.push(h('span', { class: 'setup-sep' }, ' · '));
        a.push(node);
        return a;
      }, [])),
      h('button', { type: 'button', class: 'btn small ghost setup-dismiss', 'aria-label': 'סגירה' }, '✕')));
  el.classList.remove('hidden');
  el.querySelectorAll('.setup-link').forEach((btn) => btn.addEventListener('click', () => openTab(btn.dataset.tab)));
  el.querySelector('.setup-dismiss')?.addEventListener('click', () => {
    localStorage.setItem(dismissKey(), '1');
    el.classList.add('hidden'); el.replaceChildren();
  });
}

// ---------- login ----------
let otpEmail = '';
const loginErr = (m) => { $('#login-error').textContent = m || ''; };
initCaptcha($('#captcha'));
$('#login-google').addEventListener('click', async () => {
  loginErr();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ownerUrl() } });
  if (error) loginErr(heError(error));
});
$('#otp-email-form').addEventListener('submit', async (e) => {
  e.preventDefault(); loginErr();
  otpEmail = new FormData(e.target).get('email').trim().toLowerCase();
  const captcha = captchaToken();
  if (!captcha) return loginErr('יש להשלים את בדיקת האבטחה (אני לא רובוט) ולנסות שוב.');
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  // shouldCreateUser: a new address gets an account, but sees nothing until it has an invite/membership.
  const { error } = await sb.auth.signInWithOtp({ email: otpEmail, options: { shouldCreateUser: true, captchaToken: captcha } });
  btn.disabled = false; resetCaptcha();   // Turnstile tokens are single-use
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
  if (!session) { show('login'); await refreshSetupBanner(); return; }
  ctx.user = session.user;
  $('#who').textContent = session.user.email || '';
  $('#logout').classList.remove('hidden');
  try {
    await rpc('claim_owner_invites', {});            // links a verified, invited email to its business (idempotent)
    const businesses = await q(sb.from('businesses').select('*').order('created_at'));
    if (!businesses.length) { show('nobiz'); await refreshSetupBanner(); return; }
    const saved = localStorage.getItem('nit-owner-business');
    ctx.business = businesses.find((b) => b.id === saved) || businesses[0];
    await reloadContext();
  } catch (e) { show('nobiz'); toast(heError(e), true); await refreshSetupBanner(); return; }
  $('#biz-name').textContent = ctx.business.name;
  document.title = `${ctx.business.name} – ניהול`;
  $('#tabs').classList.remove('hidden');
  await refreshSetupBanner();
  openTab(current);
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') show('login'); });
start();
