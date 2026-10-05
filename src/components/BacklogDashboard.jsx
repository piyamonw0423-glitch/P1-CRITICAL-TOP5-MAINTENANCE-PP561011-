import { useMemo, useState } from 'react';
import { STATUS_GROUPS } from '../lib/cmms.js';
import { backlogDashboard } from '../lib/backlogDash.js';
import { pd, thD } from '../lib/dates.js';

// "Dashboard: WO Backlog P1" — the weekly summary sheet the team used to build in Excel, computed from the same
// WO Backlog upload: KPIs, status groups, teams, aging, plants, team × status, next approvers and the oldest WOs.

/** Page switch under the header (Top 5 dashboard ↔ WO Backlog dashboard). */
export function PageTabs({ page, onChange }) {
  return (
    <nav className="page-tabs" aria-label="เลือกหน้า">
      {[['main', 'แดชบอร์ด Top 5'], ['wo', 'Dashboard WO Backlog P1']].map(([k, label]) => (
        <button key={k} type="button" className={`page-tab${page === k ? ' is-on' : ''}`} aria-current={page === k ? 'page' : undefined} onClick={() => onChange(k)}>{label}</button>
      ))}
    </nav>
  );
}

// Fixed stack/legend order: neighbours stay distinguishable (validated: no two blues or gray+blue side by side).
const STACK_ORDER = ['plan', 'inprg', 'assigned', 'material', 'nis', 'rework', 'contractor', 'other'];
const GROUP = Object.fromEntries(STATUS_GROUPS.map((g) => [g.key, g]));
const AGE_INK = 'oklch(0.5 0.17 25)'; // one hue for the aging series (single series, magnitude)
const nf = (n) => Math.round(n).toLocaleString('en-US');
const p1 = (n) => `${n.toFixed(1)}%`;

function Kpi({ label, value, unit, tone }) {
  return (
    <div className={`bd-kpi${tone ? ` is-${tone}` : ''}`}>
      <div className="bd-kpi-label">{label}</div>
      <div className="bd-kpi-value">{value}</div>
      <div className="bd-kpi-unit">{unit}</div>
    </div>
  );
}

function Table({ title, head, rows, foot, className = '' }) {
  return (
    <div className={`bd-block ${className}`}>
      <div className="bd-title">{title}</div>
      <div className="rep-table-wrap">
        <table className="rep-table bd-table">
          <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows}</tbody>
          {foot && <tfoot>{foot}</tfoot>}
        </table>
      </div>
    </div>
  );
}

