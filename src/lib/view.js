import { BLOCK, DONE, DOING, FILTERS, GROUPS, PLANT_IDS, PLANT_META, STATUS, STUCK, bucket, counts } from './data.js';
import { daysBetween, iso, pd, range, thD } from './dates.js';
import { groupOf, isClosedGroup, normWo, summarize } from './cmms.js';

const pctOf = (n, total) => Math.round((n / (total || 1)) * 100);

export const filterFor = (k) => FILTERS.find((x) => x.k === k) || FILTERS[0];

function jobRow(j, i, pid, t, cmmsIdx) {
  const b = bucket(j, t);
  const days = daysBetween(t, pd(j.end));
  const bl = BLOCK[j.blocker] || BLOCK.none;
  const overdue = j.status !== 'done' && days < 0;
  const st = STATUS[j.status] || STATUS.pending;
  const status = overdue ? { label: 'เกินกำหนด', bg: STUCK, fg: 'white' } : st;
  const timeText = j.status === 'done' ? 'ปิดงานแล้ว' : days < 0 ? `เกิน ${-days} วัน` : days === 0 ? 'ครบกำหนดวันนี้' : `เหลือ ${days} วัน`;
  const timeColor = j.status === 'done' ? 'oklch(0.5 0.15 150)' : days <= 0 ? 'oklch(0.55 0.21 25)' : days <= 2 ? 'oklch(0.55 0.13 70)' : 'oklch(0.45 0.04 258)';
  // Latest CMMS status for this WO, when the backlog snapshot has it.
  const w = j.wo && cmmsIdx?.get(normWo(j.wo));
  const cmms = w ? { status: w.status, closed: isClosedGroup(groupOf(w.status).key) } : null;
  return {
    cmms,
    job: j,
    rank: i + 1,
    rankBg: overdue ? STUCK : PLANT_META[pid].color,
    range: range(j.start, j.end),
    timeText,
    timeColor,
    status,
    bar: b === 'done' ? DONE : b === 'stuck' ? STUCK : DOING,
    blocker: { ...bl, key: BLOCK[j.blocker] ? j.blocker : 'none' },
    note: j.blocker === 'none' && !j.note ? (j.status === 'done' ? '' : 'ดำเนินการได้ตามแผน') : j.note,
    photos: (j.photos || []).map((ph) => ({
      src: ph.src,
      date: thD(pd(ph.date)),
      caption: `โรงไฟฟ้า ${pid}${j.wo ? ` · ${j.wo}` : ''} · ${j.issue} · ${thD(pd(ph.date))}`,
    })),
  };
}

export function plantView(data, pid, t, backlog = null) {
  const cmmsIdx = backlog ? new Map(backlog.rows.map((r) => [normWo(r.wo), r])) : null;
  const woRows = backlog ? backlog.rows.filter((r) => r.plant === pid) : null;
  const all = data.jobs.filter((j) => j.plant === pid);
  const c = counts(all, t);
  // Shown: up to 5 unfinished jobs by rank. Collapsed behind a toggle: finished jobs and any extra open ones.
  const byRank = (a, b) => a.rank - b.rank;
  const open = all.filter((j) => j.status !== 'done').sort(byRank);
  const top = open.slice(0, 5);
  const rest = open.slice(5).concat(all.filter((j) => j.status === 'done').sort(byRank));
  return {
    id: pid,
    name: `โรงไฟฟ้า ${pid}`,
    ...PLANT_META[pid],
    total: all.length,
    ...c,
    pct: pctOf(c.done, all.length),
    impact: data.plants[pid]?.impact || [],
    top: top.map((j, i) => jobRow(j, i, pid, t, cmmsIdx)),
    rest: rest.map((j, i) => jobRow(j, i + top.length, pid, t, cmmsIdx)),
    wo: woRows ? summarize(woRows) : null,
    more: rest.length,
    moreDone: rest.filter((j) => j.status === 'done').length,
  };
}

