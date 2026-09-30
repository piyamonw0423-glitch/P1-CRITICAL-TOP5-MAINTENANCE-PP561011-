// Excel (.xlsx) export/import for the dashboard. The exported file doubles as the template:
// edit rows in Excel, then import it back. Libraries load on demand to keep the page small.
import { BLOCK, PLANT_IDS, STATUS } from './data.js';
import { iso } from './dates.js';

export const JOB_SHEET = 'งาน P1';
export const IMPACT_SHEET = 'ผลกระทบ';

// [header, field, column width]
const COLS = [
  ['โรงไฟฟ้า', 'plant', 10],
  ['ลำดับ', 'rank', 8],
  ['เลข WO', 'wo', 16],
  ['ปัญหาเครื่องจักร', 'issue', 42],
  ['แนวทางดำเนินงาน', 'action', 36],
  ['ผู้รับผิดชอบ', 'owner', 16],
  ['แผนก/ทีม', 'team', 14],
  ['วันเริ่ม', 'start', 13],
  ['วันกำหนดเสร็จ', 'end', 15],
  ['ความคืบหน้า (%)', 'progress', 15],
  ['สถานะ', 'status', 13],
  ['ติดปัญหา', 'blocker', 15],
  ['รายละเอียดปัญหาหน้างาน', 'note', 46],
];

const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v.label, k]));
const BLOCK_BY_LABEL = Object.fromEntries(Object.entries(BLOCK).map(([k, v]) => [v.label, k]));
const HEAD = { fontWeight: 'bold', backgroundColor: '#1B2A4A', color: '#FFFFFF', align: 'center' };

// Excel stores dates without a time zone; build them in UTC so no offset creeps in.
const toExcelDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** Build the workbook (jobs + impacts + instructions) as a Blob. */
export async function buildWorkbook(data) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const order = (p) => PLANT_IDS.indexOf(p);
  const jobs = [...data.jobs].sort((a, b) => order(a.plant) - order(b.plant) || a.rank - b.rank);
  const jobRows = [
    COLS.map(([h]) => ({ value: h, ...HEAD })),
    ...jobs.map((j) => COLS.map(([, f]) => {
      if (f === 'start' || f === 'end') return j[f] ? { value: toExcelDate(j[f]), format: 'dd/mm/yyyy' } : null;
      if (f === 'status') return STATUS[j.status]?.label || '';
      if (f === 'blocker') return (BLOCK[j.blocker] || BLOCK.none).label;
      if (f === 'plant' || f === 'rank' || f === 'progress') return Number(j[f]) || 0;
      return j[f] ? String(j[f]) : null;
    })),
  ];
  const impactRows = [
    [{ value: 'โรงไฟฟ้า', ...HEAD }, { value: 'ผลกระทบต่อโรงไฟฟ้า (1 แถว = 1 ข้อ)', ...HEAD }],
    ...PLANT_IDS.flatMap((pid) => (data.plants[pid]?.impact || []).map((line) => [pid, line])),
  ];
  const help = [
    [{ value: 'วิธีใช้ไฟล์นี้', fontWeight: 'bold' }],
    ['1. แก้ไข เพิ่ม หรือลบแถวในชีต "งาน P1" (1 แถว = 1 งาน) ห้ามแก้ชื่อหัวคอลัมน์'],
    ['2. ช่องที่ต้องกรอก: โรงไฟฟ้า, ปัญหาเครื่องจักร, วันกำหนดเสร็จ · ช่องอื่นเว้นว่างได้'],
    ['3. งานที่มีเลข WO ตรงกับในเว็บจะถูกอัปเดต งานที่ไม่ตรงจะถูกเพิ่มใหม่ (รูปหน้างานเดิมไม่หาย)'],
    ['4. บันทึกไฟล์เป็น .xlsx แล้วในเว็บกด "อัปเดตงานประจำวัน" → "นำเข้า Excel"'],
    [''],
    [{ value: 'ค่าที่ใช้ได้', fontWeight: 'bold' }],
    ['โรงไฟฟ้า', PLANT_IDS.join(', ')],
    ['สถานะ', Object.values(STATUS).map((s) => s.label).join(', ') + ' (เว้นว่าง = คำนวณจากความคืบหน้า)'],
    ['ติดปัญหา', Object.values(BLOCK).map((b) => b.label).join(', ')],
    ['วันที่', 'วว/ดด/ปปปป (ค.ศ. หรือ พ.ศ. ก็ได้) หรือ ปปปป-ดด-วว'],
    ['ความคืบหน้า', 'ตัวเลข 0–100'],
  ];
  return writeXlsxFile([
    { data: jobRows, sheet: JOB_SHEET, columns: COLS.map(([, , width]) => ({ width })), stickyRowsCount: 1 },
    { data: impactRows, sheet: IMPACT_SHEET, columns: [{ width: 10 }, { width: 60 }], stickyRowsCount: 1 },
    { data: help, sheet: 'วิธีใช้', columns: [{ width: 16 }, { width: 90 }] },
  ]).toBlob();
}

/* ---------------- parsing ---------------- */

const text = (v) => (v == null ? '' : v instanceof Date ? iso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())) : String(v).trim());

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === 'number') { // Excel serial day number
    const d = new Date(Math.round((v - 25569) * 864e5));
    return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v).trim();
  let y, m, d;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) [, y, m, d] = r.map(Number);
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) [, d, m, y] = r.map(Number);
  else return undefined;
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543; // Buddhist era
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return iso(dt);
}

