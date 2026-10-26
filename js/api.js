// Data layer: the ONLY module that talks to Supabase. The future owner dashboard can swap
// demo_* RPCs for authenticated ones (get_available_slots / book_appointment) here.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ERRORS = {
  'slot not available': 'השעה כבר נתפסה. בחרו שעה אחרת.',
  'invalid phone': 'מספר טלפון לא תקין (לדוגמה 050-1234567).',
  'invalid name': 'נא להזין שם (2–60 תווים).',
  'too many bookings for this phone today': 'הגעתם למספר התורים המרבי להיום מהטלפון הזה.',
  'demo is busy, try later': 'ההדגמה עמוסה כרגע, נסו שוב בעוד מעט.',
  'barber not found': 'הדף לא נמצא.',
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

// Every call is scoped to ONE barber, identified only by the public slug in the URL.
export const api = {
  barber: async (slug) => (await rpc('demo_barber', { p_slug: slug }))[0] ?? null,
  listServices: (slug) => rpc('demo_list_services', { p_slug: slug }),
  slots: (slug, serviceId, date) => rpc('demo_slots', { p_slug: slug, p_service_id: serviceId, p_date: date }),
  book: ({ slug, serviceId, startsAt, name, phone }) =>
    rpc('demo_book', { p_slug: slug, p_service_id: serviceId, p_starts_at: startsAt,
                       p_customer_name: name, p_phone: phone }),
  dayView: (slug, date) => rpc('demo_day_view', { p_slug: slug, p_date: date }),
  dayHours: (slug, date) => rpc('demo_day_hours', { p_slug: slug, p_date: date }),
};
