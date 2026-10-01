import { useState } from 'react';
import Icon from '../lib/icons.jsx';
import { DONE, DOING, MAX_JOBS_PER_PLANT, STUCK } from '../lib/data.js';
import { GroupSummary } from './Backlog.jsx';

const R = 40;
const C = 2 * Math.PI * R;

function Donut({ done, doing, stuck, total, pct }) {
  const n = total || 1;
  const seg = (v, off) => ({ strokeDasharray: `${(C * v) / n} ${C}`, strokeDashoffset: `${(-C * off) / n}` });
  return (
    <div className="donut">
      <svg width="104" height="104" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="oklch(0.93 0.01 250)" strokeWidth="14" />
        <circle cx="50" cy="50" r={R} fill="none" stroke={DONE} strokeWidth="14" {...seg(done, 0)} />
        <circle cx="50" cy="50" r={R} fill="none" stroke={DOING} strokeWidth="14" {...seg(doing, done)} />
        <circle cx="50" cy="50" r={R} fill="none" stroke={STUCK} strokeWidth="14" {...seg(stuck, done + doing)} />
      </svg>
      <div className="donut-label"><span className="donut-pct">{pct}%</span><span className="donut-cap">สำเร็จ</span></div>
    </div>
  );
}

// Makes a div behave as a button only while editing.
const clickable = (edit, fn) =>
  edit
    ? { role: 'button', tabIndex: 0, onClick: fn, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } }
    : {};

