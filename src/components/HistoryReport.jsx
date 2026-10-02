import { useMemo, useState } from 'react';
import { TEAMS, histSeries, histTotals } from '../lib/cmms.js';
import { TH_M, iso } from '../lib/dates.js';
import { CLOSE, FlowChart, OpenChart, START } from './Report.jsx';

// Year-to-date performance from the imported WO history (Actual Start = opened, CLOSE + Actual Finish = closed),
// kept current by every daily CMMS upload.
const PERIODS = [
  { k: 'today', label: 'วันนี้' },
  { k: 'week', label: '7 วัน' },
  { k: 'month', label: 'เดือนนี้' },
  { k: 'year', label: 'ตั้งแต่ ม.ค.' },
];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dLabel = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${TH_M[m - 1]}`; };

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`rep-tile${tone ? ` is-${tone}` : ''}`}>
      <span className="rep-tile-label">{label}</span>
      <span className="rep-tile-value">{value}</span>
      {sub && <span className="rep-tile-sub">{sub}</span>}
    </div>
  );
}

export default function HistoryReport({ wohist, ids, today, plantLabel, edit, onImport }) {
  const [period, setPeriod] = useState('month');
  const [team, setTeam] = useState('');
  const rows = wohist?.rows || [];
  const tm = team || null;
  const t0 = iso(today);
  const year = today.getFullYear();
  const range = {
    today: [t0, t0],
    week: [iso(addDays(today, -6)), t0],
    month: [iso(new Date(year, today.getMonth(), 1)), t0],
    year: [`${year}-01-01`, t0],
  }[period];

  // Chart buckets: months for the year view, days otherwise (today shows the last 7 days for context).
  const buckets = useMemo(() => {
    if (period === 'year') {
      return Array.from({ length: today.getMonth() + 1 }, (_, m) => {
        const from = iso(new Date(year, m, 1));
        const end = iso(new Date(year, m + 1, 0));
        return { date: from, label: TH_M[m], from, to: end < t0 ? end : t0 };
      });
    }
    const start = period === 'month' ? new Date(year, today.getMonth(), 1) : addDays(today, -6);
    const out = [];
    for (let d = new Date(start); iso(d) <= t0; d = addDays(d, 1)) out.push({ date: iso(d), label: dLabel(iso(d)), from: iso(d), to: iso(d) });
    return out;
  }, [period, t0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wohist) {
    return (
      <section className="panel rep" aria-label="ผลงานสะสม">
        <div className="panel-head">ผลงาน P1 สะสม (ฐานข้อมูลทั้งปี)</div>
        <p className="rep-empty">
          ยังไม่มีฐานข้อมูลประวัติ · {edit
            ? <>กด <button type="button" className="linklike" onClick={onImport}>นำเข้าฐานข้อมูลประวัติ</button> แล้วเลือกไฟล์ที่ export จาก CMMS (P1 ทุกสถานะ รวม CLOSE ตั้งแต่ 1 ม.ค.)</>
            : 'ผู้ที่มีรหัสทีมนำเข้าได้ในโหมดแก้ไข'}
        </p>
      </section>
    );
  }

  const tot = histTotals(rows, ids, range[0], range[1], tm);
  const series = histSeries(rows, ids, buckets, tm).map((b) => ({ date: b.date, label: b.label, started: b.opened, closed: b.closed, open: b.backlogEnd }));
  const teams = TEAMS.filter((x) => x.k !== 'OTHER' || rows.some((h) => h.team === 'OTHER' && ids.includes(Number(h.plant))));
  const byTeam = teams.map((x) => ({ ...x, ...histTotals(rows, ids, range[0], range[1], x.k) }));
  const months = Array.from({ length: today.getMonth() + 1 }, (_, m) => {
    const from = iso(new Date(year, m, 1));
    const end = iso(new Date(year, m + 1, 0));
    return { key: from, label: `${TH_M[m]} ${year + 543}`, from, to: end < t0 ? end : t0 };
  });
  const byMonth = histSeries(rows, ids, months, tm);
  const synced = wohist.syncedAt || wohist.uploadedAt;

  return (
    <section className="panel rep hist" aria-label="ผลงานสะสม">
      <div className="panel-head panel-head-split">
        <span>ผลงาน P1 สะสม · {plantLabel}{tm ? ` · ทีม ${TEAMS.find((x) => x.k === tm).label}` : ' · ทุกทีม'}</span>
        <span className="rep-controls">
          {PERIODS.map((p) => (
            <button key={p.k} type="button" className={`chip chip-on-navy${period === p.k ? ' is-on' : ''}`} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </span>
      </div>

      <div className="rep-chips" role="group" aria-label="เลือกทีม">
        {[{ k: '', label: 'ทุกทีม' }, ...teams].map((x) => (
          <button key={x.k || 'all'} type="button" className={`chip${team === x.k ? ' is-on' : ''}`} onClick={() => setTeam(x.k)}>{x.label}</button>
        ))}
        <span className="rep-rounds">ฐานข้อมูล {rows.length.toLocaleString()} WO · อัปเดต {new Date(synced).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} {new Date(synced).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
      </div>

      <div className="rep-tiles">
        <Tile label="เปิดงาน (Actual Start)" value={tot.opened.toLocaleString()} tone="start" sub={`${dLabel(range[0])} – ${dLabel(range[1])}`} />
        <Tile label="ปิดงาน (CLOSE)" value={tot.closed.toLocaleString()} tone="close" sub={tot.opened ? `${pct(tot.closed, tot.opened)}% ของงานที่เปิด` : undefined} />
        <Tile label="คงค้าง (เริ่มแล้วยังไม่ปิด)" value={tot.backlogEnd.toLocaleString()} sub={`ณ ${dLabel(range[1])}`} />
        <Tile label="กำลังทำ" value={tot.inProgress} sub="ตอนนี้ · INPRG/REWORK" />
        <Tile label="เสร็จรอปิด" value={tot.finishWait} sub="ตอนนี้ · FINISH/COMP/WACCEPT" />
        <Tile label="รอเริ่ม" value={tot.waiting} sub="ตอนนี้ · ยังไม่มี Actual Start" tone={tot.waiting ? 'up' : ''} />
      </div>

      <div className="rep-grid">
        <div>
          <div className="rep-sub panel-head-split">
            <span>เปิดงาน vs ปิดงาน {period === 'year' ? 'รายเดือน' : 'รายวัน'}</span>
            <span className="trend-legend"><span><i style={{ background: START }} />เปิดงาน</span><span><i style={{ background: CLOSE }} />ปิดงาน</span></span>
          </div>
          <FlowChart days={series} names={['เปิดงาน', 'ปิดงาน', 'คงค้าง']} />
          <div className="rep-sub">คงค้าง (เริ่มแล้วยังไม่ปิด) ณ สิ้น{period === 'year' ? 'เดือน' : 'วัน'}</div>
          <OpenChart days={series} name="คงค้าง" />
        </div>
        <div>
          <div className="rep-sub">แยกตามทีม · {dLabel(range[0])} – {dLabel(range[1])}</div>
          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead><tr><th>ทีม</th><th>เปิดงาน</th><th>ปิดงาน</th><th>% ปิด</th><th>คงค้าง</th><th>รอเริ่ม</th></tr></thead>
              <tbody>
                {byTeam.map((x) => (
                  <tr key={x.k} className={team === x.k ? 'is-on' : ''} onClick={() => setTeam(team === x.k ? '' : x.k)}>
                    <th>{x.label}</th><td>{x.opened}</td><td>{x.closed}</td><td>{pct(x.closed, x.opened)}%</td><td><b>{x.backlogEnd}</b></td><td>{x.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rep-sub">รายเดือน {year + 543}</div>
          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead><tr><th>เดือน</th><th>เปิดงาน</th><th>ปิดงาน</th><th>% ปิด</th><th>คงค้างสิ้นเดือน</th></tr></thead>
              <tbody>
                {byMonth.map((m) => (
                  <tr key={m.key}><th>{m.label}</th><td>{m.opened}</td><td>{m.closed}</td><td>{pct(m.closed, m.opened)}%</td><td><b>{m.backlogEnd}</b></td></tr>
                ))}
                <tr className="rep-total">
                  <th>รวม</th>
                  <td>{byMonth.reduce((n, m) => n + m.opened, 0)}</td>
                  <td>{byMonth.reduce((n, m) => n + m.closed, 0)}</td>
                  <td>{pct(byMonth.reduce((n, m) => n + m.closed, 0), byMonth.reduce((n, m) => n + m.opened, 0))}%</td>
                  <td><b>{byMonth.at(-1)?.backlogEnd ?? 0}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Preview before replacing the history with a new yearly export. */
export function HistUploadDialog({ fileName, rows, skipped, current, busy, onConfirm, onCancel }) {
  const closed = rows.filter((h) => /^CLOSE/.test(h.status)).length;
  const per = [5, 10, 6, 11].map((p) => {
    const r = rows.filter((h) => h.plant === p);
    return { p, total: r.length, closed: r.filter((h) => /^CLOSE/.test(h.status)).length, started: r.filter((h) => h.as).length };
  });
  const ass = rows.map((h) => h.as).filter(Boolean).sort();
  const other = rows.filter((h) => h.team === 'OTHER').length;
  return (
    <div className="overlay overlay-top" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="นำเข้าฐานข้อมูลประวัติ" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--navy)' }}><span className="modal-title">นำเข้าฐานข้อมูลประวัติ WO P1</span></div>
        <div className="modal-body-col import-body">
          <p className="import-file">{fileName}</p>
          <div className="merge-stats">
            <span><b>{rows.length.toLocaleString()}</b> WO</span>
            <span className="is-new"><b>{closed.toLocaleString()}</b> ปิดแล้ว (CLOSE)</span>
            <span className="is-changed"><b>{(rows.length - closed).toLocaleString()}</b> ยังไม่ปิด</span>
          </div>
          {ass.length > 0 && <p className="import-note">Actual Start ตั้งแต่ {dLabel(ass[0])} {Number(ass[0].slice(0, 4)) + 543} ถึง {dLabel(ass.at(-1))} {Number(ass.at(-1).slice(0, 4)) + 543}</p>}
          <table className="upload-plants">
            <thead><tr><th>โรง</th><th className="num">ทั้งหมด</th><th className="num">มี Actual Start</th><th className="num">ปิดแล้ว</th></tr></thead>
            <tbody>{per.map((x) => <tr key={x.p}><td>โรงไฟฟ้า {x.p}</td><td className="num">{x.total}</td><td className="num">{x.started}</td><td className="num">{x.closed}</td></tr>)}</tbody>
          </table>
          {other > 0 && <p className="import-note is-bad">{other} WO มีรหัสทีม (WO_Worklocation) ที่ยังไม่ได้จับคู่ เช่น WL5121 → แสดงเป็น "ไม่ระบุ"</p>}
          {skipped?.length > 0 && <p className="import-note">ข้าม WO ของโรงอื่น: {skipped.map((x) => `${x.plant} (${x.count})`).join(', ')}</p>}
          <p className="import-note">{current ? `แทนที่ฐานข้อมูลเดิม (${current.rows.length.toLocaleString()} WO) ทั้งชุด · ` : ''}หลังจากนี้ทุกครั้งที่อัปโหลดไฟล์ CMMS ประจำวัน ฐานข้อมูลนี้จะอัปเดตสถานะให้อัตโนมัติ (งานที่หายจากไฟล์ = ปิดแล้ว)</p>
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-foot-right">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
            <button type="button" className="btn btn-save" disabled={busy || !rows.length} onClick={onConfirm}>{busy ? 'กำลังนำเข้า…' : `นำเข้า ${rows.length.toLocaleString()} WO`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
