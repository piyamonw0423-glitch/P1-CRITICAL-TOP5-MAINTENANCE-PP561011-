import { useEffect, useRef, useState } from 'react';
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

function JobRow({ row, edit, flash, checked, onCheck, onEdit, onPhoto, onMove, drag }) {
  const { job } = row;
  const cls = `job${edit ? ' is-editable' : ''}${checked ? ' is-selected' : ''}${flash ? ' is-flash' : ''}${drag?.active ? ' is-dragging' : ''}${drag?.mark ? ` drop-${drag.mark}` : ''}`;
  return (
    <div
      id={`job-${job.id}`}
      className={cls}
      data-open-id={onMove ? job.id : undefined}
      style={drag?.active ? { transform: `translateY(${drag.dy}px)` } : undefined}
      {...clickable(edit, onEdit)}
    >
      {edit && (
        // Tick to select for bulk delete; clicks here must not open the edit form.
        <label className="job-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`เลือกงาน ${job.wo || ''} ${job.issue}`} />
        </label>
      )}
      {edit && onMove ? (
        // ▲▼ change the job's place in its ranked list (only open jobs are ranked).
        <span className="job-order" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <button type="button" className="order-btn" disabled={!onMove.up} onClick={onMove.up} aria-label={`เลื่อน ${job.issue} ขึ้น`}>▲</button>
          <span className="job-rank drag-handle" style={{ background: row.rankBg }} onPointerDown={onMove.drag} title="ลากเพื่อเปลี่ยนลำดับ">{row.rank}</span>
          <button type="button" className="order-btn" disabled={!onMove.down} onClick={onMove.down} aria-label={`เลื่อน ${job.issue} ลง`}>▼</button>
          <span className="drag-grip drag-handle" onPointerDown={onMove.drag} title="ลากเพื่อเปลี่ยนลำดับ" aria-hidden="true">⠿</span>
        </span>
      ) : (
        <span className="job-rank" style={{ background: row.rankBg }}>{row.rank}</span>
      )}
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

export default function PlantCard({ p, edit, flashId, selected, onSelect, onEditJob, onAddJob, onReorder, onEditImpact, onPhoto, onOpenBacklog }) {
  // Two ranked lists per plant (machine risk / daily work), one shown at a time.
  const [tab, setTab] = useState(p.lists[0].k);
  // Unfinished top 5 always shown; extra and finished jobs fold behind a chevron (opened for a just-saved job).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const home = p.lists.find((l) => l.top.concat(l.rest).some((r) => r.job.id === flashId));
    if (home) setTab(home.k);
  }, [flashId]); // eslint-disable-line react-hooks/exhaustive-deps
  const L = p.lists.find((l) => l.k === tab) || p.lists[0];
  const showRest = expanded || L.rest.some((r) => r.job.id === flashId);
  const restLabel = [
    L.moreOpen && `อันดับ ${L.top.length + 1}+ อีก ${L.moreOpen} งาน`,
    L.moreDone && `เสร็จแล้ว ${L.moreDone} งาน`,
    p.wo && `WO ค้างใน CMMS ${p.wo.open} งาน`,
  ].filter(Boolean).join(' · ');
  const ids = p.jobIds;
  const nSel = ids.filter((id) => selected?.has(id)).length;
  // Swap with the neighbour in the open-job order and save the whole list's new ranks.
  const move = (id, dir) => {
    const order = [...L.openIds];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return null;
    return () => { [order[i], order[j]] = [order[j], order[i]]; onReorder(order); };
  };
  // Drag a job by its rank badge or grip (pointer events: mouse, pen and touch). Visible open rows are always
  // a prefix of the list's order, so the drop position among them maps straight onto L.openIds.
  const cardRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id, dy, target, mark }
  const startDrag = (id) => (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const y0 = e.clientY;
    const place = (y) => {
      const others = [...cardRef.current.querySelectorAll('[data-open-id]')].filter((el) => el.dataset.openId !== id);
      const k = others.filter((el) => { const r = el.getBoundingClientRect(); return y > r.top + r.height / 2; }).length;
      const ids = others.map((el) => el.dataset.openId);
      return { k, ids, target: ids[k] ?? ids[ids.length - 1], mark: ids.length ? (k < ids.length ? 'before' : 'after') : null };
    };
    setDrag({ id, dy: 0 });
    const move = (ev) => {
      if (ev.clientY < 60) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
      const { target, mark } = place(ev.clientY);
      setDrag({ id, dy: ev.clientY - y0, target, mark });
    };
    const end = (ev, drop) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      setDrag(null);
      if (!drop) return;
      const { k, ids } = place(ev.clientY);
      const hidden = L.openIds.filter((x) => x !== id && !ids.includes(x));
      const order = [...ids.slice(0, k), id, ...ids.slice(k), ...hidden];
      if (order.join() !== L.openIds.join()) onReorder(order);
    };
    const onUp = (ev) => end(ev, true);
    const onCancel = (ev) => end(ev, false);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  };
  const rowProps = (row) => ({
    row,
    edit,
    flash: row.job.id === flashId,
    checked: !!selected?.has(row.job.id),
    onCheck: (on) => onSelect([row.job.id], on),
    onEdit: () => onEditJob(row.job),
    onMove: row.job.status !== 'done' ? { up: move(row.job.id, -1), down: move(row.job.id, 1), drag: startDrag(row.job.id) } : null,
    drag: drag && (drag.id === row.job.id ? { active: true, dy: drag.dy } : drag.target === row.job.id ? { mark: drag.mark } : null),
    onPhoto,
  });
  return (
    <article ref={cardRef} className="plant" style={{ '--pc': p.color, '--pt': p.tint, '--pd': p.dark }}>
      <div className="plant-head">
        <span className="plant-head-icon"><Icon name="factory" /></span>
        <h3 className="plant-name">{p.name}</h3>
        <span className="plant-total">BD {p.lists[0].total} · ประจำวัน {p.lists[1].total}</span>
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

      <div className="list-tabs" role="tablist" aria-label={`รายการงานของ${p.name}`}>
        {p.lists.map((l) => (
          <button
            key={l.k}
            type="button"
            role="tab"
            aria-selected={l.k === L.k}
            className={`list-tab${l.k === L.k ? ' is-on' : ''}`}
            onClick={() => { setTab(l.k); setExpanded(false); }}
          >
            {l.tab}<span className="list-tab-n">{l.total}</span>
          </button>
        ))}
      </div>

      <div className="top5-bar">
        <span>Top 5 {L.label}</span>
        {edit && ids.length > 0 && (
          <label className="sel-all">
            <input
              type="checkbox"
              checked={nSel === ids.length}
              ref={(el) => { if (el) el.indeterminate = nSel > 0 && nSel < ids.length; }}
              onChange={(e) => onSelect(ids, e.target.checked)}
            />
            เลือกทั้งโรง{nSel ? ` (${nSel})` : ''}
          </label>
        )}
        {edit && (
          p.total >= MAX_JOBS_PER_PLANT
            ? <span className="add-btn is-full" title={`แต่ละโรงมีได้ไม่เกิน ${MAX_JOBS_PER_PLANT} งาน ลบหรือแก้งานเดิมแทน`}>ครบ {MAX_JOBS_PER_PLANT} งาน</span>
            : <button type="button" className="add-btn" onClick={() => onAddJob(L.k)}><span className="ico"><Icon name="plus" /></span>เพิ่มงาน</button>
        )}
      </div>

      <div className="jobs">
        {L.top.length === 0 && (
          <div className="jobs-empty">
            {L.total === 0
              ? <>ยังไม่มีงานใน Top 5 {L.tab}{p.wo ? <> · เลือกจาก <button type="button" className="linklike" onClick={() => onOpenBacklog(p.id)}>WO Backlog</button> (กด ☆ ติดตาม ในโหมดแก้ไข)</> : ''}</>
              : 'ไม่มีงานค้าง 🎉'}
          </div>
        )}
        {L.top.map((row) => (
          <JobRow key={row.job.id} {...rowProps(row)} />
        ))}
        {(L.more > 0 || p.wo) && (
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
                {L.rest.map((row) => (
                  <JobRow key={row.job.id} {...rowProps(row)} />
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
