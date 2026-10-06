// Analysed daily update for LINE: what changed since the previous report day (open backlog, status groups,
// teams, per plant), what opened / closed today, and what still needs pushing (aging, oldest WOs, approvers).
// Every upload stores a compact summary in the day's stats doc (`dash`) so the next day can be compared with it.
import { PLANT_IDS } from './data.js';
import { TH_M, pd } from './dates.js';
import { STATUS_GROUPS, TEAMS, insertedWos, normWo, statTotals } from './cmms.js';
import { backlogDashboard } from './backlogDash.js';
import { plantNumbers, roundLabel } from './roundReport.js';

const GROUP = Object.fromEntries(STATUS_GROUPS.map((g) => [g.key, g]));
const TEAM_KEYS = TEAMS.filter((t) => t.k !== 'OTHER').map((t) => t.k);

/** Compact snapshot of the open backlog (all plants) kept in stats/<day>.dash — a few hundred bytes. */
export function compactDash(rows, today) {
  const d = backlogDashboard(rows || [], PLANT_IDS, today);
  return {
    open: d.total,
    avg: d.kpi.avgAge,
    over180: d.kpi.over180,
    over365: d.kpi.over365,
    groups: Object.fromEntries(d.groups.map((g) => [g.key, [g.count, g.avgAge]])),
    teams: Object.fromEntries(d.teams.map((t) => [t.k, [t.count, t.over180]])),
    oldest: d.oldest.map((r) => [String(r.wo), r.age, r.g]),
    appr365: d.approvers.filter((a) => a.over365).sort((a, b) => b.over365 - a.over365).slice(0, 3).map((a) => [a.name, a.over365]),
  };
}

