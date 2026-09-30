import { useEffect } from 'react';

// In-page replacements for confirm()/alert(), which sandboxed viewers (e.g. claude.ai artifacts) suppress.

export function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={message} onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        <div className="modal-foot-right">
          <button type="button" className="btn btn-ghost" onClick={onCancel} autoFocus>ยกเลิก</button>
          <button type="button" className="btn btn-danger-solid" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`toast${toast.error ? ' is-error' : ''}`} role="status">{toast.text}</div>;
}
