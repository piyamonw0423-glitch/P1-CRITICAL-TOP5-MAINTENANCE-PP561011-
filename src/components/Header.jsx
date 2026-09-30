import { useRef } from 'react';
import Icon from '../lib/icons.jsx';
import { hhmm, thD } from '../lib/dates.js';

export function Header({ now, updatedAt, updatedBy, editMode, canEdit, readOnly, onToggleEdit }) {
  const up = updatedAt ? new Date(updatedAt) : null;
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark"><Icon name="factory" /></div>
        <div className="brand-text">
          <h1 className="brand-title"><span className="brand-hot">P1 CRITICAL TOP5</span> MAINTENANCE DASHBOARD</h1>
          <div className="brand-sub">สรุปสถานะงานซ่อมเร่งด่วน (Priority 1) · โรงไฟฟ้า 5, 10, 6 และ 11</div>
        </div>
      </div>
      <div className="header-actions">
        <div className="date-chip">
          <span className="date-chip-icon"><Icon name="calendar" /></span>
          <div className="date-chip-text">
            <span className="date-chip-now">{thD(now)} {now.getFullYear() + 543} · {hhmm(now)} น.</span>
            <span className="date-chip-updated">
              {up ? `อัปเดตล่าสุด ${thD(up)} ${hhmm(up)} น.${updatedBy ? ` · ${updatedBy}` : ''}` : 'ยังไม่มีการอัปเดต'}
            </span>
          </div>
        </div>
        {canEdit && (
          <button type="button" className={`edit-toggle${editMode ? ' is-on' : ''}`} onClick={onToggleEdit}>
            <span className="ico"><Icon name="pencil" /></span>
            {editMode ? 'เสร็จสิ้นการแก้ไข' : 'อัปเดตงานประจำวัน'}
          </button>
        )}
        {readOnly && <span className="readonly-chip">ดูอย่างเดียว</span>}
      </div>
    </header>
  );
}

export function EditBar({ shared, onExport, onImportFile, onReset }) {
  const fileRef = useRef(null);
  return (
    <div className="edit-bar">
      <span>
        โหมดแก้ไข · คลิกที่งานเพื่ออัปเดตความคืบหน้า คลิกกล่อง "ผลกระทบ" เพื่อแก้ข้อความ ·{' '}
        {shared ? 'กดบันทึกแล้วทุกคนที่เปิดลิงก์นี้จะเห็นทันที' : 'ข้อมูลบันทึกในเครื่องนี้อัตโนมัติ'}
      </span>
      <div className="edit-bar-actions">
        <button type="button" className="pill-btn" onClick={onExport}><span className="ico"><Icon name="download" /></span>{shared ? 'ส่งออกไฟล์ (สำรองข้อมูล)' : 'ส่งออกไฟล์ (แชร์ทีม)'}</button>
        <button type="button" className="pill-btn" onClick={() => fileRef.current?.click()}><span className="ico"><Icon name="upload" /></span>นำเข้าไฟล์</button>
        {onReset && <button type="button" className="pill-btn is-danger" onClick={onReset}>คืนค่าข้อมูลตัวอย่าง</button>}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (f) onImportFile(f);
          }}
        />
      </div>
    </div>
  );
}
