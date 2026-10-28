// Data layer: the ONLY module that talks to Supabase. The future owner dashboard can swap
// demo_* RPCs for authenticated ones (get_available_slots / book_appointment / owner_day_view) here.
// supabase-js 2.118.0 is loaded by a pinned <script> with an SRI hash in the HTML (sets window.supabase).
const { createClient } = window.supabase;
import * as cfg from './config.js';
import * as auth from './auth.js';
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = cfg;
// Missing in an older cached config.js -> false (legacy path).
export const WAITLIST_VIA_FUNCTION = cfg.WAITLIST_VIA_FUNCTION === true;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ERRORS = {
  'slot not available': 'השעה כבר נתפסה. בחרו שעה אחרת.',
  'invalid phone': 'מספר טלפון לא תקין (לדוגמה 050-1234567).',
  'invalid name': 'נא להזין שם (2–60 תווים).',
  'too many bookings for this phone today': 'הגעתם למספר התורים המרבי להיום מהטלפון הזה.',
  'demo is busy, try later': 'ההדגמה עמוסה כרגע, נסו שוב בעוד מעט.',
  'barber not found': 'הדף לא נמצא.',
  'business not found': 'הדף לא נמצא.',
  'too many bookings, try again in a minute': 'יותר מדי ניסיונות. נסו שוב בעוד דקה.',
  'too many bookings, try later': 'העסק עמוס כרגע, נסו שוב בעוד מעט.',
  'too many bookings from this device, try later': 'יותר מדי הזמנות מהמכשיר הזה. נסו שוב בעוד כמה דקות.',
  'too many bookings from this device today': 'הגעתם למספר ההזמנות המרבי להיום מהמכשיר הזה. נסו שוב מחר.',
  'customer not found, deleted or blocked': 'לא ניתן לקבוע תור ללקוח זה.',
  // waitlist (000013)
  'waitlist disabled': 'רשימת ההמתנה של העסק סגורה כרגע.',
  'invalid dates': 'טווח תאריכים לא תקין (עד 14 יום, מהיום והלאה).',
  'invalid time window': 'טווח שעות לא תקין.',
  'service not found': 'השירות לא נמצא.',
  'too many waitlist requests for this phone today': 'הגעתם למספר ההרשמות המרבי להיום מהטלפון הזה.',
  'too many waitlist requests from this device, try later': 'יותר מדי הרשמות מהמכשיר הזה. נסו שוב בעוד כמה דקות.',
  'too many waitlist requests from this device today': 'הגעתם למספר ההרשמות המרבי להיום מהמכשיר הזה.',
  'too many waitlist requests, try again in a minute': 'יותר מדי ניסיונות. נסו שוב בעוד דקה.',
  'too many waitlist requests, try later': 'העסק עמוס כרגע, נסו שוב בעוד מעט.',
  'too many attempts, try later': 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.',
  'invalid input': 'הבקשה לא תקינה.',
  // Turnstile (000015)
  'verification required': 'נא להשלים את בדיקת האבטחה.',
  'verification failed': 'בדיקת האבטחה נכשלה. נסו שוב.',
  'verification unavailable': 'ההרשמה אינה זמינה כרגע. נסו שוב מאוחר יותר.',
  // manage token (000018)
  'not found': 'הקישור לניהול התור לא תקין או שפג תוקפו.',
  'not cancellable': 'לא ניתן לבטל את התור במצבו הנוכחי.',
  'not reschedulable': 'לא ניתן לשנות את מועד התור במצבו הנוכחי.',
  'too late to cancel': 'מאוחר מדי לביטול (לפי מדיניות העסק).',
  'too late to reschedule': 'מאוחר מדי לשינוי מועד (לפי מדיניות העסק).',
  'too many manage requests from this device, try later': 'יותר מדי ניסיונות מהמכשיר הזה. נסו שוב בעוד כמה דקות.',
  'too many manage requests from this device today': 'הגעתם למספר הניסיונות המרבי להיום מהמכשיר הזה.',
  'too many manage requests, try again in a minute': 'יותר מדי ניסיונות. נסו שוב בעוד דקה.',
  'too many manage requests, try later': 'העסק עמוס כרגע, נסו שוב בעוד מעט.',
};
export function friendlyError(err) {
  const m = (err && (err.message || String(err))) || '';
  for (const [k, v] of Object.entries(ERRORS)) if (m.includes(k)) return v;
  return 'אירעה שגיאה. נסו שוב.';
}

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data ?? [];
}

// Edge Function call (same supabase.co host, already in CSP connect-src). Errors carry the server message.
async function viaFunction(name, body) {
  let res, data;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    data = await res.json().catch(() => null);
  } catch { throw new Error('network'); }
  if (!res.ok) throw new Error((data && (data.message || data.error)) || `http ${res.status}`);
  return data ?? [];
}

