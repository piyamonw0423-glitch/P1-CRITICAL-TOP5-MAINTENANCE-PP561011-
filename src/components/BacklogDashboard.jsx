import { useMemo, useState } from 'react';
import Icon from '../lib/icons.jsx';
import { STATUS_GROUPS } from '../lib/cmms.js';
import { backlogDashboard } from '../lib/backlogDash.js';
import { TH_M, pd } from '../lib/dates.js';

// "WO Backlog P1" — the team's weekly summary board (hero, KPI cards, tables on the left, three charts on the
// right, goal / insight / next step at the bottom), computed from the same WO Backlog upload.

/** Page switch under the header (Top 5 dashboard ↔ WO Backlog dashboard). */
export function PageTabs({ page, onChange }) {
  return (
    <nav className="page-tabs" aria-label="เลือกหน้า">
      {[['main', 'Dashboard Top 5'], ['wo', 'Dashboard WO Backlog P1']].map(([k, label]) => (
        <button key={k} type="button" className={`page-tab${page === k ? ' is-on' : ''}`} aria-current={page === k ? 'page' : undefined} onClick={() => onChange(k)}>{label}</button>
      ))}
    </nav>
  );
}

// Fixed stack/legend/donut order: neighbours stay distinguishable (validated: no two blues or gray+blue side by side).
const STACK_ORDER = ['plan', 'inprg', 'assigned', 'material', 'nis', 'rework', 'contractor', 'other'];
const GROUP = Object.fromEntries(STATUS_GROUPS.map((g) => [g.key, g]));
// Aging = ordered magnitude → one hue, light to dark (sequential), never a rainbow.
const AGE_RAMP = ['oklch(0.82 0.08 25)', 'oklch(0.74 0.12 25)', 'oklch(0.65 0.16 25)', 'oklch(0.56 0.19 25)', 'oklch(0.45 0.17 25)'];
const TEAM_TINT = { MECH: 'oklch(0.55 0.14 255)', ELEC: 'oklch(0.6 0.14 150)', AUTO: 'oklch(0.65 0.15 60)', EMER: 'oklch(0.52 0.15 300)', OTHER: 'oklch(0.6 0.02 258)' };
const PLANT_TINT = { 5: 'oklch(0.55 0.14 255)', 6: 'oklch(0.6 0.14 150)', 10: 'oklch(0.66 0.15 60)', 11: 'oklch(0.52 0.15 300)' };
const nf = (n) => Math.round(n).toLocaleString('en-US');
const p1 = (n) => `${n.toFixed(1)}%`;
const thaiLong = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };

function Kpi({ icon, tone, label, value, unit }) {
  return (
    <div className={`bk-kpi is-${tone}`}>
      <span className="bk-kpi-icon"><Icon name={icon} /></span>
      <div className="bk-kpi-body">
        <div className="bk-kpi-label">{label}</div>
        <div className="bk-kpi-value">{value}</div>
        <div className="bk-kpi-unit">{unit}</div>
      </div>
    </div>
  );
}

function Card({ icon, title, children, className = '' }) {
  return (
    <section className={`bk-card ${className}`}>
      <h3 className="bk-card-head"><span className="bk-card-icon"><Icon name={icon} /></span>{title}</h3>
      {children}
    </section>
  );
}

const Rank = ({ n }) => <span className="bk-rank">{n}</span>;

