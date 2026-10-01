import { useEffect, useState } from 'react';

// In-page replacements for confirm()/alert(), which sandboxed viewers (e.g. claude.ai artifacts) suppress.

export function ConfirmDialog({ message, confirmLabel, busy, onConfirm, onCancel }) {
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
          <button type="button" className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>{busy ? 'กำลังบันทึก…' : confirmLabel}</button>
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

// Asks for the team edit password once per device (only when the server requires one).
export function PasswordDialog({ onSubmit, onCancel }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  const submit = async (e) => {
    e.preventDefault();
    if (!key) return;
    setBusy(true);
    setErr(await onSubmit(key));
    setBusy(false);
  };
  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <form className="confirm" role="dialog" aria-modal="true" aria-label="รหัสผ่านสำหรับแก้ไข" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <label className="confirm-msg" htmlFor="edit-key">ใส่รหัสผ่านทีมเพื่ออัปเดตงาน</label>
        <input id="edit-key" className={`field${err ? ' is-invalid' : ''}`} type={show ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => { setKey(e.target.value); setErr(''); }} autoFocus />
        <label className="show-key"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> แสดงรหัส (ตรวจตัวพิมพ์เล็ก/ใหญ่ และภาษาแป้นพิมพ์)</label>
        {err && <span className="field-error">{err}</span>}
        <div className="modal-foot-right">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
          <button type="submit" className="btn btn-save" disabled={busy || !key}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน'}</button>
        </div>
      </form>
    </div>
  );
}
