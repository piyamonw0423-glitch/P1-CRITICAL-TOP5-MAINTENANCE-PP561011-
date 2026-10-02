// Per-plant round report (09:30 start of work / 16:30 end of work) built from the day's stats doc.
// Shared by the LINE push (server/line.js) and the "copy summary" button (components/Report.jsx).
import { PLANT_IDS } from './data.js';
import { TH_M, pd } from './dates.js';
import { statTotals } from './cmms.js';

const thai = (ms) => new Date(ms + 7 * 3600e3);
export const thaiHm = (isoTs) => { const d = thai(Date.parse(isoTs)); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} น.`; };
const thaiDate = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? String(n) : '±0');

/** Morning upload (before noon, Thai time) = start-of-work round, otherwise end-of-work round. */
export const roundLabel = (isoTs) => (thai(Date.parse(isoTs)).getUTCHours() < 12 ? 'รอบ 09:30 น. (เริ่มงาน)' : 'รอบ 16:30 น. (จบงาน)');

/** Numbers for some plants: opened, inserted, finished-or-closed (unique WOs), closed, open, open change vs prev day. */
export function plantNumbers(cur, prev, ids) {
  const t = statTotals(cur, ids);
  const keep = ([, p]) => ids.includes(Number(p));
  const done = new Set([...(cur?.finished || []), ...(cur?.closed || [])].filter(keep).map((x) => String(x[0])));
  return { opened: t.new, inserted: t.inserted, done: done.size, closed: t.closed, waitClose: t.finished, open: t.open, delta: prev ? t.open - statTotals(prev, ids).open : null };
}

/**
 * @param cur, prev  stats docs of the report day and the day before (prev optional)
 * @param backlog    backlog doc (for WO descriptions), optional
 * @param ids        plants to include (default all)
 */
export function roundReportText({ cur, prev = null, backlog = null, url = '', ids = PLANT_IDS }) {
  if (!cur) return `ยังไม่มีรายงาน — อัปโหลดไฟล์ CMMS ในโหมดแก้ไขก่อน${url ? `\n🔗 ${url}` : ''}`;
  const last = cur.rounds?.at(-1);
  const all = plantNumbers(cur, prev, ids);
  const byWo = new Map((backlog?.rows || []).map((r) => [String(r.wo), r]));
  const inserted = (cur.new || []).filter(([, p, , , f]) => ids.includes(Number(p)) && f === 1);
  const line = (n) => `เปิดงาน ${n.opened} · ⚡แทรก ${n.inserted} · เสร็จ/ปิด ${n.done} · คงค้าง ${n.open}${n.delta != null ? ` (${signed(n.delta)})` : ''}`;
  return [
    `📋 สรุป WO P1 · ${last ? roundLabel(last.at) : ''}`,
    `${thaiDate(cur.date)}${last ? ` · อัปเดต ${thaiHm(last.at)}` : ''}`,
    `📌 ข้อมูลจาก CMMS${last?.fileName ? ` (${last.fileName})` : ''}`,
    '',
    `รวม ${ids.length} โรง: ${line(all)}`,
    `  (CLOSED ${all.closed} · เสร็จรอปิด ${all.waitClose})`,
    '',
    ...ids.map((id) => `🏭 PP${id}: ${line(plantNumbers(cur, prev, [id]))}`),
    ...(inserted.length ? ['', `⚡ งานแทรกระหว่างวัน ${inserted.length} WO (Actual Start วันนี้)`,
      ...inserted.slice(0, 10).map(([wo, p, tm]) => `• ${wo} PP${p} ${tm} – ${String(byWo.get(String(wo))?.desc || '').slice(0, 45)}`),
      ...(inserted.length > 10 ? [`…และอีก ${inserted.length - 10} รายการ`] : [])] : []),
    '',
    'นับสะสมทั้งวัน · เสร็จ/ปิด = เสร็จรอปิด + CLOSED (รวมไม่พบในไฟล์ล่าสุด) · คงค้างเทียบเมื่อวาน',
    ...(url ? [`🔗 ${url}`] : []),
  ].join('\n');
}