/**
 * Read an .xlsx file. Returns { jobs, plants, errors, total } where jobs have no id/photos yet,
 * plants only lists plants that appear in the impact sheet, and errors are [{ row, msg }].
 */
export async function parseWorkbook(file) {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  const sheet = sheets.find((s) => s.sheet.trim() === JOB_SHEET) || sheets[0];
  if (!sheet) throw new Error('ไม่พบชีตข้อมูลในไฟล์');
  const rows = sheet.data;
  const headerAt = rows.findIndex((r) => r.some((c) => text(c) === 'ปัญหาเครื่องจักร'));
  if (headerAt < 0) throw new Error(`ไม่พบหัวคอลัมน์ "ปัญหาเครื่องจักร" ในชีต "${sheet.sheet}" ใช้ไฟล์ที่ส่งออกจากเว็บเป็นแม่แบบ`);
  const idx = {};
  rows[headerAt].forEach((c, i) => { const col = COLS.find(([h]) => h === text(c)); if (col) idx[col[1]] = i; });

  const jobs = [];
  const errors = [];
  const nextRank = {};
  rows.slice(headerAt + 1).forEach((r, k) => {
    const row = headerAt + k + 2; // 1-based Excel row number
    const get = (f) => (idx[f] == null ? null : r[idx[f]]);
    if (COLS.every(([, f]) => text(get(f)) === '')) return; // blank row
    const problems = [];

    const plant = Number(String(text(get('plant'))).replace(/\D/g, ''));
    if (!PLANT_IDS.includes(plant)) problems.push(`โรงไฟฟ้า "${text(get('plant'))}" ไม่ถูกต้อง (ใช้ ${PLANT_IDS.join(', ')})`);
    const issue = text(get('issue'));
    if (!issue) problems.push('ไม่มีปัญหาเครื่องจักร');

    const end = parseDate(get('end'));
    if (!end) problems.push(end === undefined ? `วันกำหนดเสร็จ "${text(get('end'))}" อ่านไม่ได้` : 'ไม่มีวันกำหนดเสร็จ');
    let start = parseDate(get('start'));
    if (start === undefined) { problems.push(`วันเริ่ม "${text(get('start'))}" อ่านไม่ได้`); start = null; }

    let progress = Number(text(get('progress')).replace('%', '')) || 0;
    if (progress > 0 && progress <= 1 && !Number.isInteger(progress)) progress *= 100; // cell formatted as %
    progress = Math.round(Math.min(100, Math.max(0, progress)));

    const st = text(get('status'));
    let status = STATUS_BY_LABEL[st] || (STATUS[st] ? st : null);
    if (st && !status) problems.push(`สถานะ "${st}" ไม่รู้จัก`);
    if (!status) status = progress >= 100 ? 'done' : progress > 0 ? 'doing' : 'pending';
    if (status === 'done') progress = 100;

    const bl = text(get('blocker'));
    const blocker = BLOCK_BY_LABEL[bl] || (BLOCK[bl] ? bl : bl ? null : 'none');
    if (!blocker) problems.push(`ติดปัญหา "${bl}" ไม่รู้จัก`);

    if (problems.length) { errors.push({ row, msg: problems.join(' · ') }); return; }
    nextRank[plant] = (nextRank[plant] || 0) + 1;
    jobs.push({
      plant,
      rank: Math.max(1, parseInt(text(get('rank')), 10) || nextRank[plant]),
      wo: text(get('wo')),
      issue,
      action: text(get('action')),
      owner: text(get('owner')),
      team: text(get('team')),
      start: start || end,
      end,
      progress,
      status,
      blocker,
      note: text(get('note')),
    });
  });

  const plants = {};
  const impactSheet = sheets.find((s) => s.sheet.trim() === IMPACT_SHEET);
  impactSheet?.data.slice(1).forEach((r) => {
    const pid = Number(String(text(r[0])).replace(/\D/g, ''));
    const line = text(r[1]);
    if (PLANT_IDS.includes(pid) && line) (plants[pid] ||= { impact: [] }).impact.push(line);
  });

  return { jobs, plants, errors, total: jobs.length + errors.length };
}

const normWo = (w) => String(w || '').replace(/\s+/g, '').toUpperCase();

/**
 * Match imported rows to existing jobs (by WO number, else plant + issue text) and plan the change.
 * 'merge' updates matches and adds the rest; 'replace' also removes jobs missing from the file.
 * Imported jobs carry no `photos` key, so every backend keeps the matched job's photos.
 */
export function planImport(current, parsed, mode) {
  const byWo = new Map(current.jobs.filter((j) => j.wo).map((j) => [normWo(j.wo), j]));
  const byKey = new Map(current.jobs.map((j) => [`${j.plant}|${j.issue.trim()}`, j]));
  const used = new Set();
  let added = 0, updated = 0;
  const jobs = parsed.jobs.map((p, i) => {
    const m = (p.wo && byWo.get(normWo(p.wo))) || byKey.get(`${p.plant}|${p.issue}`);
    if (m && !used.has(m.id)) { used.add(m.id); updated++; return { ...p, id: m.id }; }
    added++;
    return { ...p, id: `j${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}` };
  });
  const removed = mode === 'replace' ? current.jobs.filter((j) => !used.has(j.id)).length : 0;
  return { jobs, added, updated, removed };
}
