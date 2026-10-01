import { useEffect } from 'react';

const pctOf = (p) => (p?.total ? Math.round((p.done / p.total) * 100) : 0);

export function DeleteProgress({ done, total, error }) {
  const pct = pctOf({ done, total });
  return (
    <div className={`del-progress${error ? ' is-error' : ''}`} role="status" aria-live="polite">
      <div className="del-progress-text">
        <span>{error ? `หยุดที่ ${done}/${total} งาน` : done >= total ? 'ลบครบแล้ว กำลังโหลดข้อมูลใหม่…' : `กำลังลบ ${done}/${total} งาน`}</span>
        <b>{pct}%</b>
      </div>
      <div className="del-progress-bar"><i style={{ width: `${pct}%` }} /></div>
      {error && <div className="field-error">สาเหตุ: {error}</div>}
    </div>
  );
}

// Preview of duplicate Top 5 jobs: which one stays and which are removed, before deleting.
export default function DuplicatesDialog({ groups, busy, progress, onConfirm, onCancel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  const removeCount = groups.reduce((n, g) => n + g.remove.length, 0);
  const line = (j) => `${j.progress || 0}% · รูป ${j.photos?.length || 0}${j.owner ? ` · ${j.owner}` : ''}`;
  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="ลบงานซ้ำ" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--navy)' }}><span className="modal-title">ลบงานซ้ำใน Top 5</span></div>
        <div className="modal-body-col import-body">
          {groups.length === 0 ? (
            <p className="import-file">ไม่พบงานซ้ำ ✓</p>
          ) : (
            <>
              <p className="import-note">พบ {groups.length} กลุ่มที่ซ้ำกัน (เลข WO เดียวกัน หรือโรงและชื่องานเดียวกัน) — เก็บงานที่มีรูปมากสุด/คืบหน้ามากสุดไว้ 1 งาน ลบที่เหลือ {removeCount} งาน</p>
              <ul className="dupe-list">
                {groups.map((g) => (
                  <li key={g.key}>
                    <div className="dupe-title">โรง {g.keep.plant} · {g.keep.wo || 'ไม่มีเลข WO'} · {g.keep.issue}</div>
                    <div className="dupe-keep">✓ เก็บ: {line(g.keep)}</div>
                    {g.remove.map((j) => <div key={j.id} className="dupe-remove">✕ ลบ: {line(j)}{j.wo && j.wo !== g.keep.wo ? ` · WO ${j.wo}` : ''}</div>)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {progress && <DeleteProgress {...progress} />}
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-foot-right">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{groups.length ? 'ยกเลิก' : 'ปิด'}</button>
            {groups.length > 0 && (
              <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={onConfirm}>
                {busy ? `กำลังลบ… ${pctOf(progress)}%` : progress?.error ? 'ลองอีกครั้ง' : `ลบ ${removeCount} งานซ้ำ`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
