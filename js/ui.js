// Tiny DOM helpers shared by all views.
export const $ = (sel, root = document) => root.querySelector(sel);
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
export const muted = (text) => h('p', { class: 'muted' }, text);
let toastTimer;
export function toast(msg, isError = false) {
  const t = $('#toast');
  if (!t) return;
  const text = String(msg || '').trim();
  if (!text) {
    t.textContent = '';
    t.classList.remove('show', 'err');
    return;
  }
  t.textContent = text;
  t.classList.toggle('err', isError);
  t.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t.textContent = '';
  }, isError ? 7000 : 4000);
}
export const shekel = (n) => `₪${Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

/** Business-chosen name for a service provider (e.g. 'ספר', 'מטפלת'); defaults to 'נותן שירות'. Plain text only. */
export const DEFAULT_PROVIDER_LABEL = 'נותן שירות';
export const providerLabel = (b) => (typeof b?.provider_label === 'string' && b.provider_label.trim()) || DEFAULT_PROVIDER_LABEL;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Simple focus trap for non-<dialog> overlays. Returns a disposer. */
export function trapFocus(root, { onEscape } = {}) {
  if (!root) return () => {};
  const nodes = () => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  const prev = document.activeElement;
  const first = nodes()[0];
  if (first) try { first.focus(); } catch { /* ignore */ }
  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (onEscape) { e.preventDefault(); onEscape(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const list = nodes();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (i <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    } else if (i === list.length - 1 || i < 0) {
      e.preventDefault(); list[0].focus();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('keydown', onKey);
    if (prev && typeof prev.focus === 'function') try { prev.focus(); } catch { /* ignore */ }
  };
}
