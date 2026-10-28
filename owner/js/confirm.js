// Shared branded danger <dialog> (#danger-confirm) — reject/cancel/staff removal.
import { $ } from '../../js/ui.js';

export function askDangerConfirm({ title, body, yesLabel }) {
  const dlg = $('#danger-confirm');
  if (!dlg || typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm(body || title || 'לאשר?'));
  }
  const t = $('#danger-confirm-title');
  const b = $('#danger-confirm-body');
  const y = $('#danger-confirm-yes');
  if (t) t.textContent = title || 'אישור';
  if (b) b.textContent = body || '';
  if (y) y.textContent = yesLabel || 'כן, בטל';
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'yes');
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
  });
}