const thaiShort = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`; };
const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? String(n) : '±0');
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || s;

/**
 * @param cur, prev  stats docs (today, previous report day); prev optional
 * @param backlog    backlog doc — descriptions, and today's summary when cur.dash is missing (older docs)
 * @param today      Date (Thai day) used only for that fallback
 */
export function analysisText({ cur, prev = null, backlog = null, url = '', today = new Date() }) {
  if (!cur) return `ยังไม่มีรายงาน — อัปโหลดไฟล์ CMMS ในโหมดแก้ไขก่อน${url ? `\n🔗 ${url}` : ''}`;
  const ids = PLANT_IDS;
  const now = cur.dash || (backlog ? compactDash(backlog.rows, today) : null);
  const was = prev?.dash || null;
  const byWo = new Map((backlog?.rows || []).map((r) => [normWo(r.wo), r]));
  const t = statTotals(cur, ids);
  const p = prev ? statTotals(prev, ids) : null;
  const last = cur.rounds?.at(-1);
  const vsLabel = prev ? `เทียบกับ ${thaiShort(prev.date)}` : 'วันแรกที่บันทึก';
  const lines = [`📊 Update : WO Backlog P1 · ${thaiShort(cur.date)}${last ? ` · ${roundLabel(last.at)}` : ''} (${vsLabel})`, ''];

  // 1) Open backlog vs previous day
  const openNow = now ? now.open : t.open;
  const openWas = was ? was.open : p ? p.open : null;
  if (openWas != null) {
    const dv = openNow - openWas;
    lines.push(dv < 0 ? `✅ งานค้างลดลง ${-dv} WO (${openWas} → ${openNow})` : dv > 0 ? `⚠️ งานค้างเพิ่มขึ้น ${dv} WO (${openWas} → ${openNow})` : `➖ งานค้างเท่าเดิม ${openNow} WO`);
  } else lines.push(`📌 งานค้าง ${openNow} WO`);
  if (now && was) {
    const moved = Object.keys({ ...now.groups, ...was.groups })
      .map((k) => [k, (now.groups[k]?.[0] || 0), (was.groups[k]?.[0] || 0)])
      .filter(([, a, b]) => a !== b)
      .sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))
      .slice(0, 3);
    for (const [k, a, b] of moved) lines.push(`• ${GROUP[k]?.label || k} ${b} → ${a} (${sign(a - b)})`);
  }
  // Team change: from the stored summary, else from the open snapshot (plant|team keys).
  const teamOpen = (doc, k) => (doc?.dash ? doc.dash.teams[k]?.[0] || 0 : statTotals(doc, ids, k).open);
  if (prev) {
    const nowDoc = cur.dash ? cur : { ...cur, dash: now };
    const deltas = TEAM_KEYS.map((k) => [k, teamOpen(nowDoc, k) - teamOpen(prev, k)]);
    const changed = deltas.filter(([, d]) => d).sort((a, b) => a[1] - b[1]).map(([k, d]) => `${k} ${sign(d)}`);
    const same = deltas.filter(([, d]) => !d).map(([k]) => k);
    lines.push(`• ${[...changed, ...(same.length ? [`${same.join(', ')} เท่าเดิม`] : [])].join(' | ')}`);
  }
  lines.push('');

  // 2) Per plant
  for (const id of ids) {
    const n = plantNumbers(cur, prev, [id]);
    lines.push(`🏭 PP${id}: เปิดงาน ${n.opened} · ⚡แทรก ${n.inserted} · เสร็จ/ปิด ${n.done} · คงค้าง ${n.open}${n.delta != null ? ` (${sign(n.delta)})` : ''}`);
  }
  lines.push('');

  // 3) Priority 1 today: opened (with names) and closed
  const ins = insertedWos(cur);
  const opened = (cur.opened || cur.new || []).filter((x) => ids.includes(Number(x[1])) && x[2] !== 'OTHER')
    .sort((a, b) => ins.has(normWo(b[0])) - ins.has(normWo(a[0])));
  lines.push(`📌 Priority 1 วันนี้: เปิดงาน ${t.opened} WO${t.inserted ? ` (⚡แทรก ${t.inserted})` : ''} · CLOSED ${t.closed} WO${t.assumed ? ` (Status ${t.closedStatus} + ไม่พบในไฟล์ ${t.assumed})` : ''} · เสร็จรอปิด ${t.finished} WO`);
  for (const [wo, plant, team] of opened.slice(0, 15)) {
    const r = byWo.get(normWo(wo));
    lines.push(`${ins.has(normWo(wo)) ? '⚡' : '•'} ${wo} PP${plant} ${team}${r?.status ? ` ${r.status}` : ''} – ${String(r?.desc || '').slice(0, 55)}`);
  }
  if (opened.length > 15) lines.push(`…และอีก ${opened.length - 15} รายการ (ดูในเว็บ)`);
  if (!opened.length) lines.push('• วันนี้ยังไม่มีงานที่ Actual Start เป็นวันนี้');
  lines.push('');

  // 4) What still needs pushing (rules on the stored summaries)
  if (now) {
    const warn = [];
    const d365 = was ? now.over365 - was.over365 : null;
    if (now.over365) warn.push(`• งานค้างเกิน 1 ปี ${d365 == null ? `มี ${now.over365} WO` : d365 === 0 ? `ยังมี ${now.over365} WO เท่าเดิม` : `${now.over365} WO (${sign(d365)})`}`);
    if (now.oldest.length) {
      const maxAge = now.oldest[0][1];
      const allPlan = now.oldest.every((o) => o[2] === 'plan');
      const stuck = was ? now.oldest.filter(([wo, , g]) => was.oldest.some(([w, , pg]) => w === wo && pg === g)).length : null;
      const moveTxt = stuck == null ? '' : stuck === now.oldest.length ? 'ยังไม่ขยับ' : `ขยับ ${now.oldest.length - stuck} WO`;
      warn.push(`• ${now.oldest.length} WO ที่ค้างนานที่สุด${moveTxt ? ` ${moveTxt}` : ''}${allPlan ? ' และยังรอวางแผน/อนุมัติทั้งหมด' : ''} (นานสุด ${maxAge} วัน)`);
    }
    const planNow = now.groups.plan, planWas = was?.groups.plan;
    if (planNow) warn.push(`• กลุ่มรอวางแผน/อนุมัติค้างเฉลี่ย ${planNow[1]} วัน${planWas ? ` (${sign(planNow[1] - planWas[1])})` : ''}`);
    const topTeam = TEAM_KEYS.map((k) => [k, now.teams[k]?.[1] || 0]).sort((a, b) => b[1] - a[1])[0];
    if (topTeam?.[1]) {
      const wasN = was?.teams[topTeam[0]]?.[1];
      warn.push(`• ${topTeam[0]} มีงานค้างเกิน 180 วันมากสุด ${topTeam[1]} WO${wasN != null ? ` (${sign(topTeam[1] - wasN)})` : ''}`);
    }
    if (warn.length) lines.push('⚠️ จุดที่ยังต้องเร่ง', ...warn, '');

    const asks = [];
    if (now.over365) {
      const who = now.appr365[0];
      asks.push(`ช่วยเคลียร์งานค้างเกิน 1 ปีก่อน${who ? ` โดยเฉพาะ ${who[1]} WO ที่รอคุณ ${firstName(who[0])}` : ''}`);
    }
    if (topTeam?.[1]) asks.push(`ทีม ${topTeam[0]} ช่วยทบทวนงานที่ค้างเกิน 180 วัน`);
    if (asks.length) lines.push('รบกวนเจ้าของงานช่วยเร่งเคลียร์ค่ะ', ...asks, '');
  }
  lines.push(`📌 ข้อมูลจาก CMMS${last?.fileName ? ` (${last.fileName})` : ''}`);
  if (url) lines.push(`🔗 Data link : ${url}`);
  return lines.join('\n');
}
