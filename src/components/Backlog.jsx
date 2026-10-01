import { useEffect, useMemo, useState } from 'react';
import Icon from '../lib/icons.jsx';
import { PLANT_IDS, PLANT_META } from '../lib/data.js';
import { pd, thD } from '../lib/dates.js';
import { STATUS_GROUPS, ageDays, groupOf, isClosedGroup, normWo, summarize } from '../lib/cmms.js';

const PAGE = 50;
const fmtDate = (s) => (s ? `${thD(pd(s))} ${String(pd(s).getFullYear() + 543).slice(2)}` : '–');
const fmtMoney = (n) => (n ? n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '–');

export function GroupChip({ status, small }) {
  const g = groupOf(status);
  return (
    <span className={`cmms-chip${small ? ' is-small' : ''}`} style={{ '--g': g.color }} title={g.label}>
      <i />{small ? status : `${g.label} · ${status}`}
    </span>
  );
}

/** Per-group counts as a compact row of chips (open groups first). */
export function GroupSummary({ summary, active, onToggle }) {
  return (
    <div className="cmms-summary">
      {STATUS_GROUPS.filter((g) => summary.byGroup[g.key]).map((g) => (
        <button
          type="button"
          key={g.key}
          className={`cmms-sum${active?.includes(g.key) ? ' is-on' : ''}${isClosedGroup(g.key) ? ' is-closed' : ''}`}
          style={{ '--g': g.color }}
          onClick={onToggle ? () => onToggle(g.key) : undefined}
          disabled={!onToggle}
          aria-pressed={onToggle ? !!active?.includes(g.key) : undefined}
        >
          <i />{g.label}<b>{summary.byGroup[g.key]}</b>
        </button>
      ))}
    </div>
  );
}

/**
 * The full CMMS WO list: summary, filters, search and a table. In edit mode each WO can be
 * added to Top 5 (⭐). `focus` = { plant, nonce } opens the panel on one plant.
 */
