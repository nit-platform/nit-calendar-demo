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
import { renderOnboard } from './onboard.js';

const VIEWS = ['loading', 'login', 'nobiz', 'onboard', 'calendar', 'staff', 'services', 'hours', 'days', 'waitlist', 'settings'];
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
  for (const b of document.querySelectorAll('#tabs [role=tab]')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  show(name);
  const root = $('#view-' + name);
  try { await TABS[name](root, ctx); } catch (e) { root.replaceChildren(Object.assign(document.createElement('div'), { className: 'card', textContent: heError(e) })); }
  refreshTabsOverflow();
}
$('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) openTab(t.dataset.tab); });

/** B4: ArrowLeft/Right reverse in RTL; Home/End; roving tabindex. */
$('#tabs').addEventListener('keydown', (e) => {
  const tabs = [...document.querySelectorAll('#tabs [role=tab]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  let next = -1;
  if (e.key === 'ArrowRight') next = rtl ? i - 1 : i + 1;
  else if (e.key === 'ArrowLeft') next = rtl ? i + 1 : i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = tabs.length - 1;
  else return;
  e.preventDefault();
  const t = tabs[(next + tabs.length) % tabs.length];
  t.focus();
  openTab(t.dataset.tab);
});

function refreshTabsOverflow() {
  const wrap = $('#tabs-wrap');
  const tabs = $('#tabs');
  const more = $('#tabs-more');
  if (!wrap || !tabs || wrap.classList.contains('hidden')) return;
  const overflowing = tabs.scrollWidth > tabs.clientWidth + 4;
  wrap.classList.toggle('overflowing', overflowing);
  if (more && !more.dataset.wired) {
    more.dataset.wired = '1';
    more.addEventListener('click', () => {
      // Scroll toward the visually-trailing tabs (inline-start in RTL = left in LTR terms for "more")
      const max = tabs.scrollWidth - tabs.clientWidth;
      const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
      // In RTL, increasing scrollLeft moves toward the start of the DOM (calendar); "עוד" reveals trailing tabs.
      tabs.scrollTo({ left: rtl ? -max : max, behavior: 'smooth' });
      const last = tabs.querySelector('[role=tab]:last-child');
      last?.focus();
    });
  }
}
window.addEventListener('resize', () => refreshTabsOverflow());

// ---------- nobiz (K3) + onboard (K1) ----------
async function enterDashboard(business) {
  ctx.business = business;
  localStorage.setItem('nit-owner-business', business.id);
  await reloadContext();
  $('#biz-name').textContent = ctx.business.name;
  document.title = `${ctx.business.name} – ניהול`;
  $('#tabs-wrap').classList.remove('hidden');
  refreshTabsOverflow();
  await refreshSetupBanner();
  await openTab(current);
}

async function openOnboard() {
  $('#tabs-wrap').classList.add('hidden');
  $('#biz-name').textContent = '';
  $('#setup-banner')?.classList.add('hidden');
  show('onboard');
  const root = $('#view-onboard');
  await renderOnboard(root, {
    user: ctx.user,
    onCancel: async () => {
      // If a draft business already exists, drop into the dashboard (B10 covers leftovers).
      try {
        const businesses = await q(sb.from('businesses').select('*').order('created_at'));
        if (businesses.length) { await enterDashboard(businesses[businesses.length - 1]); return; }
      } catch (_) {}
      show('nobiz');
    },
    onDone: async (business) => { await enterDashboard(business); },
  });
}

function wireNobiz() {
  $('#nobiz-create')?.addEventListener('click', () => openOnboard());
  $('#nobiz-logout')?.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  $('#nobiz-refresh')?.addEventListener('click', async () => {
    const err = $('#nobiz-error'); if (err) { err.textContent = ''; err.classList.add('hidden'); }
    const btn = $('#nobiz-refresh'); if (btn) btn.disabled = true;
    try {
      await rpc('claim_owner_invites', {});
      const businesses = await q(sb.from('businesses').select('*').order('created_at'));
      if (!businesses.length) {
        if (err) { err.textContent = 'עדיין אין הזמנה למייל הזה. בקשו מבעל העסק להוסיף אתכם, או פתחו עסק חדש.'; err.classList.remove('hidden'); }
        return;
      }
      const saved = localStorage.getItem('nit-owner-business');
      await enterDashboard(businesses.find((b) => b.id === saved) || businesses[0]);
    } catch (e) {
      if (err) { err.textContent = heError(e); err.classList.remove('hidden'); }
      else toast(heError(e), true);
    } finally { if (btn) btn.disabled = false; }
  });
}
wireNobiz();

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
    await enterDashboard(businesses.find((b) => b.id === saved) || businesses[0]);
  } catch (e) { show('nobiz'); toast(heError(e), true); await refreshSetupBanner(); }
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') show('login'); });
start();
