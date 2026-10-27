// Data layer: the ONLY module that talks to Supabase. The future owner dashboard can swap
// demo_* RPCs for authenticated ones (get_available_slots / book_appointment / owner_day_view) here.
// supabase-js 2.118.0 is loaded by a pinned <script> with an SRI hash in the HTML (sets window.supabase).
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

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
  book: ({ scope: sc, serviceId, startsAt, name, phone }) => sc.kind === 'biz'
    ? rpc('public_book', { p_slug: sc.slug, p_staff_id: sc.staffId, p_service_id: serviceId, p_starts_at: startsAt,
                           p_customer_name: name, p_phone: phone })
    : rpc('demo_book', { p_slug: sc.slug, p_service_id: serviceId, p_starts_at: startsAt,
                         p_customer_name: name, p_phone: phone }),
};
