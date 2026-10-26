// Date/time helpers, always in the business timezone (Asia/Jerusalem), whatever the device tz.
import { TIMEZONE } from './config.js';

const hm = new Intl.DateTimeFormat('he-IL', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const longDay = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'short' });

export const fmtTime = (ts) => hm.format(new Date(ts));
export const todayISO = () => ymd.format(new Date());
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const fmtLongDate = (iso) => longDay.format(new Date(iso + 'T00:00:00Z'));
export const fmtShortWeekday = (iso) => shortDay.format(new Date(iso + 'T00:00:00Z'));
export const dayOfMonth = (iso) => Number(iso.slice(8, 10));
/** minutes since local midnight (business tz) for a timestamp */
export function minutesOfDay(ts) {
  const [h, m] = fmtTime(ts).split(':').map(Number);
  return h * 60 + m;
}
export const hhmmToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const minToHHMM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
