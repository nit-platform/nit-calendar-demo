// Shared customer contact + range validation (booking + waitlist). Server re-checks via clean_contact / waitlist_join_core.
export function normalizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

/** Trimmed name, length 2–60, must contain a letter (Latin/Hebrew/Arabic/Cyrillic). */
export function isValidCustomerName(raw) {
  const n = normalizeName(raw);
  if (n.length < 2 || n.length > 60) return false;
  // At least one letter — reject spaces-only and punctuation-only.
  return /[A-Za-z\u00C0-\u024F\u05D0-\u05EA\u0620-\u064A\u0400-\u04FF]/.test(n);
}

/**
 * Israeli mobile in common forms: 05XXXXXXXX, +9725XXXXXXXX, 9725XXXXXXXX
 * (spaces / dashes / parentheses stripped). Rejects plus-only and landlines.
 */
export function isValidIlMobile(raw) {
  const d = String(raw || '').replace(/[\s\-()]/g, '');
  return /^05[0-9]{8}$/.test(d) || /^\+9725[0-9]{8}$/.test(d) || /^9725[0-9]{8}$/.test(d);
}

/** HTML pattern hint (still re-checked in JS). Requires a leading digit — blocks "+++++++++". */
export const PHONE_INPUT_PATTERN = '(?:05[0-9\\-\\s]{8,12}|\\+9725[0-9\\-\\s]{8,12}|9725[0-9\\-\\s]{8,12}|0[0-9][0-9\\-\\s]{7,14})';

export function contactError(nameRaw, phoneRaw) {
  if (!isValidCustomerName(nameRaw)) return 'נא להזין שם מלא (לפחות 2 תווים)';
  if (!isValidIlMobile(phoneRaw)) return 'נא להזין טלפון נייד ישראלי תקין';
  return '';
}

/** Waitlist date/hour window. Returns Hebrew error or ''. */
export function waitlistRangeError(from, to, tfrom, tto) {
  if (!from || !to) return 'נא לבחור טווח תאריכים';
  if (to < from) return 'תאריך הסיום לפני תאריך ההתחלה';
  const hasFrom = !!(tfrom && String(tfrom).trim());
  const hasTo = !!(tto && String(tto).trim());
  if (hasFrom !== hasTo) return 'טווח שעות לא תקין';
  if (hasFrom && hasTo && String(tto) <= String(tfrom)) return 'שעת הסיום לפני שעת ההתחלה או זהה לה';
  return '';
}
