// Waitlist tab: entries (FIFO), open/past offers, blocked customers (no-show quota) and recent in-app notifications.
// Reads go through RLS (members of this business only; offer token hashes are not readable). Writes only via RPCs:
// owner_waitlist_cancel / owner_offer_token (members), owner_reset_no_shows (owner only, DB-enforced).
import { sb, q, rpc, heError, hhmm } from './sb.js';
import { h, muted, toast } from '../../js/ui.js';
import { fmtLongDate, fmtTime } from '../../js/time.js';
import { bookingUrl } from './bookinglink.js';

const ENTRY = { waiting: 'ממתין', offered: 'קיבל הצעה', booked: 'נקבע תור', cancelled: 'בוטל', expired: 'פג תוקף' };
const RESP = { accepted: 'אושר', declined: 'נדחה', timeout: 'לא נענה', lost: 'מישהו אחר הקדים', cancelled: 'בוטל' };
const KIND = { confirm: 'אישור תור', reminder: 'תזכורת', reminder_24h: 'תזכורת', reminder_2h: 'תזכורת', cancel: 'ביטול', waitlist_offer: 'הצעה מרשימת המתנה' };
const STATUS = { scheduled: 'מתוזמן', cancelled: 'בוטל', sent: 'נשלח', failed: 'נכשל', skipped: 'דולג' };
const dt = (ts) => ts ? `${fmtLongDate(new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }))} ${fmtTime(ts)}` : '';

