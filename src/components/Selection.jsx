import { useEffect } from 'react';
import { DeleteProgress } from './Duplicates.jsx';

// Sticky bar while Top 5 jobs are ticked in edit mode.
export function SelectBar({ count, onClear, onDelete }) {
  return (
    <div className="select-bar" role="region" aria-label="งานที่เลือก">
      <span className="select-bar-count">เลือกแล้ว <b>{count}</b> งาน</span>
      <div className="select-bar-actions">
        <button type="button" className="btn btn-ghost" onClick={onClear}>ล้างการเลือก</button>
        <button type="button" className="btn btn-danger-solid" onClick={onDelete}>ลบ {count} งานที่เลือก</button>
      </div>
    </div>
  );
}

// Confirm deleting the ticked jobs, with progress while it runs.
export function BulkDeleteDialog({ jobs, busy, progress, onConfirm, onCancel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  const photos = jobs.reduce((n, j) => n + (j.photos?.length || 0), 0);
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="ลบงานที่เลือก" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--stuck)' }}><span className="modal-title">ลบ {jobs.length} งานที่เลือก</span></div>
        <div className="modal-body-col import-body">
          <p className="import-note">
            ลบแล้วกู้คืนไม่ได้{photos ? ` (รวมรูปถ่าย ${photos} รูป)` : ''} · ถ้าไม่แน่ใจ กด "ส่งออก Excel" หรือ "สำรองข้อมูล" ก่อน
          </p>
          <ul className="dupe-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <div className="dupe-title">โรง {j.plant} · {j.wo || 'ไม่มีเลข WO'} · {j.issue}</div>
                <div className="dupe-remove">✕ {j.progress || 0}% · รูป {j.photos?.length || 0}{j.owner ? ` · ${j.owner}` : ''}</div>
              </li>
            ))}
          </ul>
          {progress && <DeleteProgress {...progress} />}
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-foot-right">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>ยกเลิก</button>
            <button type="button" className="btn btn-danger-solid" disabled={busy || !jobs.length} onClick={onConfirm}>
              {busy ? `กำลังลบ… ${pct}%` : progress?.error ? 'ลองอีกครั้ง' : `ยืนยันลบ ${jobs.length} งาน`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
