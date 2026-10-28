// Supabase client for the owner dashboard: anon key + the signed-in user's Auth session (JWT).
// Every read/write below is filtered by RLS (business_members). No service-role key anywhere.
// supabase-js 2.118.0 is loaded by a pinned <script> with an SRI hash in the HTML (sets window.supabase).
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TIMEZONE } from '../../js/config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
export { TIMEZONE };

/** The URL Supabase redirects back to after Google sign-in (this page, without query/hash). */
export const ownerUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

const ERRORS = [
  [/captcha/i, 'בדיקת האבטחה נכשלה או פגה. השלימו אותה שוב ונסו שנית.'],
  [/owner only/i, 'רק בעל/ת העסק יכול/ה לשנות את ההגדרה הזו.'],
  [/row-level security|not authorized|permission denied|42501/i, 'אין הרשאה לפעולה הזו.'],
  [/no_double_booking|overlaps|23P01/i, 'ההתנגשות ביומן: יש תור אחר באותה שעה.'],
  [/duplicate key|23505/i, 'כבר קיים ערך כזה (למשל מספר שלב כפול).'],
  [/check constraint|23514/i, 'ערך לא תקין (בדקו טווחים ושעות).'],
  [/Token has expired|invalid.*otp|otp_expired/i, 'הקוד שגוי או שפג תוקפו. בקשו קוד חדש.'],
  [/too many businesses created from this device today/i, 'נוצרו יותר מדי עסקים מהמכשיר הזה היום. נסו מחר.'],
  [/too many businesses created from this device/i, 'נוצרו יותר מדי עסקים מהמכשיר הזה. נסו שוב מאוחר יותר.'],
  [/too many businesses created today/i, 'נוצרו יותר מדי עסקים היום. נסו מחר.'],
  [/too many businesses created/i, 'נוצרו יותר מדי עסקים. נסו שוב מאוחר יותר.'],
  [/email not confirmed/i, 'יש לאמת את כתובת המייל לפני פתיחת עסק.'],
  [/invalid name/i, 'שם העסק לא תקין (2–80 תווים, ללא < או >).'],
  [/invalid provider_label/i, 'כינוי נותן השירות לא תקין.'],
  [/invalid phone/i, 'מספר וואטסאפ לא תקין.'],
  [/public_slug unavailable/i, 'הקישור הזה לא זמין, בחרו מזהה אחר.'],
  [/rate limit|For security purposes|PT429/i, 'יותר מדי ניסיונות. נסו שוב בעוד דקה.'],
  [/fetch|network/i, 'אין חיבור לשרת. נסו שוב.'],
];
export function heError(e) {
  const m = (e && (e.message || e.details || e.code || String(e))) || '';
  for (const [re, he] of ERRORS) if (re.test(m) || re.test(e?.code || '')) return he;
  return 'אירעה שגיאה: ' + m;
}

/** Run a PostgREST query builder, throw on error, return data. */
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}
export const rpc = (name, args) => q(sb.rpc(name, args));

// ---- timezone helpers (business timezone, whatever the device) ----
function offsetFor(isoLocal) {   // '+02:00' / '+03:00' for a wall-clock time in TIMEZONE
  const guess = new Date(isoLocal + 'Z');
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value;   // "GMT+02:00"
  return name === 'GMT' ? '+00:00' : name.slice(3);
}
/** 'YYYY-MM-DDTHH:MM' wall clock in TIMEZONE -> ISO timestamptz string */
export const localToTs = (isoLocal) => `${isoLocal}:00${offsetFor(isoLocal)}`;
/** timestamptz -> 'YYYY-MM-DDTHH:MM' wall clock in TIMEZONE */
export function tsToLocal(ts) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** parse a Postgres tstzrange text '["a","b")' -> [Date, Date] */
export function parseRange(r) {
  const m = String(r || '').match(/^[[(]"?([^",]+)"?,"?([^")\]]+)"?[)\]]$/);
  return m ? [new Date(m[1].replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')), new Date(m[2].replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))] : null;
}
export const hhmm = (t) => (t || '').slice(0, 5);
export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