export function dashboardView(data, filterKey, t, backlog = null) {
  const f = filterFor(filterKey);
  const ids = f.ids;
  const jobs = data.jobs.filter((j) => ids.includes(j.plant));
  const c = counts(jobs, t);
  const pc = (n) => pctOf(n, jobs.length);

  const groups = GROUPS.map((g) => ({ ...g, ids: g.ids.filter((i) => ids.includes(i)) }))
    .filter((g) => g.ids.length)
    .map((g) => {
      const plants = g.ids.map((id) => plantView(data, id, t, backlog));
      const tt = plants.reduce((s, p) => s + p.total, 0);
      const dn = plants.reduce((s, p) => s + p.done, 0);
      return {
        k: g.k,
        title: g.ids.length === 1 ? `มุมมองรายโรง · โรงไฟฟ้า ${g.ids[0]}` : g.title,
        note: `สำเร็จรวม ${pctOf(dn, tt)}% · เสร็จ ${dn}/${tt} งาน`,
        plants,
      };
    });

  const open = jobs.filter((j) => j.status !== 'done');
  const bc = {};
  open.forEach((j) => { if (j.blocker && j.blocker !== 'none' && BLOCK[j.blocker]) bc[j.blocker] = (bc[j.blocker] || 0) + 1; });
  const blockers = Object.entries(bc)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, count: n, ...BLOCK[k] }));

  const risk = ids
    .map((id) => ({ id, n: counts(data.jobs.filter((j) => j.plant === id), t).stuck }))
    .sort((a, b) => b.n - a.n);
  const overdue = open.filter((j) => pd(j.end) < t).sort((a, b) => pd(a.end) - pd(b.end));
  const highlights = [
    { k: `P1 ทั้งหมด ${jobs.length} งาน`, v: `· เสร็จ ${c.done} (${pc(c.done)}%) · กำลังทำ ${c.doing} (${pc(c.doing)}%) · ค้าง ${c.stuck} (${pc(c.stuck)}%)` },
    { k: 'โรงที่เสี่ยงสุด:', v: risk.filter((r) => r.n > 0).slice(0, 2).map((r) => `โรง ${r.id} (ค้าง ${r.n} งาน)`).join(' และ ') || 'ไม่มีงานค้าง' },
    { k: 'ติดปัญหาหลัก:', v: blockers.slice(0, 3).map((b) => `${b.label} ${b.count} งาน`).join(' · ') || 'ไม่มี' },
    {
      k: 'เกินกำหนด:',
      v: overdue.length
        ? `${overdue.length} งาน · นานสุด โรง ${overdue[0].plant} ${overdue[0].issue} (เกิน ${daysBetween(pd(overdue[0].end), t)} วัน)`
        : 'ไม่มีงานเกินกำหนด',
    },
  ];

  // Trend: older snapshots only carry per-plant counts (`p`) from the first save onwards,
  // so filtered views skip seed points that predate that.
  const allPlants = ids.length === PLANT_IDS.length;
  const pick = (x) => {
    if (allPlants) return x;
    if (!x.p) return null;
    return ids.reduce((s, i) => {
      const q = x.p[i] || {};
      return { date: x.date, done: s.done + (q.done || 0), doing: s.doing + (q.doing || 0), stuck: s.stuck + (q.stuck || 0) };
    }, { date: x.date, done: 0, doing: 0, stuck: 0 });
  };
  const todayIso = iso(t);
  const history = (data.history || [])
    .filter((x) => x.date !== todayIso)
    .map(pick)
    .filter(Boolean)
    .concat([{ date: todayIso, ...c }])
    .slice(-8);

  return {
    filter: f,
    ids,
    color: ids.length === 1 ? PLANT_META[ids[0]].color : 'oklch(0.27 0.07 258)',
    kpi: { total: jobs.length, plants: ids.length, ...c, donePct: pc(c.done), doingPct: pc(c.doing), stuckPct: pc(c.stuck) },
    highlights,
    groups,
    blockers,
    history,
  };
}
