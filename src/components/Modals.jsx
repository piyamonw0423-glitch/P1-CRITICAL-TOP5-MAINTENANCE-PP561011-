import { useEffect, useState } from 'react';
import Icon from '../lib/icons.jsx';
import { PLANT_META } from '../lib/data.js';
import { iso, pd, thD, today0 } from '../lib/dates.js';
import { shrinkImage } from '../lib/photos.js';

const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 200000;

function useEscape(fn) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') fn(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

function Shell({ color, title, onClose, children }) {
  useEscape(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: color }}>
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="ปิด"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Footer({ busy, onDelete, onClose, onSave }) {
  return (
    <div className="modal-foot">
      <div>{onDelete && <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>ลบงานนี้</button>}</div>
      <div className="modal-foot-right">
        <button type="button" className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn btn-save" onClick={onSave} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>
    </div>
  );
}

export function ImpactModal({ pid, impact, busy, onSave, onClose }) {
  const [text, setText] = useState(impact.join('\n'));
  return (
    <Shell color={PLANT_META[pid].color} title={`ผลกระทบ · โรงไฟฟ้า ${pid}`} onClose={onClose}>
      <div className="modal-body-col">
        <label className="field-label" htmlFor="impact-text">ผลกระทบต่อโรงไฟฟ้า (1 บรรทัด = 1 ข้อ)</label>
        <textarea id="impact-text" className="field field-area" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      <Footer busy={busy} onClose={onClose} onSave={() => onSave(text.split('\n').map((s) => s.trim()).filter(Boolean))} />
    </Shell>
  );
}