/** Status share donut: segments in STACK_ORDER with a 2px surface gap, total in the middle, legend with %. */
function Donut({ groups, total }) {
  const order = STACK_ORDER.map((k) => groups.find((g) => g.key === k)).filter(Boolean);
  const R = 80, r = 50, C = 90;
  let a0 = -Math.PI / 2;
  const [hover, setHover] = useState(null);
  const arc = (from, to) => {
    const big = to - from > Math.PI ? 1 : 0;
    const p = (rad, a) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return `M${p(R, from)} A${R},${R} 0 ${big} 1 ${p(R, to)} L${p(r, to)} A${r},${r} 0 ${big} 0 ${p(r, from)} Z`;
  };
  return (
    <div className="bk-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label="สัดส่วน WO ตามกลุ่มสถานะ">
        {order.map((g) => {
          const span = (g.count / Math.max(1, total)) * Math.PI * 2;
          const from = a0, to = a0 + span;
          a0 = to;
          if (span <= 0) return null;
          const mid = (from + to) / 2;
          return (
            <g key={g.key} onPointerEnter={() => setHover(g.key)} onPointerLeave={() => setHover(null)}>
              <path d={span >= Math.PI * 2 - 1e-6 ? arc(from, to - 1e-4) : arc(from, to)} fill={g.color} className="bk-donut-seg" opacity={hover && hover !== g.key ? 0.45 : 1} />
              {g.pct >= 6 && <text x={C + 65 * Math.cos(mid)} y={C + 65 * Math.sin(mid) + 3.5} textAnchor="middle" className="bk-donut-pct">{Math.round(g.pct)}%</text>}
              <title>{`${g.label}: ${g.count} WO (${p1(g.pct)})`}</title>
            </g>
          );
        })}
        <text x={C} y={C - 12} textAnchor="middle" className="bk-donut-cap">จำนวนทั้งหมด</text>
        <text x={C} y={C + 14} textAnchor="middle" className="bk-donut-total">{nf(total)}</text>
        <text x={C} y={C + 30} textAnchor="middle" className="bk-donut-cap">รายการ</text>
      </svg>
      <ul className="bk-legend-list">
        {order.map((g) => (
          <li key={g.key} className={hover === g.key ? 'is-on' : ''}><i style={{ background: g.color }} />{g.label}<b>{Math.round(g.pct)}%</b></li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal stacked bars (one row per team or plant), segments in STACK_ORDER, 2px gaps, legend below. */
function Stacks({ rows, groups, label }) {
  const order = STACK_ORDER.filter((k) => groups.some((g) => g.key === k));
  const col = Object.fromEntries(groups.map((g, i) => [g.key, i]));
  const max = Math.max(1, ...rows.map((m) => m.cells.reduce((s, n) => s + n, 0)));
  const [tip, setTip] = useState('');
  return (
    <div className="bk-stacks">
      {rows.filter((m) => m.cells.some((n) => n)).map((m) => {
        const total = m.cells.reduce((s, n) => s + n, 0);
        return (
          <div key={label(m)} className="bk-stack-row">
            <span className="bk-stack-name">{label(m)}</span>
            <span className="bk-stack-track">
              <span className="bk-stack-bar" style={{ width: `${(total / max) * 100}%` }}>
                {order.map((k) => {
                  const n = m.cells[col[k]] || 0;
                  const t = `${label(m)} · ${GROUP[k].label}: ${n} WO`;
                  return n ? <span key={k} className="bk-seg" style={{ flexGrow: n, background: GROUP[k].color }} title={t} onPointerEnter={() => setTip(t)} onPointerLeave={() => setTip('')} /> : null;
                })}
              </span>
              <b className="bk-stack-total">{total}</b>
            </span>
          </div>
        );
      })}
      <div className="bk-legend">{order.map((k) => <span key={k}><i style={{ background: GROUP[k].color }} />{GROUP[k].label}</span>)}</div>
      <div className="bk-tip" aria-live="polite">{tip || ' '}</div>
    </div>
  );
}

/** Aging bars: one sequential hue (light = young, dark = old), value on top, native tooltip. */
function AgingChart({ bands }) {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600; // narrower canvas keeps labels readable
  const W = narrow ? 360 : 520, H = 210, pad = { l: 28, r: 6, t: 22, b: 30 };
  const max = Math.max(1, ...bands.map((b) => b.count));
  const step = (W - pad.l - pad.r) / bands.length;
  const bw = Math.min(64, step * 0.62);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bk-chart" role="img" aria-label="จำนวน WO ตามช่วงอายุค้าง">
      {[0, Math.round(max / 2), max].map((t) => (
        <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="bk-gridline" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="bk-axis">{t}</text></g>
      ))}
      {bands.map((b, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        const top = y(b.count);
        return (
          <g key={b.k}>
            {b.count > 0 && <path d={`M${x},${H - pad.b} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${H - pad.b} Z`} fill={AGE_RAMP[i]} />}
            <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="bk-val">{b.count}</text>
            <text x={x + bw / 2} y={H - pad.b + 16} textAnchor="middle" className="bk-axis">{narrow ? b.label.replace(' วัน', '').replace('มากกว่า ', '>') : b.label}</text>
            <title>{`${b.label}: ${b.count} WO (${p1(b.pct)}) · อายุเฉลี่ย ${b.avgAge} วัน`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default function BacklogDashboard({ backlog, ids, today, plantLabel, onUpload }) {
  const d = useMemo(() => backlogDashboard(backlog?.rows || [], ids, today), [backlog, ids, today]);
  if (!backlog) {
    return (
      <section className="panel bd">
        <div className="panel-head">Dashboard: WO Backlog P1</div>
        <p className="rep-empty">ยังไม่มีข้อมูล WO Backlog — {onUpload ? <button type="button" className="linklike" onClick={onUpload}>อัปโหลดไฟล์ List of Work Orders</button> : 'อัปโหลดไฟล์ในโหมดแก้ไข'} แล้วหน้านี้จะสรุปให้อัตโนมัติ</p>
      </section>
    );
  }
  const { kpi, total } = d;
  const topTeam = [...d.teams].sort((a, b) => b.count - a.count)[0];
  const foot = (cells) => <tr className="bk-foot">{cells.map((c, i) => (i ? <td key={i}>{c}</td> : <th key={i}>{c}</th>))}</tr>;

  return (
    <div className="bk" aria-label="Dashboard WO Backlog P1">
      <header className="bk-hero">
        <span className="bk-hero-mark"><Icon name="factory" /></span>
        <div className="bk-hero-title">
          <h2>WO Backlog <span>P1</span></h2>
          <p>สรุปงานซ่อมบำรุงที่มีความเสี่ยงสูง (Priority 1) · {plantLabel}</p>
        </div>
        <div className="bk-hero-tag">Right Work<br />Right Priority<br />Better Decision</div>
        <div className="bk-hero-date">
          <Icon name="calendar" />
          <span>ข้อมูล ณ วันที่<b>{thaiLong(backlog.uploadedAt.slice(0, 10))}</b>{backlog.fileName && <small>{backlog.fileName}</small>}</span>
        </div>
      </header>

      <div className="bk-layout">
        <div className="bk-main">
          <div className="bk-kpis">
            <Kpi icon="clipboard" tone="blue" label="จำนวน WO ทั้งหมด" value={nf(total)} unit="รายการ" />
            <Kpi icon="check" tone="green" label="อายุค้างเฉลี่ย" value={nf(kpi.avgAge)} unit="วัน" />
            <Kpi icon="alert" tone="red" label="อายุค้างสูงสุด" value={nf(kpi.maxAge)} unit="วัน" />
            <Kpi icon="percent" tone="rose" label="ค้าง > 365 วัน" value={nf(kpi.over365)} unit="รายการ" />
            <Kpi icon="pie" tone="sky" label="% ค้าง > 180 วัน" value={p1(kpi.pct180)} unit={`${kpi.over180} รายการ`} />
            <Kpi icon="coins" tone="violet" label="มูลค่างานประเมิน (บาท)" value={nf(kpi.value)} unit={`${kpi.valueCount} WO ที่มีการประเมินมูลค่า`} />
          </div>

          <div className="bk-grid">
            <Card icon="wrench" title="สรุปตามกลุ่มสถานะ">
              <table className="bk-table">
                <thead><tr><th>กลุ่มสถานะ</th><th>จำนวน</th><th>% ของทั้งหมด</th><th>อายุเฉลี่ย (วัน)</th></tr></thead>
                <tbody>{d.groups.map((g) => <tr key={g.key}><th><i className="bk-dot" style={{ background: g.color }} />{g.label}</th><td>{g.count}</td><td>{p1(g.pct)}</td><td>{g.avgAge}</td></tr>)}</tbody>
                <tfoot>{foot(['รวม', total, '100.0%', kpi.avgAge])}</tfoot>
              </table>
            </Card>
            <Card icon="users" title="สรุปตามทีม">
              <table className="bk-table">
                <thead><tr><th>ทีม</th><th>จำนวน</th><th>% ของทั้งหมด</th><th>อายุเฉลี่ย (วัน)</th><th>ค้าง &gt; 180 วัน</th></tr></thead>
                <tbody>{d.teams.map((t) => <tr key={t.k}><th><span className="bk-badge" style={{ background: TEAM_TINT[t.k] }}>{t.label.slice(0, 1)}</span>{t.label}</th><td>{t.count}</td><td>{p1(t.pct)}</td><td>{t.avgAge}</td><td>{t.over180}</td></tr>)}</tbody>
                <tfoot>{foot(['รวม', total, '100.0%', kpi.avgAge, kpi.over180])}</tfoot>
              </table>
            </Card>
            <Card icon="hourglass" title="การกระจายอายุงานค้าง (Aging)">
              <AgingChart bands={d.bands} />
            </Card>
            <Card icon="building" title="สรุปตาม Plant">
              <table className="bk-table">
                <thead><tr><th>Plant</th><th>จำนวน</th><th>% ของทั้งหมด</th><th>อายุเฉลี่ย (วัน)</th></tr></thead>
                <tbody>{d.plants.map((p) => <tr key={p.plant}><th><span className="bk-badge" style={{ background: PLANT_TINT[p.plant] }}>{p.plant}</span>PP{p.plant}</th><td>{p.count}</td><td>{p1(p.pct)}</td><td>{p.avgAge}</td></tr>)}</tbody>
                <tfoot>{foot(['รวม', total, '100.0%', kpi.avgAge])}</tfoot>
              </table>
            </Card>
            <Card icon="thumb" title="ผู้อนุมัติถัดไป (Next Approve) – 10 อันดับแรก">
              <table className="bk-table bk-compact">
                <thead><tr><th>#</th><th>Next Approve</th><th>จำนวน</th><th>อายุเฉลี่ย</th><th>&gt; 365 วัน</th><th>&gt; 180 วัน</th></tr></thead>
                <tbody>{d.approvers.map((a, i) => <tr key={a.name}><td><Rank n={i + 1} /></td><th>{a.name}</th><td>{a.count}</td><td>{a.avgAge}</td><td>{a.over365 || '–'}</td><td>{a.over180 || '–'}</td></tr>)}</tbody>
              </table>
            </Card>
            <Card icon="wrench" title="10 WO ที่ค้างนานที่สุด">
              <table className="bk-table bk-compact bk-oldest">
                <thead><tr><th>#</th><th>Work Order</th><th>Description</th><th>ทีม</th><th>กลุ่มสถานะ</th><th>อายุ (วัน)</th></tr></thead>
                <tbody>{d.oldest.map((r, i) => (
                  <tr key={r.wo}>
                    <td><Rank n={i + 1} /></td><th>{r.wo}</th><td className="bk-desc" title={r.desc}>{r.desc}</td>
                    <td><span className="bk-chip" style={{ color: TEAM_TINT[r.tm], borderColor: TEAM_TINT[r.tm] }}>{r.tm}</span></td>
                    <td className="bk-grp" title={GROUP[r.g]?.label || r.status}><i className="bk-dot" style={{ background: GROUP[r.g]?.color }} />{GROUP[r.g]?.label || r.status}</td>
                    <td><span className="bk-age">{r.age}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          </div>
        </div>

        <aside className="bk-side">
          <Card icon="pie" title="สัดส่วน WO ตามกลุ่มสถานะ"><Donut groups={d.groups} total={total} /></Card>
          <Card icon="clipboard" title="จำนวน WO ตามกลุ่มสถานะ แยกตาม Plant"><Stacks rows={d.plantMatrix} groups={d.groups} label={(m) => `PP${m.plant}`} /></Card>
          <Card icon="clipboard" title="WO ตามทีม แยกกลุ่มสถานะ"><Stacks rows={d.matrix} groups={d.groups} label={(m) => m.team.label} /></Card>
        </aside>
      </div>

      <footer className="bk-footer">
        <div><span className="bk-foot-icon"><Icon name="target" /></span><div><b>เป้าหมาย</b><p>ลด Backlog P1 · เพิ่มความพร้อมในการซ่อม · ยกระดับความเชื่อถือได้ของโรงไฟฟ้า</p></div></div>
        <div><span className="bk-foot-icon"><Icon name="bulb" /></span><div><b>Insight</b><p>{topTeam ? `${topTeam.label} มีงานค้างมากที่สุด (${p1(topTeam.pct)}) · งานค้างเกิน 180 วัน ${p1(kpi.pct180)} ของทั้งหมด · เกิน 365 วัน ${kpi.over365} รายการ` : 'ไม่มีงานค้าง'}</p></div></div>
        <div><span className="bk-foot-icon"><Icon name="chart" /></span><div><b>Next Step</b><p>ติดตาม Top 5 Backlog CM PP561011 &amp; Follow up · บริหารความเสี่ยง BD และเร่งรัดงานเกิน 180 วัน</p></div></div>
        <div className="bk-slogan">Small Action<br />Big Impact</div>
      </footer>
    </div>
  );
}