export function BacklogPanel({ backlog, ids, edit, tracked, today, focus, onTrack, onUpload }) {
  const [open, setOpen] = useState(false);
  const [plant, setPlant] = useState('all');
  const [groups, setGroups] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('age');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setPlant(String(focus.plant));
    setGroups([]);
    setLimit(PAGE);
    requestAnimationFrame(() => document.getElementById('wo-backlog')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [focus]);

  const rows = backlog?.rows || [];
  const scope = useMemo(() => rows.filter((r) => ids.includes(r.plant) && (plant === 'all' || r.plant === Number(plant))), [rows, ids, plant]);
  const summary = useMemo(() => summarize(scope), [scope]);
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = scope.filter((r) => {
      const g = groupOf(r.status).key;
      if (groups.length ? !groups.includes(g) : !showClosed && isClosedGroup(g)) return false;
      const hay = `${r.wo} ${r.desc} ${r.location} ${r.asset} ${r.owner} ${r.nextApprove} ${r.status}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).map((r) => ({ ...r, age: ageDays(r, today) }));
    const by = {
      age: (a, b) => (b.age ?? -1) - (a.age ?? -1),
      value: (a, b) => b.value - a.value,
      wo: (a, b) => a.wo.localeCompare(b.wo),
    }[sort];
    return out.sort(by);
  }, [scope, groups, showClosed, q, sort, today]);

  if (!backlog) {
    return (
      <section className="panel backlog" id="wo-backlog">
        <div className="panel-head">WO Backlog P1 จาก CMMS</div>
        <div className="backlog-empty">
          ยังไม่มีข้อมูล WO จาก CMMS
          {edit ? <> · กด <button type="button" className="linklike" onClick={onUpload}>อัปโหลด WO Backlog</button> แล้วเลือกไฟล์ List of Work Orders (.xlsx)</> : ' · ผู้ที่มีรหัสทีมอัปโหลดได้ในโหมดแก้ไข'}
        </div>
      </section>
    );
  }

  const toggleGroup = (k) => { setGroups((gs) => (gs.includes(k) ? gs.filter((x) => x !== k) : gs.concat(k))); setLimit(PAGE); };
  const up = new Date(backlog.uploadedAt);

  return (
    <section className="panel backlog" id="wo-backlog">
      <button type="button" className="panel-head backlog-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`jobs-toggle-chev${open ? ' is-open' : ''}`}><Icon name="chevron" /></span>
        <span>WO Backlog P1 จาก CMMS · ค้าง <b>{summary.open}</b> จาก {summary.total} WO</span>
        <span className="backlog-stamp">ข้อมูล ณ {fmtDate(backlog.uploadedAt.slice(0, 10))} {String(up.getHours()).padStart(2, '0')}:{String(up.getMinutes()).padStart(2, '0')} น.{backlog.fileName ? ` · ${backlog.fileName}` : ''}</span>
      </button>
      <div className="backlog-body">
        <GroupSummary summary={summary} active={groups} onToggle={open ? toggleGroup : undefined} />
        {!open && <button type="button" className="linklike backlog-open" onClick={() => setOpen(true)}>กดเพื่อดูรายการ WO ทั้งหมด</button>}
        {open && (
          <>
            <div className="backlog-tools">
              <select aria-label="โรงไฟฟ้า" value={plant} onChange={(e) => { setPlant(e.target.value); setLimit(PAGE); }}>
                <option value="all">ทุกโรงที่เลือก</option>
                {PLANT_IDS.filter((p) => ids.includes(p)).map((p) => <option key={p} value={p}>โรงไฟฟ้า {p}</option>)}
              </select>
              <input type="search" aria-label="ค้นหา WO" placeholder="ค้นหา เลข WO, คำอธิบาย, Asset, ชื่อ…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
              <select aria-label="เรียงตาม" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="age">ค้างนานสุดก่อน</option>
                <option value="value">มูลค่างานสูงสุดก่อน</option>
                <option value="wo">เลข WO</option>
              </select>
              <label className="backlog-check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} disabled={groups.length > 0} /> รวมงานเสร็จ/ปิดแล้ว</label>
              {groups.length > 0 && <button type="button" className="linklike" onClick={() => setGroups([])}>ล้างตัวกรองสถานะ</button>}
            </div>
            <div className="backlog-count">แสดง {Math.min(limit, list.length)} จาก {list.length} WO</div>
            <div className="backlog-table-wrap">
              <table className="backlog-table">
                <thead>
                  <tr>
                    <th>เลข WO</th><th>รายละเอียด</th><th>โรง</th><th>สถานะ CMMS</th><th>Target Start</th><th className="num">ค้าง (วัน)</th><th>ผู้รับผิดชอบ / รออนุมัติ</th><th className="num">มูลค่า (บาท)</th>{edit && <th>Top 5</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, limit).map((r) => {
                    const isTracked = tracked.has(normWo(r.wo));
                    return (
                      <tr key={r.wo} className={isTracked ? 'is-tracked' : ''}>
                        <td className="mono">{r.wo}{r.parent && <div className="sub">ย่อยของ {r.parent}</div>}</td>
                        <td className="desc">{r.desc}<div className="sub">{[r.location, r.asset].filter(Boolean).join(' · ')}</div></td>
                        <td><span className="plant-dot" style={{ '--pc': PLANT_META[r.plant].color }}>{r.plant}</span></td>
                        <td><GroupChip status={r.status} /></td>
                        <td className="nowrap">{fmtDate(r.targetStart)}</td>
                        <td className={`num${r.age > 180 ? ' is-old' : ''}`}>{r.age ?? '–'}</td>
                        <td>{r.owner || '–'}{r.nextApprove && <div className="sub">รออนุมัติ: {r.nextApprove}</div>}</td>
                        <td className="num">{fmtMoney(r.value)}</td>
                        {edit && (
                          <td>
                            {isTracked
                              ? <span className="tracked-tag">⭐ ติดตามอยู่</span>
                              : <button type="button" className="track-btn" onClick={() => onTrack(r)}>☆ ติดตาม</button>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {list.length === 0 && <tr><td colSpan={edit ? 9 : 8} className="backlog-none">ไม่พบ WO ตามตัวกรอง</td></tr>}
                </tbody>
              </table>
            </div>
            {list.length > limit && <button type="button" className="btn btn-ghost backlog-more" onClick={() => setLimit((n) => n + PAGE)}>แสดงเพิ่มอีก {Math.min(PAGE, list.length - limit)} WO</button>}
          </>
        )}
      </div>
    </section>
  );
}

/** Preview before replacing the backlog snapshot. */
export function BacklogUploadDialog({ fileName, parsed, current, busy, onConfirm, onCancel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  const before = new Set((current?.rows || []).map((r) => normWo(r.wo)));
  const after = new Set(parsed.rows.map((r) => normWo(r.wo)));
  const added = [...after].filter((w) => !before.has(w)).length;
  const gone = [...before].filter((w) => !after.has(w)).length;
  const perPlant = PLANT_IDS.map((p) => ({ p, s: summarize(parsed.rows.filter((r) => r.plant === p)) }));

  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="อัปโหลด WO Backlog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--navy)' }}><span className="modal-title">อัปโหลด WO Backlog จาก CMMS</span></div>
        <div className="modal-body-col import-body">
          <p className="import-file">{fileName}</p>
          <div className="import-stats"><span><b>{parsed.rows.length}</b> WO ของโรง 5, 10, 6, 11</span>{current && <span>เทียบกับข้อมูลเดิม: ใหม่ <b>{added}</b> · หายไป (ปิด/ย้าย) <b>{gone}</b></span>}</div>
          <table className="upload-plants">
            <thead><tr><th>โรง</th><th className="num">ทั้งหมด</th><th className="num">ค้าง</th><th className="num">เสร็จ/ปิด</th></tr></thead>
            <tbody>{perPlant.map(({ p, s }) => <tr key={p}><td>โรงไฟฟ้า {p}</td><td className="num">{s.total}</td><td className="num">{s.open}</td><td className="num">{s.total - s.open}</td></tr>)}</tbody>
          </table>
          {parsed.skipped.length > 0 && <p className="import-note">ข้าม WO ของโรงอื่น: {parsed.skipped.map((s) => `${s.plant} (${s.count})`).join(', ')}</p>}
          {parsed.unknownStatuses.length > 0 && <p className="import-note is-bad">สถานะที่ยังไม่ได้จัดกลุ่ม (จะแสดงเป็น "อื่นๆ"): {parsed.unknownStatuses.join(', ')}</p>}
          <div className="import-summary">ข้อมูล WO Backlog เดิมจะถูกแทนที่ทั้งชุด · งานใน Top 5 ไม่เปลี่ยน แต่จะแสดงสถานะ CMMS ล่าสุด</div>
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-foot-right">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
            <button type="button" className="btn btn-save" disabled={busy || parsed.rows.length === 0} onClick={onConfirm}>{busy ? 'กำลังอัปโหลด…' : `อัปโหลด ${parsed.rows.length} WO`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