export async function renderWaitlist(root, ctx) {
  const rerender = () => renderWaitlist(root, ctx);
  const b = ctx.business.id, isOwner = ctx.role === 'owner', limit = ctx.policies?.no_show_limit ?? 0;
  const [entries, offers, custs, notes] = await Promise.all([
    q(sb.from('waitlist_entries').select('id,customer_id,service_id,staff_id,date_from,date_to,window_from,window_to,status,created_at')
      .eq('business_id', b).order('created_at').limit(200)),
    q(sb.from('waitlist_offers').select('id,entry_id,staff_id,slot_start,slot_end,sent_at,expires_at,response,responded_at,mode,group_id')
      .order('sent_at', { ascending: false }).limit(100)),
    q(sb.from('customers').select('id,full_name,phone_e164,no_show_count').eq('business_id', b).gt('no_show_count', 0).order('no_show_count', { ascending: false }).limit(200)),
    q(sb.from('notifications').select('id,kind,channel,status,send_at,sent_at,error,customer_id,offset_min')
      .eq('business_id', b).order('send_at', { ascending: false }).limit(50)),
  ]);
  const ids = [...new Set(entries.map((e) => e.customer_id).concat(notes.map((n) => n.customer_id)))].filter(Boolean);
  const names = Object.fromEntries((ids.length ? await q(sb.from('customers').select('id,full_name,phone_e164').in('id', ids)) : [])
    .map((c) => [c.id, `${c.full_name || ''} ${c.phone_e164 || ''}`.trim()]));
  const svc = (id) => ctx.services.find((s) => s.id === id)?.name || '';
  const staff = (id) => id ? ctx.staff.find((s) => s.id === id)?.display_name || '' : 'כל אחד';
  const act = async (fn, ok) => { try { await fn(); toast(ok); rerender(); } catch (e) { toast(heError(e), true); } };
  const live = (o) => !o.response && new Date(o.expires_at) > new Date();

  const copyLink = async (o) => {
    try { const token = await rpc('owner_offer_token', { p_offer_id: o.id });
      const u = new URL(bookingUrl(ctx.business.public_slug)); u.searchParams.set('offer', token);
      await navigator.clipboard.writeText(u.toString()); toast('קישור ההצעה הועתק'); }
    catch (e) { toast(heError(e), true); } };

  const active = entries.filter((e) => e.status === 'waiting' || e.status === 'offered');
  const entryItem = (e, i) => h('div', { class: 'item', 'data-entry-id': e.id },
    h('span', {}, h('strong', {}, `${i + 1}. ${names[e.customer_id] || ''}`), ' · ', svc(e.service_id), ' · ', staff(e.staff_id),
      h('small', { class: 'muted' }, ` · ${e.date_from === e.date_to ? fmtLongDate(e.date_from) : `${fmtLongDate(e.date_from)} – ${fmtLongDate(e.date_to)}`}`,
        e.window_from ? ` ${hhmm(e.window_from)}–${hhmm(e.window_to)}` : '', ` · ${ENTRY[e.status] || e.status}`)),
    h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(() => rpc('owner_waitlist_cancel', { p_entry_id: e.id }), 'ההרשמה בוטלה') }, 'ביטול'));
  const offerItem = (o) => h('div', { class: 'item', 'data-offer-id': o.id },
    h('span', {}, h('strong', {}, dt(o.slot_start)), ' · ', staff(o.staff_id), ' · ',
      names[entries.find((e) => e.id === o.entry_id)?.customer_id] || '',
      h('small', { class: 'muted' }, ` · ${o.mode === 'broadcast' ? 'לכולם' : 'לפי הסדר'} · `,
        live(o) ? `פתוח עד ${fmtTime(o.expires_at)}` : RESP[o.response] || 'פג תוקף')),
    live(o) && ctx.business.public_slug ? h('button', { type: 'button', class: 'btn small ghost copy-offer', onclick: () => copyLink(o) }, 'העתקת קישור') : null);
  const blocked = custs.filter((c) => limit > 0 && c.no_show_count >= limit);
  const blockedItem = (c) => h('div', { class: 'item', 'data-customer-id': c.id },
    h('span', {}, h('strong', {}, c.full_name || ''), ' ', h('small', { dir: 'ltr' }, c.phone_e164), h('small', { class: 'muted' }, ` · ${c.no_show_count} אי-הגעות`)),
    isOwner ? h('button', { type: 'button', class: 'btn small reset-noshow', onclick: () => act(() => rpc('owner_reset_no_shows', { p_customer_id: c.id }), 'המונה אופס') }, 'איפוס') : null);
  const noteItem = (n) => h('div', { class: 'item' }, h('span', {}, h('strong', {}, KIND[n.kind] || n.kind), ' · ', names[n.customer_id] || '',
    h('small', { class: 'muted' }, ` · ${dt(n.sent_at || n.send_at)} · ${STATUS[n.status] || n.status}${n.error ? ` (${n.error})` : ''}`)));

  root.replaceChildren(
    h('div', { class: 'card', id: 'wl-entries' }, h('h2', {}, `ממתינים (${active.length})`),
      ctx.policies?.waitlist_enabled === false ? muted('רשימת ההמתנה כבויה בהגדרות.') : null,
      active.length ? h('div', { class: 'list' }, active.map(entryItem)) : muted('אין ממתינים כרגע')),
    h('div', { class: 'card', id: 'wl-offers' }, h('h2', {}, 'הצעות'),
      offers.length ? h('div', { class: 'list' }, offers.map(offerItem)) : muted('עוד לא נשלחו הצעות')),
    h('div', { class: 'card', id: 'wl-blocked' }, h('h2', {}, 'לקוחות חסומים (אי-הגעות)'),
      limit > 0 ? null : muted('החסימה כבויה (0 בהגדרות).'),
      blocked.length ? h('div', { class: 'list' }, blocked.map(blockedItem)) : muted('אין לקוחות חסומים'),
      !isOwner && blocked.length ? muted('רק בעל/ת העסק יכול/ה לאפס.') : null),
    h('div', { class: 'card', id: 'wl-notes' }, h('h2', {}, 'הודעות אחרונות (באפליקציה)'),
      notes.length ? h('div', { class: 'list' }, notes.map(noteItem)) : muted('אין הודעות')));
}