/** Vertical bars for the aging bands — one series, value on top, hover shows count and share. */
function AgingChart({ bands }) {
  // Phones get a narrower canvas so the labels keep a readable size.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600;
  const W = narrow ? 360 : 520, H = narrow ? 230 : 220, pad = { l: 30, r: 6, t: 22, b: 34 };
  const max = Math.max(1, ...bands.map((b) => b.count));
  const step = (W - pad.l - pad.r) / bands.length;
  const bw = Math.min(56, step * 0.55);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  const [hover, setHover] = useState(null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bd-chart" role="img" aria-label="จำนวน WO ตามช่วงอายุค้าง">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="bd-grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="bd-axis">{t}</text>
        </g>
      ))}
      {bands.map((b, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        const top = y(b.count);
        const h = Math.max(0, H - pad.b - top);
        return (
          <g key={b.k} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <rect x={pad.l + step * i} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
            {h > 0 && <path d={`M${x},${H - pad.b} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${H - pad.b} Z`} fill={AGE_INK} opacity={hover == null || hover === i ? 1 : 0.55} />}
            <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="bd-val">{b.count}</text>
            <text x={x + bw / 2} y={H - pad.b + 16} textAnchor="middle" className="bd-axis">{narrow ? b.label.replace(' วัน', '').replace('มากกว่า ', '>') : b.label}</text>
            <title>{`${b.label}: ${b.count} WO (${p1(b.pct)}) · อายุเฉลี่ย ${b.avgAge} วัน`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/** One 100% bar per team, segments by status group in STACK_ORDER, 2px gaps; legend above. */
function TeamStack({ matrix, groups }) {
  const order = STACK_ORDER.filter((k) => groups.some((g) => g.key === k));
  const col = Object.fromEntries(groups.map((g, i) => [g.key, i]));
  const max = Math.max(1, ...matrix.map((m) => m.cells.reduce((s, n) => s + n, 0)));
  const [tip, setTip] = useState(null);
  return (
    <div className="bd-stack">
      <div className="bd-legend">
        {order.map((k) => <span key={k}><i style={{ background: GROUP[k].color }} />{GROUP[k].label}</span>)}
      </div>
      {matrix.filter((m) => m.cells.some((n) => n)).map((m) => {
        const total = m.cells.reduce((s, n) => s + n, 0);
        return (
          <div key={m.team.k} className="bd-stack-row">
            <span className="bd-stack-name">{m.team.label}</span>
            <span className="bd-stack-track">
              <span className="bd-stack-bar" style={{ width: `${(total / max) * 100}%` }}>
                {order.map((k) => {
                  const n = m.cells[col[k]] || 0;
                  return n ? (
                    <span key={k} className="bd-seg" style={{ flexGrow: n, background: GROUP[k].color }}
                      onPointerEnter={() => setTip(`${m.team.label} · ${GROUP[k].label}: ${n} WO`)} onPointerLeave={() => setTip(null)}
                      title={`${m.team.label} · ${GROUP[k].label}: ${n} WO`} />
                  ) : null;
                })}
              </span>
            </span>
            <b className="bd-stack-total">{total}</b>
          </div>
        );
      })}
      <div className="bd-tip muted" aria-live="polite">{tip || 'ชี้ที่แถบเพื่อดูจำนวน'}</div>
    </div>
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
  const up = new Date(backlog.uploadedAt);
  const heatMax = Math.max(1, ...d.matrix.flatMap((m) => m.cells));
  const sumRow = (cells) => <tr className="is-total">{cells.map((c, i) => (i ? <td key={i}>{c}</td> : <th key={i}>{c}</th>))}</tr>;

  return (
    <section className="panel bd" aria-label="Dashboard WO Backlog P1">
      <div className="panel-head panel-head-split">
        <span>Dashboard: WO Backlog P1 · {plantLabel}</span>
        <span className="bd-stamp">ข้อมูล ณ {thD(pd(backlog.uploadedAt.slice(0, 10)))} {String(up.getHours()).padStart(2, '0')}:{String(up.getMinutes()).padStart(2, '0')} น.{backlog.fileName ? ` · ${backlog.fileName}` : ''}</span>
      </div>
      <p className="rep-note">สรุปงานค้าง (Priority 1) ที่ยังไม่เสร็จ/ไม่ปิด จากไฟล์ WO Backlog ล่าสุด · ค้าง (วัน) = วันนี้ − Target Start (หรือ Scheduled Start) · อัปเดตเองทุกครั้งที่อัปโหลดไฟล์</p>

      <div className="bd-kpis">
        <Kpi label="จำนวน WO ทั้งหมด" value={nf(total)} unit="รายการ" />
        <Kpi label="อายุค้างเฉลี่ย" value={nf(kpi.avgAge)} unit="วัน" />
        <Kpi label="อายุค้างสูงสุด" value={nf(kpi.maxAge)} unit="วัน" />
        <Kpi label="ค้าง > 365 วัน" value={nf(kpi.over365)} unit="รายการ" tone="bad" />
        <Kpi label="% ค้าง > 180 วัน" value={p1(kpi.pct180)} unit={`${kpi.over180} รายการ`} />
        <Kpi label="กำลังดำเนินการ" value={nf(kpi.inProgress)} unit="รายการ" />
        <Kpi label="มูลค่างานประเมิน (บาท)" value={nf(kpi.value)} unit={`${kpi.valueCount} WO ที่มีการประเมินมูลค่า`} />
      </div>

      <div className="bd-grid2">
        <Table title="สรุปตามกลุ่มสถานะ" head={['กลุ่มสถานะ', 'จำนวน', '% ของทั้งหมด', 'อายุเฉลี่ย (วัน)']}
          rows={d.groups.map((g) => (
            <tr key={g.key}>
              <th><i className="bd-dot" style={{ background: g.color }} />{g.label}</th>
              <td>{g.count}</td>
              <td><span className="bd-pct"><span style={{ width: `${g.pct}%`, background: g.color }} /></span>{p1(g.pct)}</td>
              <td>{g.avgAge}</td>
            </tr>
          ))}
          foot={sumRow(['รวม', total, '100.0%', kpi.avgAge])} />
        <Table title="สรุปตามทีม" head={['ทีม', 'จำนวน', '% ของทั้งหมด', 'อายุเฉลี่ย (วัน)', 'ค้าง > 180 วัน']}
          rows={d.teams.map((t) => <tr key={t.k}><th>{t.label}</th><td>{t.count}</td><td>{p1(t.pct)}</td><td>{t.avgAge}</td><td>{t.over180}</td></tr>)}
          foot={sumRow(['รวม', total, '100.0%', kpi.avgAge, kpi.over180])} />
      </div>

      <div className="bd-grid2">
        <div className="bd-block">
          <div className="bd-title">Aging: จำนวน WO ตามช่วงอายุค้าง</div>
          <AgingChart bands={d.bands} />
          <div className="rep-table-wrap">
            <table className="rep-table bd-table">
              <thead><tr><th>ช่วงอายุ</th><th>จำนวน</th><th>% ของทั้งหมด</th><th>อายุเฉลี่ย (วัน)</th></tr></thead>
              <tbody>{d.bands.map((b) => <tr key={b.k}><th>{b.label}</th><td>{b.count}</td><td>{p1(b.pct)}</td><td>{b.avgAge}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="bd-block">
          <Table title="สรุปตามโรงไฟฟ้า" head={['โรง', 'จำนวน', '% ของทั้งหมด', 'อายุเฉลี่ย (วัน)']}
            rows={d.plants.map((p) => <tr key={p.plant}><th>PP{p.plant}</th><td>{p.count}</td><td>{p1(p.pct)}</td><td>{p.avgAge}</td></tr>)}
            foot={sumRow(['รวม', total, '100.0%', kpi.avgAge])} className="bd-flat" />
          <div className="bd-title">WO ตามทีม แยกกลุ่มสถานะ</div>
          <TeamStack matrix={d.matrix} groups={d.groups} />
        </div>
      </div>

      <Table title="ทีม × กลุ่มสถานะ (จำนวน WO)" head={['ทีม', ...d.groups.map((g) => g.label), 'รวม']}
        rows={d.matrix.map((m) => (
          <tr key={m.team.k}>
            <th>{m.team.label}</th>
            {m.cells.map((n, i) => <td key={i} className="bd-heat" style={n ? { background: `oklch(0.62 0.17 25 / ${0.08 + 0.5 * (n / heatMax)})` } : undefined}>{n || '–'}</td>)}
            <td><b>{m.cells.reduce((s, n) => s + n, 0)}</b></td>
          </tr>
        ))}
        foot={sumRow(['รวม', ...d.groups.map((g) => g.count), total])} />

      <div className="bd-grid2">
        <Table title="ผู้อนุมัติถัดไป (Next Approve) – 10 อันดับแรก" head={['Next Approve', 'จำนวน', 'อายุเฉลี่ย (วัน)', 'ค้าง > 365 วัน']}
          rows={d.approvers.map((a) => <tr key={a.name}><th>{a.name}</th><td>{a.count}</td><td>{a.avgAge}</td><td>{a.over365 || '–'}</td></tr>)} />
        <Table title="10 WO ที่ค้างนานที่สุด" head={['Work Order', 'Description', 'โรง', 'ทีม', 'กลุ่มสถานะ', 'ค้าง (วัน)']} className="bd-oldest"
          rows={d.oldest.map((r) => (
            <tr key={r.wo}>
              <th>{r.wo}</th><td className="bd-desc" title={r.desc}>{r.desc}</td><td>PP{r.plant}</td><td>{r.tm}</td>
              <td className="bd-grp">{GROUP[r.g]?.label || r.status}</td><td className="bd-age">{r.age}</td>
            </tr>
          ))} />
      </div>
    </section>
  );
}
