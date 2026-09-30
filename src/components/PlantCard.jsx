import { useState } from 'react';
import Icon from '../lib/icons.jsx';
import { DONE, DOING, STUCK } from '../lib/data.js';

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

export default function PlantCard({ p, edit, flashId, onEditJob, onAddJob, onEditImpact, onPhoto }) {
  // Top 5 by default; "ดูทั้งหมด" (and edit mode) lists every job so none drop out of sight.
  const [expanded, setExpanded] = useState(false);
  const showAll = edit || expanded || p.rest.some((r) => r.job.id === flashId);
  const rows = showAll ? p.top.concat(p.rest) : p.top;
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
          <button type="button" className="add-btn" onClick={onAddJob}><span className="ico"><Icon name="plus" /></span>เพิ่มงาน</button>
        )}
      </div>

      <div className="jobs">
        {rows.map((row, i) => (
          <div key={row.job.id}>
            {i === 5 && <div className="jobs-divider">งานอื่นๆ นอก Top 5</div>}
            <JobRow row={row} edit={edit} flash={row.job.id === flashId} onEdit={() => onEditJob(row.job)} onPhoto={onPhoto} />
          </div>
        ))}
        {p.more > 0 && !edit && (
          <button type="button" className="jobs-more" onClick={() => setExpanded((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'ย่อเหลือ Top 5' : `+ ดูอีก ${p.more} งาน (${p.moreDone} งานเสร็จแล้ว)`}
          </button>
        )}
      </div>
    </article>
  );
}
