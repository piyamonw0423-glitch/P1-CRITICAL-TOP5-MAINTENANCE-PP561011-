import { useEffect, useMemo, useState } from 'react';
import { planImport } from '../lib/excel.js';
import { MAX_JOBS_PER_PLANT } from '../lib/data.js';

// Preview of an Excel import: what was read, what is wrong, and what will change, before saving.
export default function ExcelImportDialog({ fileName, parsed, current, busy, onConfirm, onCancel }) {
  const [mode, setMode] = useState('merge');
  const plan = useMemo(() => planImport(current, parsed, mode), [current, parsed, mode]);
  const impactPlants = Object.keys(parsed.plants);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="นำเข้าข้อมูลจาก Excel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--navy)' }}>
          <span className="modal-title">นำเข้าข้อมูลจาก Excel</span>
        </div>
        <div className="modal-body-col import-body">
          <p className="import-file">{fileName}</p>
          <div className="import-stats">
            <span><b>{parsed.jobs.length}</b> งานพร้อมนำเข้า</span>
            {parsed.errors.length > 0 && <span className="is-bad"><b>{parsed.errors.length}</b> แถวมีปัญหา (จะข้าม)</span>}
            {impactPlants.length > 0 && <span>ผลกระทบของโรง {impactPlants.join(', ')}</span>}
          </div>

          {parsed.errors.length > 0 && (
            <div className="import-errors">
              <div className="field-label">แถวที่มีปัญหา — แก้ในไฟล์แล้วนำเข้าใหม่ได้</div>
              <ul>
                {parsed.errors.slice(0, 12).map((e) => <li key={e.row}>แถว {e.row}: {e.msg}</li>)}
                {parsed.errors.length > 12 && <li>และอีก {parsed.errors.length - 12} แถว</li>}
              </ul>
            </div>
          )}

          <fieldset className="import-mode">
            <legend className="field-label">วิธีนำเข้า</legend>
            <label className={mode === 'merge' ? 'is-on' : ''}>
              <input type="radio" name="import-mode" value="merge" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span><b>อัปเดตและเพิ่มงาน</b> — งานที่เลข WO ตรงกันจะถูกอัปเดต ที่เหลือเพิ่มเป็นงานใหม่ งานอื่นในเว็บยังอยู่ครบ</span>
            </label>
            <label className={mode === 'replace' ? 'is-on is-danger' : ''}>
              <input type="radio" name="import-mode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span><b>แทนที่ข้อมูลทั้งหมด</b> — ในเว็บจะเหลือเฉพาะงานในไฟล์นี้ (ใช้ล้างข้อมูลตัวอย่าง)</span>
            </label>
          </fieldset>

          {plan.overflow.length > 0 && (
            <div className="import-errors">
              <div className="field-label is-bad">นำเข้าไม่ได้: แต่ละโรงมีได้ไม่เกิน {MAX_JOBS_PER_PLANT} งาน</div>
              <ul>
                {plan.overflow.map((o) => <li key={o.plant}>โรงไฟฟ้า {o.plant} จะมี {o.count} งาน — ลดในไฟล์ให้เหลือ {MAX_JOBS_PER_PLANT} งาน{mode === 'merge' ? ' หรือเลือก "แทนที่ข้อมูลทั้งหมด"' : ''}</li>)}
              </ul>
            </div>
          )}

          <div className="import-summary">
            ผลลัพธ์: เพิ่มใหม่ <b>{plan.added}</b> · อัปเดต <b>{plan.updated}</b>
            {mode === 'replace' && <> · <span className="is-bad">ลบ <b>{plan.removed}</b> งานที่ไม่มีในไฟล์</span></>}
          </div>
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-foot-right">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
            <button
              type="button"
              className={`btn ${mode === 'replace' ? 'btn-danger-solid' : 'btn-save'}`}
              disabled={busy || parsed.jobs.length === 0 || plan.overflow.length > 0}
              onClick={() => onConfirm({ jobs: plan.jobs, plants: parsed.plants, replace: mode === 'replace' }, plan)}
            >
              {busy ? 'กำลังนำเข้า…' : `นำเข้า ${parsed.jobs.length} งาน`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
