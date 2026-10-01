// WO Backlog from the CMMS export ("List of Work Orders" .xlsx): parsing, status groups and the
// link to Top 5 jobs. The backlog is a read-only snapshot replaced on every upload.
import { PLANT_IDS } from './data.js';
import { iso } from './dates.js';

/** Status groups agreed with the maintenance team (order = display order). */
export const STATUS_GROUPS = [
  { key: 'plan', label: 'รอวางแผน/อนุมัติ', codes: ['WPLAN', 'WAPPR', 'WAPPR_L1', 'WAPPR_L2', 'WAPPR_L3', 'RETURNED', 'REJECTED', 'WSHUT'], color: 'oklch(0.62 0.03 258)' },
  { key: 'assigned', label: 'วางแผนแล้ว รอดำเนินการ', codes: ['ASSIGNED'], color: 'oklch(0.6 0.13 230)' },
  { key: 'nis', label: 'รอ NIS เข้างาน', codes: ['WCTRLSUP', 'WCTRLTEAM'], color: 'oklch(0.6 0.15 300)' },
  { key: 'contractor', label: 'งานจ้างภายนอก', codes: ['WCONTRACTOR'], color: 'oklch(0.58 0.12 200)' },
  { key: 'material', label: 'รออะไหล่', codes: ['WMATL'], color: 'oklch(0.63 0.18 45)' },
  { key: 'inprg', label: 'กำลังดำเนินการ', codes: ['APPR', 'INPRG'], color: 'oklch(0.75 0.15 80)' },
  { key: 'rework', label: 'งานซ่อมซ้ำ', codes: ['REWORK'], color: 'oklch(0.6 0.21 25)' },
  { key: 'finish', label: 'เสร็จ/รอปิด', codes: ['FINISH', 'WACCEPT', 'COMP'], color: 'oklch(0.62 0.16 150)' },
  { key: 'closed', label: 'ปิดแล้ว', codes: ['CLOSED'], color: 'oklch(0.5 0.08 150)' },
  { key: 'other', label: 'อื่นๆ', codes: [], color: 'oklch(0.7 0.02 258)' },
];
const GROUP_BY_CODE = Object.fromEntries(STATUS_GROUPS.flatMap((g) => g.codes.map((c) => [c, g])));
export const groupOf = (status) => GROUP_BY_CODE[String(status || '').trim().toUpperCase()] || STATUS_GROUPS.at(-1);
/** Finished or closed in the CMMS: no longer backlog. */
export const isClosedGroup = (key) => key === 'finish' || key === 'closed';

export const normWo = (w) => String(w || '').replace(/\s+/g, '').toUpperCase();

// CMMS dates are instants; the dashboard works in Thai calendar days (UTC+7).
const thaiDay = (v) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(d.getTime() + 7 * 3600e3);
  return iso(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
};
const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));

// Export column → stored field. Only what the dashboard shows is kept.
const FIELDS = {
  wo: 'Work Order', desc: 'Description', plant: 'Plant', status: 'Status', location: 'Location', asset: 'Asset',
  parent: 'Parent WO', workType: 'Work Type', nextApprove: 'Next Approve', owner: 'ON BEHALF OF NAME',
  targetStart: 'Target Start', targetFinish: 'Target Finish', schedStart: 'Scheduled Start', schedFinish: 'Scheduled Finish',
  actualStart: 'Actual Start', actualFinish: 'Actual Finish', value: 'Est. Job Value',
};
const DATE_FIELDS = ['targetStart', 'targetFinish', 'schedStart', 'schedFinish', 'actualStart', 'actualFinish'];

/** True when a header row looks like the CMMS work-order export. */
export const isBacklogHeader = (row) => ['Work Order', 'Status', 'Plant'].every((h) => row.some((c) => str(c) === h));

/**
 * Parse the CMMS export. Returns { rows, skipped: {plant, count}[], unknownStatuses: string[] }.
 * Rows outside plants 5/10/6/11 are skipped (reported), duplicate WOs keep the first.
 */
