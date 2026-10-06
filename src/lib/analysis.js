// Analysed daily update for LINE: what changed since the previous report day (open backlog, status groups,
// teams, per plant), what opened / closed today, and what still needs pushing (aging, oldest WOs, approvers).
// Every upload stores a compact summary in the day's stats doc (`dash`) so the next day can be compared with it.
import { PLANT_IDS } from './data.js';
import { TH_M, pd } from './dates.js';
import { STATUS_GROUPS, TEAMS, groupOf, insertedWos, normWo, statTotals, withEntered } from './cmms.js';
import { backlogDashboard } from './backlogDash.js';
import { plantNumbers, roundLabel } from './roundReport.js';

const GROUP = Object.fromEntries(STATUS_GROUPS.map((g) => [g.key, g]));
const TEAM_KEYS = TEAMS.filter((t) => t.k !== 'OTHER').map((t) => t.k);
const GROUP_OF = (r) => (r ? groupOf(r.status).key : null);

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
export function analysisText({ cur, prev = null, backlog = null, url = '', today = new Date(), latest = true }) {
  if (!cur) return `ยังไม่มีรายงาน — อัปโหลดไฟล์ CMMS ในโหมดแก้ไขก่อน${url ? `\n🔗 ${url}` : ''}`;
  cur = withEntered(cur, backlog, latest); // "entered" of the latest day comes from the WO list itself
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

  // 2) Priority 1 today: WOs that entered the backlog, WOs actually started (Actual Start), closed
  const inScope = (x) => ids.includes(Number(x[1])) && x[2] !== 'OTHER';
  const rowOf = (wo) => byWo.get(normWo(wo));
  const woLine = (mark, [wo, plant, team]) => {
    const r = rowOf(wo);
    return `${mark} ${wo} PP${plant} ${team}${r?.status ? ` ${r.status}` : ''} – ${String(r?.desc || '').slice(0, 55)}`;
  };
  const LIST_MAX = 10;
  const more = (list) => (list.length > LIST_MAX ? [`…และอีก ${list.length - LIST_MAX} รายการ (ดูในเว็บ)`] : []);
  const entered = cur.entered ? cur.entered.filter(inScope) : null;
  lines.push('📌 Priority 1 วันนี้');
  if (entered) {
    lines.push(`🆕 WO ใหม่ที่เข้า Backlog ${entered.length} WO (งานค้างที่ไม่อยู่ใน Backlog รอบก่อน)`);
    for (const x of entered.slice(0, LIST_MAX)) lines.push(woLine('•', x));
    lines.push(...more(entered));
  }
  const ins = insertedWos(cur);
  const opened = (cur.opened || cur.new || []).filter(inScope)
    .sort((a, b) => ins.has(normWo(b[0])) - ins.has(normWo(a[0])));
  lines.push(`▶️ เปิดงานจริง (Actual Start วันนี้) ${t.opened} WO${t.inserted ? ` (⚡แทรก ${t.inserted})` : ''}`);
  for (const x of opened.slice(0, LIST_MAX)) lines.push(woLine(ins.has(normWo(x[0])) ? '⚡' : '•', x));
  lines.push(...more(opened));
  if (!opened.length) lines.push('• วันนี้ยังไม่มีงานที่ Actual Start เป็นวันนี้');
  lines.push(`✅ CLOSED ${t.closed} WO${t.assumed ? ` (Status ${t.closedStatus} + ไม่พบในไฟล์ ${t.assumed})` : ''} · เสร็จรอปิดวันนี้ ${t.finished} WO`);
  lines.push('');

  // 3) Per plant
  for (const id of ids) {
    const n = plantNumbers(cur, prev, [id]);
    lines.push(`🏭 PP${id}: เปิดงาน ${n.opened} · ⚡แทรก ${n.inserted} · เสร็จ/ปิด ${n.done} · คงค้าง ${n.open}${n.delta != null ? ` (${sign(n.delta)})` : ''}`);
  }
  lines.push('');

  // 4) What still needs pushing (rules on the stored summaries) and what the team should do about it
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

    // Action plan: each line = number to clear + who + what to do.
    const acts = [];
    if (now.over365) {
      const who = now.appr365[0];
      acts.push(`เคลียร์งานค้างเกิน 1 ปี ${now.over365} WO ก่อน — เจ้าของงานทบทวนว่าจะดำเนินการต่อหรือยกเลิก${who ? ` (${who[1]} WO รอคุณ ${firstName(who[0])} พิจารณา/อนุมัติ)` : ''}`);
    }
    if (topTeam?.[1]) acts.push(`ทีม ${topTeam[0]} ทบทวนงานค้างเกิน 180 วัน ${topTeam[1]} WO — อัปเดตแผน วันเข้างาน หรือปิดงานที่ไม่จำเป็น`);
    if (entered?.length) {
      const waitPlan = entered.filter((x) => GROUP_OF(rowOf(x[0])) === 'plan').length;
      acts.push(`งานเข้าใหม่ ${entered.length} WO${waitPlan ? ` (รอวางแผน/อนุมัติ ${waitPlan})` : ''} — วางแผนและมอบหมายผู้รับผิดชอบให้ชัดภายในสัปดาห์นี้`);
    }
    if (t.finish) acts.push(`งานเสร็จรอปิดสะสม ${t.finish} WO (FINISH/WACCEPT/COMP) — ตรวจรับและปิดงาน (CLOSE) ในระบบให้ครบ`);
    const parts = now.groups.material?.[0];
    if (parts) acts.push(`รออะไหล่ ${parts} WO — ติดตามการจัดหาอะไหล่และแจ้งวันที่คาดว่าจะได้รับ`);
    if (acts.length) lines.push('🎯 แนวทางดำเนินงาน', ...acts.map((x, i) => `${i + 1}. ${x}`), '', 'รบกวนเจ้าของงานช่วยเร่งเคลียร์ค่ะ 🙏', '');
  }
  lines.push(`📌 ข้อมูลจาก CMMS${last?.fileName ? ` (${last.fileName})` : ''}`);
  if (url) lines.push(`🔗 Data link : ${url}`);
  return lines.join('\n');
}