function JobRow({ row, edit, flash, onEdit, onPhoto }) {
  const { job } = row;
  return (
    <div id={`job-${job.id}`} className={`job${edit ? ' is-editable' : ''}${flash ? ' is-flash' : ''}`} {...clickable(edit, onEdit)}>
      <span className="job-rank" style={{ background: row.rankBg }}>{row.rank}</span>
      <div className="job-main">
        <div className="job-top">
          <span className="job-issue">{job.issue}</span>
          <span className="tag" style={{ background: row.status.bg, color: row.status.fg }}>{row.status.label}</span>
        </div>
        <span className="job-action">→ {job.action}</span>
        <div className="job-meta">
          {job.wo && <span className="job-wo">{job.wo}</span>}
          {row.cmms && (
            <span className={`cmms-badge${row.cmms.closed ? ' is-closed' : ''}`} title={row.cmms.closed ? 'CMMS ปิดงานนี้แล้ว — พิจารณาเอาออกจาก Top 5' : 'สถานะล่าสุดใน CMMS'}>
              CMMS {row.cmms.status}{row.cmms.closed ? ' · ปิดแล้ว' : ''}
            </span>
          )}
          <span className="job-owner">{job.owner}</span>
          <span className="muted">{job.team}</span>
          <span className="muted nowrap">{row.range}</span>
          <span className="nowrap strong" style={{ color: row.timeColor }}>{row.timeText}</span>
        </div>
        <div className="job-progress">
          <div className="bar"><div className="bar-fill" style={{ width: `${job.progress}%`, background: row.bar }} /></div>
          <span className="job-progress-num">{job.progress}%</span>
        </div>
        <div className="job-blocker">
          <span className="tag tag-icon" style={{ background: row.blocker.solid, color: row.blocker.fg }}>
            <span className="ico"><Icon name={row.blocker.key} /></span>{row.blocker.label}
          </span>
          <span className="job-note">{row.note}</span>
        </div>
        {row.photos.length > 0 && (
          <div className="job-photos">
            {row.photos.map((ph, i) => (
              <button
                type="button"
                key={i}
                className="thumb"
                onClick={(e) => { e.stopPropagation(); onPhoto(ph); }}
                aria-label={`ดูรูป ${ph.caption}`}
              >
                <span className="thumb-img" style={{ backgroundImage: `url("${ph.src}")` }} />
                <span className="thumb-date">{ph.date}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlantCard({ p, edit, flashId, onEditJob, onAddJob, onEditImpact, onPhoto, onOpenBacklog }) {
  // Unfinished Top 5 always shown; finished/other jobs fold behind a chevron (opened for a just-saved job).
  const [expanded, setExpanded] = useState(false);
  const showRest = expanded || p.rest.some((r) => r.job.id === flashId);
  const restLabel = [
    p.moreDone && `เสร็จแล้ว ${p.moreDone} งาน`,
    p.more - p.moreDone && `งานอื่น ${p.more - p.moreDone} งาน`,
    p.wo && `WO ค้างใน CMMS ${p.wo.open} งาน`,
  ].filter(Boolean).join(' · ');
  return (
    <article className="plant" style={{ '--pc': p.color, '--pt': p.tint, '--pd': p.dark }}>
      <div className="plant-head">
        <span className="plant-head-icon"><Icon name="factory" /></span>
        <h3 className="plant-name">{p.name}</h3>
        <span className="plant-total">P1 ทั้งหมด {p.total} งาน</span>
      </div>

      <div className="plant-stats">
        <Donut {...p} />
        <div className="legend">
          <div className="legend-row"><span className="dot" style={{ background: DONE }} /><span className="legend-label">เสร็จแล้ว</span><span className="legend-num">{p.done}</span></div>
          <div className="legend-row"><span className="dot" style={{ background: DOING }} /><span className="legend-label">กำลังทำ</span><span className="legend-num">{p.doing}</span></div>
          <div className="legend-row"><span className="dot" style={{ background: STUCK }} /><span className="legend-label">ค้าง / เกินกำหนด</span><span className="legend-num is-stuck">{p.stuck}</span></div>
        </div>
      </div>

      <div className={`impact${edit ? ' is-editable' : ''}`} {...clickable(edit, onEditImpact)}>
        <div className="impact-title">ผลกระทบต่อโรงไฟฟ้า</div>
        {p.impact.map((line, i) => <div key={i} className="impact-line">• {line}</div>)}
      </div>

      <div className="top5-bar">
        <span>Top 5 P1 · {p.name}</span>
        {edit && (
          p.total >= MAX_JOBS_PER_PLANT
            ? <span className="add-btn is-full" title={`แต่ละโรงมีได้ไม่เกิน ${MAX_JOBS_PER_PLANT} งาน ลบหรือแก้งานเดิมแทน`}>ครบ {MAX_JOBS_PER_PLANT} งาน</span>
            : <button type="button" className="add-btn" onClick={onAddJob}><span className="ico"><Icon name="plus" /></span>เพิ่มงาน</button>
        )}
      </div>

      <div className="jobs">
        {p.top.length === 0 && <div className="jobs-empty">ไม่มีงานค้าง 🎉</div>}
        {p.top.map((row) => (
          <JobRow key={row.job.id} row={row} edit={edit} flash={row.job.id === flashId} onEdit={() => onEditJob(row.job)} onPhoto={onPhoto} />
        ))}
        {(p.more > 0 || p.wo) && (
          <>
            <button
              type="button"
              className={`jobs-toggle${showRest ? ' is-open' : ''}`}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={showRest}
              aria-controls={`rest-${p.id}`}
            >
              <span className="jobs-toggle-chev"><Icon name="chevron" /></span>
              {restLabel}
              <span className="jobs-toggle-hint">{showRest ? 'ซ่อน' : 'กดเพื่อดู'}</span>
            </button>
            {showRest && (
              <div id={`rest-${p.id}`} className="jobs-rest">
                {p.rest.map((row) => (
                  <JobRow key={row.job.id} row={row} edit={edit} flash={row.job.id === flashId} onEdit={() => onEditJob(row.job)} onPhoto={onPhoto} />
                ))}
                {p.wo && (
                  <div className="plant-wo">
                    <div className="plant-wo-head">WO Backlog P1 ใน CMMS · ค้าง {p.wo.open} จาก {p.wo.total} WO</div>
                    <GroupSummary summary={p.wo} />
                    <button type="button" className="linklike" onClick={() => onOpenBacklog(p.id)}>ดูรายการ WO ของ{p.name} →</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