export async function parseBacklogWorkbook(file) {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  for (const sheet of sheets) {
    const at = sheet.data.findIndex(isBacklogHeader);
    if (at < 0) continue;
    const head = sheet.data[at].map((c) => str(c));
    const idx = Object.fromEntries(Object.entries(FIELDS).map(([f, h]) => [f, head.indexOf(h)]));
    const seen = new Set();
    const rows = [];
    const skipped = {};
    const unknown = new Set();
    for (const r of sheet.data.slice(at + 1)) {
      const get = (f) => (idx[f] >= 0 ? r[idx[f]] : null);
      const wo = str(get('wo'), 40);
      if (!wo || seen.has(normWo(wo))) continue;
      seen.add(normWo(wo));
      const plantCode = str(get('plant'));
      const plant = Number(plantCode.replace(/\D/g, ''));
      if (!PLANT_IDS.includes(plant)) { skipped[plantCode || '(ว่าง)'] = (skipped[plantCode || '(ว่าง)'] || 0) + 1; continue; }
      const status = str(get('status'), 30).toUpperCase();
      if (groupOf(status).key === 'other') unknown.add(status || '(ว่าง)');
      const row = { wo, plant, status };
      for (const f of ['desc', 'location', 'asset', 'parent', 'workType', 'nextApprove', 'owner']) row[f] = str(get(f), f === 'desc' ? 300 : 80);
      for (const f of DATE_FIELDS) row[f] = thaiDay(get(f));
      row.value = Number(get('value')) || 0;
      rows.push(row);
    }
    return { rows, skipped: Object.entries(skipped).map(([plant, count]) => ({ plant, count })), unknownStatuses: [...unknown] };
  }
  throw new Error('ไม่พบหัวคอลัมน์ "Work Order", "Status", "Plant" — ใช้ไฟล์ List of Work Orders ที่ export จาก CMMS');
}

/** Days a WO has been open, counted from Target Start (or Scheduled Start) to today. */
export const ageDays = (row, today) => {
  const from = row.targetStart || row.schedStart;
  if (!from) return null;
  const [y, m, d] = from.split('-').map(Number);
  return Math.max(0, Math.round((today - new Date(y, m - 1, d)) / 864e5));
};

/** Counts per status group for a set of rows: { total, open, byGroup: {key: n} }. */
export function summarize(rows) {
  const byGroup = {};
  rows.forEach((r) => { const k = groupOf(r.status).key; byGroup[k] = (byGroup[k] || 0) + 1; });
  const open = rows.filter((r) => !isClosedGroup(groupOf(r.status).key)).length;
  return { total: rows.length, open, byGroup };
}

/**
 * A new Top 5 job prefilled from a backlog WO (the team then adds plan, owner, progress, photos).
 * A CMMS finish date already in the past becomes "today + 7" so the team sets a fresh target.
 */
export function jobFromWo(row, today, rank = 1) {
  const g = groupOf(row.status).key;
  const start = row.actualStart || row.schedStart || row.targetStart || iso(today);
  const inAWeek = new Date(today); inAWeek.setDate(inAWeek.getDate() + 7);
  let end = row.schedFinish || row.targetFinish;
  if (!end || end < iso(today)) end = iso(inAWeek);
  if (end < start) end = start;
  return {
    id: null,
    rank,
    wo: row.wo,
    plant: row.plant,
    issue: row.desc || row.wo,
    action: '',
    owner: row.owner || '',
    team: '',
    start,
    end,
    progress: isClosedGroup(g) ? 100 : 0,
    status: isClosedGroup(g) ? 'done' : g === 'inprg' || g === 'rework' ? 'doing' : 'pending',
    blocker: g === 'material' ? 'part' : g === 'contractor' || g === 'nis' ? 'vendor' : 'none',
    note: `CMMS: ${row.status}${row.nextApprove ? ` · รออนุมัติโดย ${row.nextApprove}` : ''}`,
    photos: [],
  };
}
