// Analysed daily update for LINE: what changed since the previous report day (open backlog, status groups,
// teams, per plant), what opened / closed today, and what still needs pushing (aging, oldest WOs, approvers).
// Every upload stores a compact summary in the day's stats doc (`dash`) so the next day can be compared with it.
import { BLOCK, PLANT_IDS, TOP_N, bucket, listOf } from './data.js';
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
    avg1: d.total ? Math.round((d.groups.reduce((sum, g) => sum + g.avgExact * g.count, 0) / d.total) * 10) / 10 : 0,
    max: d.kpi.maxAge,
    value: d.kpi.value,
    valued: d.kpi.valueCount,
    over180: d.kpi.over180,
    over365: d.kpi.over365,
    groups: Object.fromEntries(d.groups.map((g) => [g.key, [g.count, g.avgAge]])),
    teams: Object.fromEntries(d.teams.map((t) => [t.k, [t.count, t.over180]])),
    plants: Object.fromEntries(d.plants.map((p) => [p.plant, p.count])),
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
export function analysisText({ cur, prev = null, backlog = null, url = '', today = new Date(), latest = true, jobs = null }) {
  if (!cur) return `ยังไม่มีรายงาน — อัปโหลดไฟล์ CMMS ในโหมดแก้ไขก่อน${url ? `\n🔗 ${url}` : ''}`;
  cur = withEntered(cur, backlog, latest); // "entered" of the latest day comes from the WO list itself
  const ids = PLANT_IDS;
  const now = cur.dash || (backlog ? compactDash(backlog.rows, today) : null);
  // Daily report (team reports once a day, ~16:30): compare with the previous report day's last upload.
  const was = prev?.dash || prev?.dashFirst || null;
  const byWo = new Map((backlog?.rows || []).map((r) => [normWo(r.wo), r]));
  const t = statTotals(cur, ids);
  const p = prev ? statTotals(prev, ids) : null;
  const last = cur.rounds?.at(-1);
  const vsLabel = prev ? `เทียบกับ ${thaiShort(prev.date)}` : 'วันแรกที่บันทึก';
  const lines = [`📊 สรุปประจำวัน : WO Backlog P1 · ${thaiShort(cur.date)} (${vsLabel})`, ''];

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
  const teamOpen = (doc, k) => { const d = doc === prev ? was : doc?.dash; return d ? d.teams[k]?.[0] || 0 : statTotals(doc, ids, k).open; };
  if (prev) {
    const nowDoc = cur.dash ? cur : { ...cur, dash: now };
    const deltas = TEAM_KEYS.map((k) => [k, teamOpen(nowDoc, k) - teamOpen(prev, k)]);
    const changed = deltas.filter(([, d]) => d).sort((a, b) => a[1] - b[1]).map(([k, d]) => `${k} ${sign(d)}`);
    const same = deltas.filter(([, d]) => !d).map(([k]) => k);
    lines.push(`• ${[...changed, ...(same.length ? [`${same.join(', ')} เท่าเดิม`] : [])].join(' | ')}`);
  }
  // Overview like the team's sheet (needs both days' summaries).
  if (now && was && now.max != null && was.max != null) {
    const f1 = (n) => n.toFixed(1);
    const pct = (d) => (d.open ? (d.over180 / d.open) * 100 : 0);
    const money = (n) => Math.round(n).toLocaleString('en-US');
    lines.push('', `📊 ภาพรวม ${thaiShort(prev.date)} → ${thaiShort(cur.date)}`,
      `• อายุค้างเฉลี่ย ${f1(was.avg1)} → ${f1(now.avg1)} วัน (${now.avg1 - was.avg1 >= 0 ? '+' : ''}${f1(now.avg1 - was.avg1)}) · สูงสุด ${was.max} → ${now.max} วัน`,
      `• ค้าง > 365 วัน ${was.over365} → ${now.over365} (${sign(now.over365 - was.over365)}) · > 180 วัน ${was.over180} → ${now.over180} (${sign(now.over180 - was.over180)}) = ${f1(pct(now))}%`,
      `• มูลค่างานประเมิน ${money(was.value)} → ${money(now.value)} บาท (${now.value - was.value >= 0 ? '+' : ''}${money(now.value - was.value)}) · ${was.valued} → ${now.valued} WO`);
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
  lines.push(`▶️ เปิดงานจริงวันนี้ (Actual Start) ${t.opened} WO${t.inserted ? ` (⚡แทรกระหว่างวัน ${t.inserted} = เริ่มหลัง 09:30–17:00)` : ''}`);
  for (const x of opened.slice(0, LIST_MAX)) {
    const tm = rowOf(x[0])?.actualStartTime;
    lines.push(woLine(ins.has(normWo(x[0])) ? '⚡' : '•', x).replace(' – ', `${tm ? ` เริ่ม ${tm}` : ''} – `));
  }
  lines.push(...more(opened));
  if (!opened.length) lines.push('• ไม่มีงานที่ Actual Start เป็นวันนี้');
  lines.push(`✅ CLOSED ${t.closed} WO${t.assumed ? ` (Status ${t.closedStatus} + ไม่พบในไฟล์ ${t.assumed})` : ''} · เสร็จรอปิดวันนี้ ${t.finished} WO`);
  lines.push('');

  // 3) Per plant
  for (const id of ids) {
    const n = plantNumbers(cur, prev, [id]);
    const base = was?.plants?.[id];
    const delta = base != null ? n.open - base : n.delta;
    lines.push(`🏭 PP${id}: เปิดงาน ${n.opened} · ⚡แทรก ${n.inserted} · เสร็จ/ปิด ${n.done} · คงค้าง ${n.open}${delta != null ? ` (${sign(delta)})` : ''}`);
  }
  lines.push('');

  // 3b) Top 5 machine-risk (BD) jobs the team tracks, per plant
  if (jobs) lines.push(...top5Lines(jobs, today), '');

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
      acts.push(`เคลียร์งานค้างเกิน 1 ปี ${now.over365} WO ก่อน — Section ทบทวนว่าจะดำเนินการต่อหรือยกเลิก${who ? ` (${who[1]} WO รอคุณ ${firstName(who[0])} พิจารณา/อนุมัติ)` : ''}`);
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


const thaiHour = (isoTs) => new Date(Date.parse(isoTs) + 7 * 3600e3).getUTCHours();
const hhmm = (isoTs) => { const d = new Date(Date.parse(isoTs) + 7 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

/** Evening = the latest upload is after noon and the day already had an earlier (morning) upload. */
export const isEveningReport = (cur) => (cur?.rounds?.length || 0) >= 2 && thaiHour(cur.rounds.at(-1).at) >= 12;

/**
 * Evening progress vs the day's first (morning) upload: WOs closed since then (with names), finished awaiting
 * close, entered the backlog, opened (Actual Start today), open backlog morning → evening per plant and team.
 */
export function eveningText({ cur, backlog = null, url = '', today = new Date() }) {
  if (!cur) return analysisText({ cur, url });
  const ids = PLANT_IDS;
  const am = cur.rounds[0], pm = cur.rounds.at(-1);
  const byWo = new Map((backlog?.rows || []).map((r) => [normWo(r.wo), r]));
  const since = (k) => (cur[k] || []).filter((x) => x[3] && x[3] !== am.at && ids.includes(Number(x[1])) && x[2] !== 'OTHER');
  const assumedSet = new Set(since('assumed').map((x) => normWo(x[0])));
  const closed = since('closed'), finished = since('finished'), entered = since('entered');
  const ins = insertedWos(cur);
  const opened = (cur.opened || []).filter((x) => ids.includes(Number(x[1])) && x[2] !== 'OTHER')
    .sort((a, b) => ins.has(normWo(b[0])) - ins.has(normWo(a[0])));
  const morning = cur.dashFirst || null;
  const evening = cur.dash || (backlog ? compactDash(backlog.rows, today) : null);
  const LIST_MAX = 15;
  const line = (mark, [wo, plant, team], extra = '') => {
    const r = byWo.get(normWo(wo));
    return `${mark} ${wo} PP${plant} ${team}${extra} – ${String(r?.desc || '').slice(0, 50)}`;
  };
  const more = (list) => (list.length > LIST_MAX ? [`…และอีก ${list.length - LIST_MAX} รายการ (ดูในเว็บ)`] : []);
  const lines = [`🌇 สรุปเย็น : WO Backlog P1 · ${thaiShort(cur.date)} · รอบ ${hhmm(pm.at)} น. (เทียบกับรอบเช้า ${hhmm(am.at)} น.)`, ''];

  const byStatus = closed.length - [...assumedSet].length;
  lines.push(`✅ วันนี้ปิดงานได้ ${closed.length} WO${closed.length ? ` (Status CLOSED ${byStatus} + ไม่พบในไฟล์ ${assumedSet.size})` : ''} · เสร็จรอปิดเพิ่ม ${finished.length} WO`);
  if (morning && evening) {
    const dv = evening.open - morning.open;
    lines.push(`${dv < 0 ? '📉' : dv > 0 ? '📈' : '➖'} งานค้าง เช้า ${morning.open} → เย็น ${evening.open} (${sign(dv)})`);
    const moved = Object.keys({ ...evening.groups, ...morning.groups })
      .map((k) => [k, evening.groups[k]?.[0] || 0, morning.groups[k]?.[0] || 0]).filter(([, a, b]) => a !== b)
      .sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2])).slice(0, 3);
    for (const [k, a, b] of moved) lines.push(`• ${GROUP[k]?.label || k} ${b} → ${a} (${sign(a - b)})`);
    const deltas = TEAM_KEYS.map((k) => [k, (evening.teams[k]?.[0] || 0) - (morning.teams[k]?.[0] || 0)]);
    const changed = deltas.filter(([, d]) => d).sort((a, b) => a[1] - b[1]).map(([k, d]) => `${k} ${sign(d)}`);
    const same = deltas.filter(([, d]) => !d).map(([k]) => k);
    lines.push(`• ${[...changed, ...(same.length ? [`${same.join(', ')} เท่าเดิม`] : [])].join(' | ')}`);
  } else if (evening) lines.push(`📌 งานค้างตอนเย็น ${evening.open} WO`);
  lines.push('');

  if (closed.length) {
    lines.push(`✅ งานที่ปิดระหว่างวัน ${closed.length} WO`);
    for (const x of closed.slice(0, LIST_MAX)) {
      const r = byWo.get(normWo(x[0]));
      const was = assumedSet.has(normWo(x[0])) ? r?.status : r?.prevStatus;
      lines.push(line('✓', x, was ? ` (เดิม ${was})` : ''));
    }
    lines.push(...more(closed), '');
  }
  if (finished.length) {
    lines.push(`🟡 เสร็จรอปิดเพิ่ม ${finished.length} WO (รอตรวจรับ/CLOSE)`);
    for (const x of finished.slice(0, LIST_MAX)) lines.push(line('•', x, byWo.get(normWo(x[0]))?.status ? ` ${byWo.get(normWo(x[0])).status}` : ''));
    lines.push(...more(finished), '');
  }
  if (entered.length) {
    lines.push(`🆕 เข้า Backlog ระหว่างวัน ${entered.length} WO`);
    for (const x of entered.slice(0, LIST_MAX)) lines.push(line('•', x, byWo.get(normWo(x[0]))?.status ? ` ${byWo.get(normWo(x[0])).status}` : ''));
    lines.push(...more(entered), '');
  }
  lines.push(`▶️ เปิดงานจริงวันนี้ (Actual Start) ${opened.length} WO${ins.size ? ` (⚡แทรก ${opened.filter((x) => ins.has(normWo(x[0]))).length})` : ''}`);
  for (const x of opened.slice(0, LIST_MAX)) lines.push(line(ins.has(normWo(x[0])) ? '⚡' : '•', x));
  lines.push(...more(opened));
  if (!opened.length) lines.push('• ไม่มีงานที่ Actual Start เป็นวันนี้');
  lines.push('');

  for (const id of ids) {
    const mine = (list) => list.filter((x) => Number(x[1]) === id).length;
    const openNow = statTotals(cur, [id]).open;
    const openAm = morning?.plants?.[id];
    lines.push(`🏭 PP${id}: ปิด ${mine(closed)} · เสร็จรอปิด ${mine(finished)} · เข้าใหม่ ${mine(entered)} · คงค้าง ${openAm != null ? `${openAm} → ${openNow} (${sign(openNow - openAm)})` : openNow}`);
  }
  lines.push('');
  const left = closed.length + finished.length;
  lines.push(left ? `ขอบคุณทีมงานที่ช่วยปิด/เสร็จงานวันนี้ ${left} WO ค่ะ 🙏 พรุ่งนี้ช่วยเร่งงานค้างเกิน 1 ปีและงานรอวางแผน/อนุมัติต่อนะคะ` : 'วันนี้ยังไม่มีงานปิดเพิ่มจากรอบเช้า รบกวนเจ้าของงานช่วยเร่งเคลียร์ค่ะ 🙏', '');
  lines.push(`📌 ข้อมูลจาก CMMS${pm.fileName ? ` (${pm.fileName})` : ''}`);
  if (url) lines.push(`🔗 Data link : ${url}`);
  return lines.join('\n');
}

/** The LINE message for the latest upload: the daily summary vs the previous report day (once a day, ~16:30). */
export function reportText(args) {
  return analysisText(args);
}


const shortDay = (iso) => { if (!iso) return ''; const d = pd(iso); return `${d.getDate()} ${TH_M[d.getMonth()]}`; };

/**
 * "🛠 Top 5 ความเสี่ยงเครื่องจักร (BD)": per plant, the first TOP_N open jobs of the BD list by rank —
 * WO, problem, progress, due date (⏰ when overdue) and the blocker. Done jobs are left out.
 */
export function top5Lines(jobs, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = ['🛠 Top 5 ความเสี่ยงเครื่องจักร (BD)'];
  let any = false;
  for (const id of PLANT_IDS) {
    const list = (jobs || []).filter((j) => Number(j.plant) === id && listOf(j) === 'risk' && j.status !== 'done')
      .sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, TOP_N);
    if (!list.length) { out.push(`PP${id}: — ไม่มีงานค้างในรายการ`); continue; }
    any = true;
    out.push(`PP${id}:`);
    list.forEach((j, i) => {
      const late = bucket(j, t) === 'stuck' && j.status !== 'pending';
      const blk = j.blocker && j.blocker !== 'none' ? ` · ⛔ ${BLOCK[j.blocker]?.label || j.blocker}` : '';
      out.push(`${i + 1}) ${j.wo ? `${j.wo} ` : ''}${String(j.issue || '').slice(0, 50)} · ${Number(j.progress) || 0}%${j.end ? ` · กำหนด ${shortDay(j.end)}${late ? ' ⏰เกินกำหนด' : ''}` : ''}${blk}`);
    });
  }
  if (!any) return ['🛠 Top 5 ความเสี่ยงเครื่องจักร (BD): ยังไม่มีงานในรายการ'];
  return out;
}
