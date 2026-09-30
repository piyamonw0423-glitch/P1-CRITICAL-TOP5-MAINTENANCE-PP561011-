import { useRef } from 'react';
import Icon from '../lib/icons.jsx';

export function StatusPanel({ title, text }) {
  return (
    <div className="state-panel" role="status">
      <div className="state-title">{title}</div>
      {text && <p className="state-text">{text}</p>}
    </div>
  );
}

export function EmptyState({ canWrite, backupCount, busy, onStart, onMigrate, onImportFile }) {
  const fileRef = useRef(null);
  return (
    <div className="state-panel">
      <div className="state-icon"><Icon name="factory" /></div>
      <div className="state-title">ยังไม่มีงาน P1 ในแดชบอร์ด</div>
      <p className="state-text">
        งานที่เพิ่มจะแสดงเป็น Top 5 ของโรงไฟฟ้า 5, 10, 6 และ 11 และทุกคนที่เปิดลิงก์นี้จะเห็นข้อมูลชุดเดียวกันทันที
      </p>
      {canWrite ? (
        <div className="state-actions">
          <button type="button" className="btn btn-save" onClick={onStart} disabled={busy}>
            <span className="ico-inline"><Icon name="plus" /></span>เพิ่มงานแรก
          </button>
          {backupCount > 0 && (
            <button type="button" className="btn btn-primary" onClick={onMigrate} disabled={busy}>
              {busy ? 'กำลังย้ายข้อมูล…' : `ย้ายข้อมูลจากเครื่องนี้ (${backupCount} งาน)`}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            <span className="ico-inline"><Icon name="upload" /></span>นำเข้าไฟล์ .json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onImportFile(f); }}
          />
        </div>
      ) : (
        <p className="state-text">คุณมีสิทธิ์ดูอย่างเดียว ข้อมูลจะแสดงที่นี่เมื่อทีมงานเพิ่มงาน</p>
      )}
    </div>
  );
}
