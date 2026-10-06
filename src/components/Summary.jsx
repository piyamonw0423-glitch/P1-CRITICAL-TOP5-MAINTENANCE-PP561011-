import Icon from '../lib/icons.jsx';

export function FilterSelect({ value, color, onChange }) {
  return (
    <div className="filter-row">
      <label htmlFor="plant-filter" className="filter-label"><span className="ico"><Icon name="filter" /></span>เลือกดู</label>
      <div className="filter-select" style={{ '--c': color }}>
        <span className="filter-dot" />
        <select id="plant-filter" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="all">ทั้งหมด 4 โรง</option>
          <optgroup label="รายกลุ่ม">
            <option value="5-10">กลุ่ม 1 · โรง 5 + 10</option>
            <option value="6-11">กลุ่ม 2 · โรง 6 + 11</option>
          </optgroup>
          <optgroup label="รายโรง">
            <option value="5">โรงไฟฟ้า 5</option>
            <option value="10">โรงไฟฟ้า 10</option>
            <option value="6">โรงไฟฟ้า 6</option>
            <option value="11">โรงไฟฟ้า 11</option>
          </optgroup>
        </select>
        <span className="filter-chevron"><Icon name="chevron" /></span>
      </div>
    </div>
  );
}

function KpiCard({ tone, icon, label, value, pct, of }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-head"><span className="ico"><Icon name={icon} /></span><span className="kpi-label">{label}</span></div>
      <div className="kpi-body">
        <div className="kpi-nums"><span className="kpi-value">{value}</span><span className="kpi-pct">{pct}%</span></div>
        <div className="kpi-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
        <div className="kpi-of">{of}</div>
      </div>
    </div>
  );
}

export function KpiRow({ kpi }) {
  const cmms = kpi.source === 'cmms';
  const unit = cmms ? 'WO' : 'งาน';
  return (
    <div className="kpi-row">
      <div className="kpi kpi-total">
        <div className="kpi-head"><span className="ico"><Icon name="alert" /></span><span className="kpi-label">{cmms ? 'WO P1 ทั้งหมด' : 'P1 ทั้งหมด'}</span></div>
        <div className="kpi-body">
          <div className="kpi-nums"><span className="kpi-value">{kpi.total}</span><span className="kpi-unit">{cmms ? 'WO' : 'งาน'}</span></div>
          <div className="kpi-foot">{cmms ? `ในไฟล์ CMMS ล่าสุด · งานค้าง ${kpi.doing + kpi.stuck} WO · ${kpi.plants} โรง` : `${kpi.plants} โรง`}</div>
        </div>
      </div>
      <KpiCard tone="done" icon="check" label={cmms ? 'เสร็จ / รอปิด' : 'เสร็จแล้ว'} value={kpi.done} pct={kpi.donePct} of={`จาก ${kpi.total} ${unit}`} />
      <KpiCard tone="doing" icon="clock" label="กำลังดำเนินการ" value={kpi.doing} pct={kpi.doingPct} of={`จาก ${kpi.total} ${unit}`} />
      <KpiCard tone="stuck" icon="alert" label={cmms ? 'รอดำเนินการ / ค้าง' : 'ค้าง / เกินกำหนด'} value={kpi.stuck} pct={kpi.stuckPct} of={`จาก ${kpi.total} ${unit}`} />
    </div>
  );
}

export function Highlights({ items }) {
  return (
    <div className="highlights">
      <div className="highlights-head">
        <span className="ico"><Icon name="zap" /></span>KEY HIGHLIGHTS <span className="highlights-sub">สำหรับผู้บริหาร · สรุปอัตโนมัติจากข้อมูล</span>
      </div>
      {items.map((h, i) => (
        <div key={i} className="highlight">
          <span className="highlight-dot" />
          <span><b>{h.k}</b> {h.v}</span>
        </div>
      ))}
    </div>
  );
}
