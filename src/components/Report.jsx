import { useEffect, useMemo, useState } from 'react';
import { ageDays, effGroup, insertedWos, withEntered, isClosedGroup, latestSeen, normWo, openSnapshot, roundTotals, scopeMatch, statTotals, teamOf, wlOptions } from '../lib/cmms.js';
import WlSelect, { toggleWl, wlLabel } from './WlSelect.jsx';
import { pd, thD } from '../lib/dates.js';
import { plantNumbers, roundLabel } from '../lib/roundReport.js';
import { analysisText } from '../lib/analysis.js';

// Daily CMMS performance: what was new / started / finished / closed on a day, the open backlog by team,
// a 14-day trend, the oldest open WOs and a text summary to forward on LINE.
export const START = 'oklch(0.55 0.15 255)';
export const CLOSE = 'oklch(0.62 0.16 150)';
const LINE = 'oklch(0.45 0.06 258)';

const hm = (s) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayLabel = (s) => thD(pd(s));
// Phones get a narrower chart canvas (and fewer days) so labels stay readable.
function useNarrow() {
  const q = '(max-width: 600px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
const signed = (n) => (n > 0 ? `+${n}` : String(n));

// A WO list that stays short: a one-line header (count + per-plant counts) that folds open,
// then compact one-line rows, the first few only until "ดูทั้งหมด".
const FOLD_FIRST = 5;
function FoldList({ title, note, items, tone = '', render, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const perPlant = [5, 10, 6, 11].map((p) => [p, items.filter((x) => Number(x.plant) === p).length]).filter(([, n]) => n);
  const shown = all ? items : items.slice(0, FOLD_FIRST);
  return (
    <div className="fold">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fold-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <b>{title}</b> <span className="fold-count">{items.length} WO</span>
        <span className="fold-plants">{perPlant.map(([p, n]) => <span key={p}>PP{p} {n}</span>)}</span>
      </button>
      {open && (
        <>
          {note && <div className="fold-note muted">{note}</div>}
          <ol className={`rep-oldest rep-compact ${tone}`}>{shown.map(render)}</ol>
          {items.length > FOLD_FIRST && (
            <button type="button" className="fold-more" onClick={() => setAll(!all)}>{all ? 'ย่อ' : `ดูทั้งหมด ${items.length} WO`}</button>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`rep-tile${tone ? ` is-${tone}` : ''}`}>
      <span className="rep-tile-label">{label}</span>
      <span className="rep-tile-value">{value}</span>
      {sub && <span className="rep-tile-sub">{sub}</span>}
    </div>
  );
}

// Grouped bars, Start vs CLOSED per day (one scale, counts).
// Also used by the yearly history report (labels/names overridable; `label` on an item replaces the date).
export function FlowChart({ days, onPick, W = 560, names = ['เริ่มงาน', 'CLOSED', 'คงค้าง'] }) {
  const [hover, setHover] = useState(null);
  const H = 190, L = 30, R = 8, T = 12, B = 26;
  const max = Math.max(4, ...days.flatMap((d) => [d.started, d.closed]));
  const band = (W - L - R) / Math.max(1, days.length);
  const bw = Math.max(4, Math.min(16, band * 0.32));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bar = (x, v) => {
    if (!v) return '';
    const top = y(v), base = y(0), r = Math.min(4, (base - top) / 2, bw / 2);
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
  };
  const ticks = [0, Math.round(max / 2), max];
  const h = hover != null ? days[hover] : null;
  return (
    <div className="rep-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="เริ่มงานและปิดงานต่อวัน">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="oklch(0.93 0.01 250)" />
            <text x={L - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="oklch(0.55 0.03 258)">{v}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = L + band * i + band / 2;
          return (
            <g key={d.date} opacity={hover == null || hover === i ? 1 : 0.45}>
              <path d={bar(cx - bw - 1, d.started)} fill={START} />
              <path d={bar(cx + 1, d.closed)} fill={CLOSE} />
              {(i === days.length - 1 || days.length <= 7) && (
                <>
                  {d.started > 0 && <text x={cx - bw / 2 - 1} y={y(d.started) - 4} fontSize="10.5" textAnchor="middle" fill="oklch(0.35 0.04 258)">{d.started}</text>}
                  {d.closed > 0 && <text x={cx + bw / 2 + 1} y={y(d.closed) - 4} fontSize="10.5" textAnchor="middle" fill="oklch(0.35 0.04 258)">{d.closed}</text>}
                </>
              )}
              {(days.length <= 10 || (days.length - 1 - i) % 2 === 0) && (
                <text x={cx} y={H - 8} fontSize="11" textAnchor="middle" fill="oklch(0.45 0.04 258)">{d.label || dayLabel(d.date)}</text>
              )}
              <rect
                x={L + band * i} y={T} width={band} height={H - T - B + 4} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(d.date)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="rep-tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%` }}>
          <b>{h.label || dayLabel(h.date)}</b>
          <span><i style={{ background: START }} />{names[0]} {h.started}</span>
          <span><i style={{ background: CLOSE }} />{names[1]} {h.closed}</span>
          <span className="muted">{names[2]} {h.open}</span>
        </div>
      )}
    </div>
  );
}

// Open backlog per day (its own chart: different scale from the daily flow).
export function OpenChart({ days, W = 560, name = 'คงค้าง' }) {
  const [hover, setHover] = useState(null);
  const H = 124, L = 34, R = 10, T = 20, B = 22;
  const vals = days.map((d) => d.open);
  const lo = Math.max(0, Math.min(...vals) - 5), hi = Math.max(...vals) + 5;
  const x = (i) => L + (days.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (days.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const h = hover != null ? days[hover] : null;
  return (
    <div className="rep-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="WO คงค้างต่อวัน">
        {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="oklch(0.93 0.01 250)" />
            <text x={L - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="oklch(0.55 0.03 258)">{v}</text>
          </g>
        ))}
        <polyline points={days.map((d, i) => `${x(i)},${y(d.open)}`).join(' ')} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
        {days.map((d, i) => (
          <g key={d.date}>
            <circle cx={x(i)} cy={y(d.open)} r={hover === i ? 5 : 4} fill={LINE} stroke="white" strokeWidth="2" />
            {i === days.length - 1 && (
              // Label on the side away from the incoming line (below when the backlog fell, above when it rose).
              <text x={x(i) - 6} y={i > 0 && days[i - 1].open > d.open ? y(d.open) + 16 : y(d.open) - 9} fontSize="11" textAnchor="end" fill="oklch(0.3 0.04 258)" fontWeight="700">{d.open}</text>
            )}
            <rect x={x(i) - 14} y={T} width={28} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="oklch(0.8 0.02 258)" strokeDasharray="3 3" />}
      </svg>
      {h && (
        <div className="rep-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{h.label || dayLabel(h.date)}</b>
          <span>{name} {h.open} WO</span>
          {h.old != null && <span className="muted">ค้างเกิน 30 วัน {h.old}</span>}
        </div>
      )}
    </div>
  );
}

export default function DailyReport({ stats, backlog, ids, today, plantLabel }) {
  const days = stats || [];
  const [date, setDate] = useState(null);
  const [team, setTeam] = useState([]); // selected WO_Worklocation codes, [] = all
  const [copied, setCopied] = useState('');
  const narrow = useNarrow();
  const span = narrow ? 7 : 14;
  const cw = narrow ? 340 : 560;
  const picked = days.find((d) => d.date === date) || days.at(-1);
  // Open snapshots saved before Oct 2026 are keyed plant|team only; for the latest day rebuild it from the
  // current backlog so the WO_Worklocation filter shows real open counts right away.
  const legacySnap = (d) => Object.keys(d?.open || {}).some((k) => k.split('|').length < 3);
  const cur = useMemo(() => {
    const isLatest = !!picked && picked === days.at(-1);
    const d = isLatest && legacySnap(picked) && backlog?.rows?.length ? { ...picked, open: openSnapshot(backlog.rows, today) } : picked;
    return withEntered(d, backlog, isLatest); // "entered the backlog" for the latest day comes from the WO list itself
  }, [picked, days, backlog, today]);
  const idx = picked ? days.indexOf(picked) : -1;
  const prev = idx > 0 ? days[idx - 1] : null;
  const tm = team.length ? team : null;
  const byWo = useMemo(() => new Map((backlog?.rows || []).map((r) => [String(r.wo), r])), [backlog]);
  const wlOf = (wo) => byWo.get(String(wo))?.workLoc || ''; // for events recorded before tuples carried the code
  const tot = statTotals(cur, ids, tm, wlOf);
  const prevTot = prev ? statTotals(prev, ids, tm, wlOf) : null;

  const trend = days.slice(Math.max(0, idx - span + 1), idx + 1).map((d) => {
    const s = statTotals(d === picked ? cur : d, ids, tm, wlOf);
    return { date: d.date, started: s.started, closed: s.closed, open: s.open, old: s.a90 + s.aMore };
  });

  const seenWl = useMemo(() => (backlog?.rows || []).map((r) => r.workLoc), [backlog]);
  const byTeam = wlOptions(seenWl).map((o) => ({ k: o.code, label: o.code, team: o.team, ...statTotals(cur, ids, o.code, wlOf) }));

  // Oldest open WOs from the current snapshot (the "still not closed" list for team leads).
  const latest = useMemo(() => latestSeen(backlog?.rows), [backlog]);
  const oldest = useMemo(() => (backlog?.rows || [])
    .filter((r) => ids.includes(r.plant) && scopeMatch(tm, r.team || teamOf(r.workLoc), r.workLoc) && !isClosedGroup(effGroup(r, latest)))
    .map((r) => ({ ...r, age: ageDays(r, today) ?? 0 }))
    .sort((a, b) => b.age - a.age), [backlog, ids, tm, today, latest]);
  // WOs that dropped out of the file on this day and were counted as CLOSED — the list to check in the CMMS.
  const rounds = roundTotals(cur, ids, tm, wlOf);
  const oldSnap = !!tm && legacySnap(cur); // older days cannot be split by work location
  const inScope = ([wo, p, t, , , wl]) => ids.includes(Number(p)) && t !== 'OTHER' && scopeMatch(tm, t, wl || wlOf(wo));
  const ins = insertedWos(cur);
  const toItem = ([wo, plant, t, at]) => ({ wo, plant, team: t, at, mid: ins.has(normWo(wo)), row: byWo.get(String(wo)) });
  const byInsert = (a, b) => (b.mid - a.mid) || String(a.wo).localeCompare(String(b.wo));
  // Opened on this day = Actual Start that day (⚡ = also a new WO in the file: inserted during the day).
  // Stats saved before Oct 2026 have no "opened" list; their new-WO list stands in.
  const opened = (cur?.opened || cur?.new || []).filter(inScope).map(toItem).sort(byInsert);
  // Entered the backlog today: open now and not in the backlog of the previous file (team's comparison sheet).
  const entered = (cur?.entered || []).filter(inScope).map(toItem)
    .map((f) => ({ ...f, age: f.row ? ageDays(f.row, today) : null }));
  // New WO numbers in the file (can include work started on earlier days, e.g. after a weekend).
  const fresh = (cur?.new || []).filter(inScope)
    .map(([wo, plant, t, at, mid]) => ({ wo, plant, team: t, at, mid: mid === 1, row: byWo.get(String(wo)) }))
    .sort((a, b) => (b.mid - a.mid) || String(b.at || '').localeCompare(String(a.at || '')));
  // Closed by the CMMS Status (column L) on this day — confirmed, unlike the "not found in file" list.
  const assumedSet = new Set((cur?.assumed || []).map((t) => String(t[0])));
  const closedByStatus = (cur?.closed || []).filter((t) => inScope(t) && !assumedSet.has(String(t[0])))
    .map(([wo, plant, t]) => ({ wo, plant, team: t, row: byWo.get(String(wo)) }));
  const assumed = (cur?.assumed || [])
    .filter(inScope)
    .map(([wo, plant, t]) => ({ wo, plant, team: t, row: byWo.get(String(wo)) }));

  if (!cur) {
    return (
      <section className="panel rep" aria-label="รายงานประจำวัน">
        <div className="panel-head">รายงานประจำวัน (CMMS)</div>
        <p className="rep-empty">ระบบจะเริ่มบันทึกตัวเลข WO ใหม่ / เริ่มงาน / เสร็จรอปิด / CLOSED / คงค้าง ตั้งแต่การอัปโหลดไฟล์ CMMS ครั้งถัดไป
          (แนะนำวันละ 2 รอบ 09:30 (เริ่มงาน) และ 16:30 (จบงาน) — อัปโหลดหลายครั้งในวันเดียวไม่นับซ้ำ)</p>
      </section>
    );
  }

  const scope = `${plantLabel}${` · ${wlLabel(team)}`}`;
  const openDelta = prevTot && !(tm && legacySnap(prev)) ? tot.open - prevTot.open : null;
  const summary = () => {
    const lines = [
      `📋 รายงาน WO P1 ${dayLabel(cur.date)} ${pd(cur.date).getFullYear() + 543} (อัปเดต ${cur.rounds.map((r) => hm(r.at)).join(', ')} น.)`,
      scope,
      `เปิดงาน (Actual Start วันนี้) ${tot.opened}${tot.inserted ? ` (⚡แทรกระหว่างวัน ${tot.inserted})` : ''} · เข้า Backlog ใหม่ ${tot.entered ?? '-'} · WO ใหม่ในไฟล์ ${tot.new} · เริ่มงาน ${tot.started} · เสร็จรอปิด ${tot.finished} · CLOSED ${tot.closed}${tot.assumed ? ` (Status ${tot.closedStatus} + ไม่พบในไฟล์ ${tot.assumed})` : ''}`,
      ...rounds.filter((r) => !r.baseline).map((r) => `  รอบ ${hm(r.at)} น.: เปิด ${r.opened}${r.inserted ? ` (แทรก ${r.inserted})` : ''} · เริ่ม ${r.started} · เสร็จรอปิด ${r.finished} · CLOSED ${r.closed}`),
      `คงค้าง ${tot.open} WO${openDelta != null ? ` (${signed(openDelta)} จาก ${dayLabel(prev.date)})` : ''} · ค้างเกิน 30 วัน ${tot.a90 + tot.aMore}`,
      ...(tm ? [] : byTeam.filter((t) => t.open || t.closed || t.started).map((t) => `• ${t.label} (${t.team}): ค้าง ${t.open} (เกิน 30 วัน ${t.a90 + t.aMore}) · เริ่ม ${t.started} · ปิด ${t.closed}`)),
      ...(opened.length ? ['', `เปิดงานวันนี้ (Actual Start) ${opened.length} (⚡ = WO ใหม่ในไฟล์ = แทรกระหว่างวัน):`,
        ...opened.slice(0, 15).map((f) => `${f.mid ? '⚡' : '•'} ${f.wo} PP${f.plant} ${f.team} ${f.row?.status || ''} – ${String(f.row?.desc || '').slice(0, 45)}`)] : []),
      ...(closedByStatus.length ? ['', `CLOSED (Status ใน CMMS) ${closedByStatus.length}:`,
        ...closedByStatus.slice(0, 15).map((c) => `✓ ${c.wo} PP${c.plant} ${c.team} – ${String(c.row?.desc || '').slice(0, 45)}`)] : []),
      ...(assumed.length ? ['', `ไม่พบในไฟล์ล่าสุด = CLOSED ${assumed.length} WO:`,
        ...assumed.slice(0, 15).map((a) => `- ${a.wo} PP${a.plant} ${a.team} สถานะล่าสุด ${a.row?.status || '-'} – ${String(a.row?.desc || '').slice(0, 45)}`)] : []),
      '',
      'งานค้างนานสุด:',
      ...oldest.slice(0, 10).map((r, i) => `${i + 1}. ${r.wo} PP${r.plant} ${r.team || ''} ${r.age} วัน ${r.status} – ${String(r.desc || '').slice(0, 50)}`),
      '',
      `ดูทั้งหมด: ${location.origin}${location.pathname}`,
    ];
    return lines.join('\n');
  };
  // Same analysed message the LINE push sends (all plants), for pasting into a group chat.
  const roundText = () => analysisText({ cur: picked, prev, backlog, today, latest: picked === days.at(-1), url: `${location.origin}${location.pathname}` });
  const copy = async (which) => {
    const text = which === 'round' ? roundText() : summary();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied(''), 2500);
  };

  return (
    <section className="panel rep" aria-label="รายงานประจำวัน">
      <div className="panel-head panel-head-split">
        <span>รายงานประจำวัน (CMMS) · {scope}</span>
        <span className="rep-controls">
          <select className="rep-select" value={cur.date} onChange={(e) => setDate(e.target.value)} aria-label="เลือกวัน">
            {[...days].reverse().map((d) => <option key={d.date} value={d.date}>{dayLabel(d.date)} {pd(d.date).getFullYear() + 543}</option>)}
          </select>
          <button type="button" className="btn btn-save rep-copy" onClick={() => copy('round')} title="ข้อความวิเคราะห์เทียบวันก่อน (ทุกโรง) — เหมือนที่ส่ง LINE">{copied === 'round' ? 'คัดลอกแล้ว ✓' : 'คัดลอกข้อความวิเคราะห์ (LINE)'}</button>
          <button type="button" className="btn btn-ghost rep-copy" onClick={() => copy('detail')} title="รายการ WO ทั้งหมดของวัน">{copied === 'detail' ? 'คัดลอกแล้ว ✓' : 'คัดลอกรายละเอียด'}</button>
        </span>
      </div>

      <div className="rep-chips">
        <WlSelect value={team} onChange={setTeam} seen={seenWl} />
        {oldSnap && <span className="muted rep-wl-note">วันนี้เป็นข้อมูลเก่า: คงค้างแยก WO_Worklocation ไม่มีบันทึก</span>}
        <span className="rep-rounds">{cur.baseline && <b className="rep-base">Baseline</b>} อัปโหลด {cur.rounds.length} รอบ: {cur.rounds.map((r) => hm(r.at)).join(', ')} น.</span>
      </div>

      <p className="rep-note">นับตาม<b>เวลาที่ระบบเห็นการเปลี่ยนแปลงในไฟล์ CMMS</b> (เทียบไฟล์รอบก่อน) — เช่น งานที่เพิ่งกดปิดวันนี้นับเป็น CLOSED วันนี้ แม้ Actual Finish จะเป็นวันก่อน · ผลงานตามวันที่ทำงานจริงดูที่ "ผลงาน P1 สะสม" ด้านบน</p>
      <div className="rep-tiles">
        <Tile label="WO ใหม่ที่เข้า Backlog" value={tot.entered ?? '—'} sub={tot.entered == null ? 'เริ่มนับตั้งแต่อัปโหลดรอบถัดไป' : `งานค้างใหม่ · WO ใหม่ในไฟล์ทั้งหมด ${tot.new}`} />
        <Tile label="เปิดงานจริง (Actual Start วันนี้)" value={tot.opened} sub={tot.inserted ? `⚡ แทรกระหว่างวัน ${tot.inserted}` : 'ไม่มีงานแทรก'} tone={tot.inserted ? 'insert' : ''} />
        <Tile label="เริ่มงาน (Start)" value={tot.started} tone="start" />
        <Tile label="เสร็จ / รอปิด" value={tot.finished} />
        <Tile label="CLOSED (พบในไฟล์วันนี้)" value={tot.closed} tone="close" sub={tot.assumed ? `Status ${tot.closedStatus} · ไม่พบในไฟล์ ${tot.assumed}` : cur.baseline && !tot.closed ? 'วันเริ่มต้น' : undefined} />
        <Tile label="คงค้าง" value={tot.open} sub={openDelta != null ? `${signed(openDelta)} จาก ${dayLabel(prev.date)}` : 'วันแรกที่บันทึก'} tone={openDelta > 0 ? 'up' : openDelta < 0 ? 'down' : ''} />
        <Tile label="ค้างเกิน 30 วัน" value={tot.a90 + tot.aMore} sub={`เกิน 90 วัน ${tot.aMore}`} />
      </div>

      <div className="rep-grid">
        <div>
          <div className="rep-sub panel-head-split">
            <span>เริ่มงาน vs CLOSED ต่อวัน</span>
            <span className="trend-legend"><span><i style={{ background: START }} />เริ่มงาน</span><span><i style={{ background: CLOSE }} />CLOSED</span></span>
          </div>
          <FlowChart days={trend} onPick={setDate} W={cw} />
          <div className="rep-sub">WO คงค้างต่อวัน</div>
          <OpenChart days={trend} W={cw} />
        </div>
        <div>
          <div className="rep-sub">สรุปรายโรง · {cur.rounds?.length ? roundLabel(cur.rounds.at(-1).at) : ''} <span className="muted">(ข้อมูลจาก CMMS · สะสมทั้งวัน)</span></div>
          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead><tr><th>โรง</th><th>เข้า Backlog</th><th>เปิดงาน</th><th>⚡แทรก</th><th>เสร็จ/ปิด</th><th>คงค้าง</th><th>±เมื่อวาน</th></tr></thead>
              <tbody>
                {[...ids.map((id) => [`PP${id}`, plantNumbers(cur, prev, [id])]), ...(ids.length > 1 ? [['รวม', plantNumbers(cur, prev, ids)]] : [])].map(([label, n]) => (
                  <tr key={label} className={label === 'รวม' ? 'is-total' : ''}>
                    <th>{label}</th><td>{n.entered ?? '—'}</td><td>{n.opened}</td><td>{n.inserted}</td><td title={`CLOSED ${n.closed} · เสร็จรอปิด ${n.waitClose}`}>{n.done}</td><td><b>{n.open}</b></td><td>{n.delta == null ? '—' : signed(n.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rep-sub">แยกตาม WO_Worklocation · {dayLabel(cur.date)}</div>
          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead><tr><th>WO_Worklocation</th><th>เปิดงาน</th><th>⚡แทรก</th><th>เริ่ม</th><th>เสร็จรอปิด</th><th>CLOSED</th><th>คงค้าง</th><th>&gt;30 วัน</th></tr></thead>
              <tbody>
                {byTeam.map((t) => (
                  <tr key={t.k} className={team.includes(t.k) ? 'is-on' : ''} onClick={() => setTeam(toggleWl(team, t.k))}>
                    <th>{t.label} <span className="muted">{t.team}</span></th><td>{t.opened}</td><td>{t.inserted}</td><td>{t.started}</td><td>{t.finished}</td><td>{t.closed}</td><td><b>{t.open}</b></td><td>{t.a90 + t.aMore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rounds.length > 0 && (
            <>
              <div className="rep-sub">แยกตามรอบอัปโหลด · {dayLabel(cur.date)}</div>
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead><tr><th>รอบ</th><th>เปิดงาน</th><th>⚡แทรก</th><th>เริ่ม</th><th>เสร็จรอปิด</th><th>CLOSED</th><th>(ไม่พบในไฟล์)</th></tr></thead>
                  <tbody>
                    {rounds.map((r) => (
                      <tr key={r.at}>
                        <th>{hm(r.at)} น.{r.baseline ? ' (Baseline)' : ''}</th><td>{r.opened}</td><td>{r.inserted}</td><td>{r.started}</td><td>{r.finished}</td><td>{r.closed}</td><td>{r.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <FoldList key={`s${cur.date}`} title="เปิดงานวันนี้ (Actual Start)" items={opened}
            note={opened.some((f) => f.mid)
              ? `⚡ แทรกระหว่างวัน ${opened.filter((f) => f.mid).length} WO = WO ใหม่ในไฟล์ที่ Actual Start วันนี้ · ที่เหลือ (ป้าย "เปิด") เป็น WO เดิมที่เริ่มงานวันนี้`
              : 'ไม่มีงานแทรกระหว่างวัน — ทุกรายการ (ป้าย "เปิด") เป็น WO เดิมที่มีอยู่ในไฟล์ก่อนแล้ว และเริ่มงาน (Actual Start) วันนี้'} tone="rep-new" startOpen
            render={(f) => (
              <li key={f.wo} className={f.mid ? 'is-insert' : ''} title={f.row?.desc || ''}>
                <span className="rep-age">{f.mid ? '⚡ แทรก' : 'เปิด'}</span>
                <span className="rep-wo">{f.wo}</span>
                <span className="muted">PP{f.plant} · {f.team} · {f.row?.status || '-'}</span>
                <span className="rep-desc">{f.row?.desc || ''}</span>
              </li>
            )} />
          {cur.entered && (
            <FoldList key={`e${cur.date}`} title="WO ใหม่ที่เข้า Backlog" note="งานค้าง (ยังไม่เสร็จ/ไม่ปิด) ที่ไม่อยู่ใน Backlog ของไฟล์รอบก่อน — เลข WO ใหม่ หรือกลับมาค้างอีกครั้ง" items={entered} tone="rep-new" startOpen
              render={(f) => (
                <li key={f.wo} title={f.row?.desc || ''}>
                  <span className="rep-age">🆕</span>
                  <span className="rep-wo">{f.wo}</span>
                  <span className="muted">PP{f.plant} · {f.team} · {f.row?.status || '-'}{f.age != null ? ` · ค้าง ${f.age} วัน` : ''}</span>
                  <span className="rep-desc">{f.row?.desc || ''}</span>
                </li>
              )} />
          )}
          <FoldList key={`n${cur.date}`} title="WO ใหม่ในไฟล์ (เทียบไฟล์รอบก่อน)" note="รวมงานที่ Actual Start วันก่อน เช่น งานที่เปิดช่วงเสาร์–อาทิตย์" items={fresh} tone="rep-new"
            render={(f) => (
              <li key={f.wo} className={f.mid ? 'is-insert' : ''} title={f.row?.desc || ''}>
                <span className="rep-age">{f.mid ? '⚡ แทรก' : 'ใหม่'}</span>
                <span className="rep-wo">{f.wo}</span>
                <span className="muted">PP{f.plant} · {f.team} · {f.row?.status || '-'}{f.row?.actualStart ? ` · AS ${dayLabel(f.row.actualStart)}` : ''}</span>
                <span className="rep-desc">{f.row?.desc || ''}</span>
              </li>
            )} />
          <FoldList key={`c${cur.date}`} title="CLOSED · Status ในไฟล์ (คอลัมน์ L)" items={closedByStatus} tone="rep-closed"
            render={(c) => (
              <li key={c.wo} title={c.row?.desc || ''}>
                <span className="rep-age is-ok">✓</span>
                <span className="rep-wo">{c.wo}</span>
                <span className="muted">PP{c.plant} · {c.team}{c.row?.prevStatus ? ` · เดิม ${c.row.prevStatus}` : ''}</span>
                <span className="rep-desc">{c.row?.desc || ''}</span>
              </li>
            )} />
          <FoldList key={`a${cur.date}`} title="CLOSED · ไม่พบในไฟล์ล่าสุด" note="ไฟล์ CMMS ไม่ดึงงานที่ปิดแล้ว" items={assumed} tone="rep-assumed"
            render={(a) => (
              <li key={a.wo} title={a.row?.desc || ''}>
                <span className="rep-age is-ok">✓</span>
                <span className="rep-wo">{a.wo}</span>
                <span className="muted">PP{a.plant} · {a.team} · ล่าสุด {a.row?.status || '-'}{a.row?.lastSeen ? ` · เห็น ${dayLabel(a.row.lastSeen)}` : ''}</span>
                <span className="rep-desc">{a.row?.desc || 'ลบออกจากรายการแล้ว'}</span>
              </li>
            )} />
          <FoldList key={`o${cur.date}`} title="งานค้างนานสุด (ยังไม่ปิด)" items={oldest} startOpen
            render={(r) => (
              <li key={r.wo} title={r.desc || ''}>
                <span className="rep-age">{r.age} วัน</span>
                <span className="rep-wo">{r.wo}</span>
                <span className="muted">PP{r.plant} · {r.team || '-'} · {r.status}</span>
                <span className="rep-desc">{r.desc}</span>
              </li>
            )} />
        </div>
      </div>
    </section>
  );
}