// Every call is scoped by a public slug from the URL. A scope is either
//   { kind: 'staff', slug }            legacy per-provider demo link (/b/avi)
//   { kind: 'biz', slug, staffId }     a business booking link (?b=<business slug>) + the chosen provider
//                                      (staffId null when the business auto-assigns a provider)
// The server re-checks that staffId belongs to that business; nothing else is reachable.
export const api = {
  barber: async (slug) => (await rpc('demo_barber', { p_slug: slug }))[0] ?? null,
  business: async (slug) => (await rpc('public_business', { p_slug: slug }))[0] ?? null,
  listServices: (sc) => sc.kind === 'biz'
    ? rpc('public_list_services', { p_slug: sc.slug, p_staff_id: sc.staffId })
    : rpc('demo_list_services', { p_slug: sc.slug }),
  // Every grid start time of the day: { slot_start, slot_end, available, is_dead_time_fill }. Free/busy only.
  slotGrid: (sc, serviceId, date) => sc.kind === 'biz'
    ? rpc('public_slot_grid', { p_slug: sc.slug, p_staff_id: sc.staffId, p_service_id: serviceId, p_date: date })
    : rpc('demo_slot_grid', { p_slug: sc.slug, p_service_id: serviceId, p_date: date }),
  book: async ({ scope: sc, serviceId, startsAt, name, phone }) => {
    if (sc.kind === 'biz' && auth.googleSignInEnabled()) {
      const session = await auth.getCustomerSession();
      if (session) {
        return auth.customerRpc('customer_book', {
          p_slug: sc.slug, p_staff_id: sc.staffId, p_service_id: serviceId, p_starts_at: startsAt,
          p_customer_name: name, p_phone: phone,
        });
      }
    }
    return sc.kind === 'biz'
      ? rpc('public_book', { p_slug: sc.slug, p_staff_id: sc.staffId, p_service_id: serviceId, p_starts_at: startsAt,
                             p_customer_name: name, p_phone: phone })
      : rpc('demo_book', { p_slug: sc.slug, p_service_id: serviceId, p_starts_at: startsAt,
                           p_customer_name: name, p_phone: phone });
  },
  myAppointments: async (slug) => {
    if (!auth.googleSignInEnabled()) return [];
    const session = await auth.getCustomerSession();
    if (!session) return [];
    const data = await auth.customerRpc('customer_my_appointments', { p_slug: slug });
    return Array.isArray(data) ? data : (data ?? []);
  },
  // Linked businesses only (joined via ?b=slug). No directory/search — server returns exact set.
  myBusinesses: async () => {
    if (!auth.googleSignInEnabled()) return [];
    const session = await auth.getCustomerSession();
    if (!session) return [];
    const data = await auth.customerRpc('customer_my_businesses', {});
    return Array.isArray(data) ? data : (data ?? []);
  },
  // waitlist + in-app inbox (business links only). Tokens are random, stored hashed server-side.
  waitlistJoin: ({ slug, staffId, serviceId, from, to, timeFrom, timeTo, name, phone, token, captcha }) => {
    const params = { p_slug: slug, p_staff_id: staffId, p_service_id: serviceId, p_date_from: from, p_date_to: to,
      p_time_from: timeFrom || null, p_time_to: timeTo || null, p_customer_name: name, p_phone: phone, p_access_token: token || null };
    return WAITLIST_VIA_FUNCTION ? viaFunction('waitlist-join', { ...params, turnstile_token: captcha || '' })
                                 : rpc('public_waitlist_join', params);
  },
  waitlistCancel: (slug, token, entryId) => rpc('public_waitlist_cancel', { p_slug: slug, p_token: token, p_entry_id: entryId }),
  inbox: (slug, tokens) => rpc('public_inbox', { p_slug: slug, p_tokens: tokens }),
  offer: (slug, token) => rpc('public_offer', { p_slug: slug, p_token: token }),
  offerRespond: (slug, token, accept) => rpc('public_offer_respond', { p_slug: slug, p_token: token, p_accept: accept }),
  appointmentGet: (slug, token) => rpc('public_appointment_get', { p_slug: slug, p_token: token }),
  appointmentCancel: (slug, token) => rpc('public_appointment_cancel', { p_slug: slug, p_token: token }),
  appointmentReschedule: (slug, token, { staffId, serviceId, startsAt }) =>
    rpc('public_appointment_reschedule', { p_slug: slug, p_token: token, p_staff_id: staffId ?? null,
                                           p_service_id: serviceId, p_starts_at: startsAt }),
};
