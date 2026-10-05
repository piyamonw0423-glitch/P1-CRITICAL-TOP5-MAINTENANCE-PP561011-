// Per-plant round report (09:30 start of work / 16:30 end of work) built from the day's stats doc.
// Shared by the LINE push (server/line.js) and the "copy summary" button (components/Report.jsx).
import { PLANT_IDS } from './data.js';
import { TH_M, pd } from './dates.js';
import { insertedWos, normWo, statTotals } from './cmms.js';

const thai = (ms) => new Date(ms + 7 * 3600e3);
export const thaiHm = (isoTs) => { const d = thai(Date.parse(isoTs)); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} น.`; };
const thaiDate = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? String(n) : '±0');

/** Morning upload (before noon, Thai time) = start-of-work round, otherwise end-of-work round. */
export const roundLabel = (isoTs) => (thai(Date.parse(isoTs)).getUTCHours() < 12 ? 'รอบ 09:30 น. (เริ่มงาน)' : 'รอบ 16:30 น. (จบงาน)');

/** Numbers for some plants: opened, inserted, finished-or-closed (unique WOs), closed, open, open change vs prev day. */
export function plantNumbers(cur, prev, ids) {
  const t = statTotals(cur, ids);
  const keep = ([, p, tm]) => ids.includes(Number(p)) && tm !== 'OTHER';
  const done = new Set([...(cur?.finished || []), ...(cur?.closed || [])].filter(keep).map((x) => String(x[0])));
  return { opened: t.opened, newInFile: t.new, inserted: t.inserted, done: done.size, closed: t.closed, waitClose: t.finished, open: t.open, delta: prev ? t.open - statTotals(prev, ids).open : null };
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
  // WOs opened on the day (Actual Start = that day), inserted (also new in the file) first.
  const ins = insertedWos(cur);
  const fresh = (cur.opened || cur.new || []).filter(([, p, tm]) => ids.includes(Number(p)) && tm !== 'OTHER')
    .map((t) => [t[0], t[1], t[2], t[3], ins.has(normWo(t[0])) ? 1 : 0])
    .sort((a, b) => b[4] - a[4]);
  const MAX_NEW = 20; // keeps the message well under LINE's 5,000 characters
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
    ...(fresh.length ? ['', `เปิดงานวันนี้ (Actual Start) ${fresh.length} WO (⚡ = แทรกระหว่างวัน):`,
      ...fresh.slice(0, MAX_NEW).map(([wo, p, tm, , f]) => {
        const r = byWo.get(String(wo));
        return `${f === 1 ? '⚡' : '•'} ${wo} PP${p} ${tm}${r?.status ? ` ${r.status}` : ''} – ${String(r?.desc || '').slice(0, 60)}`;
      }),
      ...(fresh.length > MAX_NEW ? [`…และอีก ${fresh.length - MAX_NEW} รายการ (ดูในเว็บ)`] : [])] : []),
    '',
    `WO ใหม่ในไฟล์ (เทียบรอบก่อน) ${all.newInFile} · นับสะสมทั้งวัน · เปิดงาน = Actual Start วันนี้ · เสร็จ/ปิด = เสร็จรอปิด + CLOSED (รวมไม่พบในไฟล์ล่าสุด) · คงค้างเทียบเมื่อวาน`,
    ...(url ? [`🔗 ${url}`] : []),
  ].join('\n');
}
