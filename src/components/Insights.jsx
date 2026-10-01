import Icon from '../lib/icons.jsx';
import { DONE, DOING, STUCK } from '../lib/data.js';
import { pd, thD } from '../lib/dates.js';

export function BlockerSummary({ items, scopeLabel }) {
  return (
    <div className="panel">
      <div className="panel-head">ปัญหาหน้างานที่ติดอยู่ (Blocker) · งาน Top 5 ที่ยังไม่เสร็จ{scopeLabel}</div>
      <div className="blockers">
        {items.length === 0 && <div className="muted">ไม่มีงานที่ติดปัญหา</div>}
        {items.map((b) => (
          <div key={b.key} className="blocker">
            <span className="blocker-icon" style={{ background: b.solid, color: b.fg }}><Icon name={b.key} /></span>
            <div className="blocker-text">
              <span className="blocker-label">{b.label}</span>
              <span className="blocker-count" style={{ color: b.text || b.solid }}>{b.count} <small>งาน</small></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ hist }) {
  const W = 560, H = 150, L = 30, Rr = 10, T = 10, B = 26;
  const max = Math.max(4, ...hist.map((p) => Math.max(p.done, p.doing, p.stuck))) + 1;
  const x = (i) => L + (hist.length === 1 ? (W - L - Rr) / 2 : (i * (W - L - Rr)) / (hist.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const series = [['done', DONE], ['doing', DOING], ['stuck', STUCK]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="trend" role="img" aria-label="แนวโน้มงาน P1">
      {[0, Math.round(max / 2), max].map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} stroke="oklch(0.93 0.01 250)" />
          <text x={L - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="oklch(0.55 0.03 258)">{v}</text>
        </g>
      ))}
      {series.map(([k, col]) => (
        <g key={k}>
          <polyline points={hist.map((p, i) => `${x(i)},${y(p[k])}`).join(' ')} fill="none" stroke={col} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {hist.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p[k])} r="4.5" fill={col} stroke="white" strokeWidth="2">
              <title>{`${thD(pd(p.date))}: ${p[k]}`}</title>
            </circle>
          ))}
        </g>
      ))}
      {hist.map((p, i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize="11.5" textAnchor="middle" fill="oklch(0.45 0.04 258)" fontWeight="600">{thD(pd(p.date))}</text>
      ))}
    </svg>
  );
}

export function TrendPanel({ hist }) {
  return (
    <div className="panel">
      <div className="panel-head panel-head-split">
        <span>แนวโน้มงาน Top 5 (บันทึกทุกครั้งที่อัปเดต)</span>
        <span className="trend-legend">
          <span><i style={{ background: DONE }} />เสร็จแล้ว</span>
          <span><i style={{ background: DOING }} />กำลังทำ</span>
          <span><i style={{ background: STUCK }} />ค้าง</span>
        </span>
      </div>
      <div className="trend-wrap"><TrendChart hist={hist} /></div>
    </div>
  );
}