function Field({ label, wide, children }) {
  return (
    <label className={`field-wrap${wide ? ' is-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function JobModal({ initial, busy, onSave, onDelete, onClose }) {
  const [d, setD] = useState(() => ({ photos: [], ...initial, plant: String(initial.plant) }));
  const [err, setErr] = useState('');

  const set = (k) => (e) => {
    const v = e.target.value;
    setD((s) => {
      const n = { ...s, [k]: v };
      if (k === 'progress') {
        n.progress = +v;
        if (n.progress >= 100) n.status = 'done';
        else if (n.status === 'done') n.status = 'doing';
        else if (n.progress > 0 && n.status === 'pending') n.status = 'doing';
      }
      if (k === 'status' && v === 'done') n.progress = 100;
      if (k === 'rank') n.rank = v === '' ? '' : Math.max(1, parseInt(v, 10) || 1);
      return n;
    });
  };

  const addPhotos = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const room = MAX_PHOTOS - d.photos.length;
    const date = iso(today0());
    const out = [];
    for (const f of files.slice(0, room)) {
      try {
        let src = await shrinkImage(f);
        // Shared storage caps each record at 256 KiB, so re-compress large photos.
        if (src.length > MAX_PHOTO_CHARS) src = await shrinkImage(f, 560, 0.6);
        if (src.length > MAX_PHOTO_CHARS) src = await shrinkImage(f, 420, 0.5);
        out.push({ src, date });
      } catch { /* skip unreadable file */ }
    }
    setD((s) => ({ ...s, photos: s.photos.concat(out).slice(0, MAX_PHOTOS) }));
  };

  const save = () => {
    if (!d.issue.trim()) { setErr('กรุณากรอกปัญหาเครื่องจักรก่อนบันทึก'); return; }
    onSave({ ...d, plant: +d.plant, rank: Math.max(1, +d.rank || 1), progress: +d.progress, id: d.id || `j${Date.now()}` });
  };

  const color = (PLANT_META[d.plant] || PLANT_META[5]).color;

  return (
    <Shell color={color} title={d.id ? 'อัปเดตงาน' : 'เพิ่มงาน P1 ใหม่'} onClose={onClose}>
      <div className="modal-grid">
        <Field label="โรงไฟฟ้า">
          <select className="field" value={d.plant} onChange={set('plant')}>
            <option value="5">โรงไฟฟ้า 5</option><option value="10">โรงไฟฟ้า 10</option><option value="6">โรงไฟฟ้า 6</option><option value="11">โรงไฟฟ้า 11</option>
          </select>
        </Field>
        <Field label="ลำดับความสำคัญ (1 = สำคัญสุด)">
          <input className="field" type="number" min="1" value={d.rank} onChange={set('rank')} />
        </Field>
        <Field label="เลข WO (Work Order)">
          <input className="field" value={d.wo || ''} onChange={set('wo')} placeholder="เช่น WO-P5-001" />
        </Field>
        <Field label="1. ปัญหาเครื่องจักร" wide>
          <input className={`field${err ? ' is-invalid' : ''}`} value={d.issue} onChange={(e) => { setErr(''); set('issue')(e); }} placeholder="เช่น Boiler Feed Pump B สั่นสูง" autoFocus={!d.id} aria-invalid={!!err} />
          {err && <span className="field-error">{err}</span>}
        </Field>
        <Field label="2. แนวทางดำเนินงาน" wide>
          <input className="field" value={d.action} onChange={set('action')} />
        </Field>
        <Field label="3. ผู้รับผิดชอบ"><input className="field" value={d.owner} onChange={set('owner')} /></Field>
        <Field label="แผนก / ทีม"><input className="field" value={d.team} onChange={set('team')} /></Field>
        <Field label="4. วันเริ่ม"><input className="field field-date" type="date" value={d.start} onChange={set('start')} /></Field>
        <Field label="วันกำหนดเสร็จ"><input className="field field-date" type="date" value={d.end} onChange={set('end')} /></Field>
        <Field label={`5. ความคืบหน้า · ${d.progress}%`} wide>
          <input className="range" type="range" min="0" max="100" step="5" value={d.progress} onChange={set('progress')} />
        </Field>
        <Field label="สถานะ">
          <select className="field" value={d.status} onChange={set('status')}>
            <option value="pending">ยังไม่เริ่ม</option><option value="doing">กำลังทำ</option><option value="done">เสร็จแล้ว</option>
          </select>
        </Field>
        <Field label="6. ติดปัญหาอะไร">
          <select className="field" value={d.blocker} onChange={set('blocker')}>
            <option value="none">ไม่ติดปัญหา</option><option value="part">รออะไหล่</option><option value="permit">รอ Permit</option><option value="manpower">ขาดกำลังคน</option>
            <option value="shutdown">รอหยุดเครื่อง</option><option value="vendor">รอผู้รับเหมา</option><option value="budget">รออนุมัติงบ</option>
          </select>
        </Field>
        <Field label="รายละเอียดปัญหาหน้างาน (ทำไมทำไม่ได้)" wide>
          <textarea className="field field-area" rows={2} value={d.note} onChange={set('note')} />
        </Field>
        <div className="field-wrap is-wide">
          <span className="field-label">7. รูปภาพหน้างาน (สูงสุด 4 รูป · ลงวันที่ถ่ายอัตโนมัติ)</span>
          <div className="photo-grid">
            {d.photos.map((ph, i) => (
              <div key={i} className="photo">
                <div className="photo-img" style={{ backgroundImage: `url("${ph.src}")` }} />
                <span className="photo-date">{thD(pd(ph.date))}</span>
                <button
                  type="button"
                  className="photo-remove"
                  aria-label="ลบรูป"
                  onClick={() => setD((s) => ({ ...s, photos: s.photos.filter((_, k) => k !== i) }))}
                ><Icon name="x" /></button>
              </div>
            ))}
            {d.photos.length < MAX_PHOTOS && (
              <label className="photo-add">
                <span className="photo-add-icon"><Icon name="camera" /></span>
                {d.photos.length ? 'เพิ่มรูป' : 'อัปโหลดรูป'}
                <input type="file" accept="image/*" multiple hidden onChange={addPhotos} />
              </label>
            )}
          </div>
        </div>
      </div>
      <Footer busy={busy} onDelete={d.id ? onDelete : null} onClose={onClose} onSave={save} />
    </Shell>
  );
}

export function Lightbox({ src, caption, onClose }) {
  useEscape(onClose);
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={caption} />
      <span className="lightbox-caption">{caption}</span>
    </div>
  );
}
