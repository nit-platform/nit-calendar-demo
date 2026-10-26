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
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', isError); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}
export const shekel = (n) => `₪${Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
