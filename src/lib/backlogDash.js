// Weekly-style summary of the open WO Backlog P1 (same data as the CMMS upload): KPIs, status groups, teams,
// aging buckets, plants, team × status matrix, next approvers and the oldest WOs. Pure — used by BacklogDashboard.
import { PLANT_IDS } from './data.js';
import { STATUS_GROUPS, TEAMS, ageDays, effGroup, isClosedGroup, isTrackedRow, latestSeen, teamOf } from './cmms.js';

export const AGE_BANDS = [
  { k: 'a30', label: '0-30 วัน', from: 0, to: 30 },
  { k: 'a90', label: '31-90 วัน', from: 31, to: 90 },
  { k: 'a180', label: '91-180 วัน', from: 91, to: 180 },
  { k: 'a365', label: '181-365 วัน', from: 181, to: 365 },
  { k: 'aMore', label: 'มากกว่า 365 วัน', from: 366, to: Infinity },
];

const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
const pct = (n, of) => (of ? (n / of) * 100 : 0);

/**
 * @param rows   backlog rows (backlog/current)
 * @param ids    plants in scope
 * @param today  Date (Thai day)
 * Open = not finished/closed and present in the latest file (missing = closed, as everywhere else).
 */
export function backlogDashboard(rows, ids, today) {
  const latest = latestSeen(rows);
  const open = (rows || []).filter(isTrackedRow)
    .map((r) => ({ ...r, g: effGroup(r, latest), age: ageDays(r, today) ?? 0, tm: r.team || teamOf(r.workLoc) }))
    .filter((r) => ids.includes(Number(r.plant)) && !isClosedGroup(r.g));
  const total = open.length;
  const ages = open.map((r) => r.age);
  const valued = open.filter((r) => Number(r.value) > 0);
  const summary = (list) => ({ count: list.length, pct: pct(list.length, total), avgAge: avg(list.map((r) => r.age)), avgExact: list.length ? list.reduce((s, r) => s + r.age, 0) / list.length : 0 });

  const groups = STATUS_GROUPS.filter((g) => !isClosedGroup(g.key))
    .map((g) => ({ ...g, ...summary(open.filter((r) => r.g === g.key)) }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count);
  const teams = TEAMS.map((t) => {
    const list = open.filter((r) => r.tm === t.k);
    return { ...t, ...summary(list), over180: list.filter((r) => r.age > 180).length };
  }).filter((t) => t.k !== 'OTHER');
  const bands = AGE_BANDS.map((b) => ({ ...b, ...summary(open.filter((r) => r.age >= b.from && r.age <= b.to)) }));
  const plants = PLANT_IDS.filter((p) => ids.includes(p)).map((p) => ({ plant: p, ...summary(open.filter((r) => Number(r.plant) === p)) }));
  const matrix = teams.map((t) => ({ team: t, cells: groups.map((g) => open.filter((r) => r.tm === t.k && r.g === g.key).length) }));
  const plantMatrix = plants.map((p) => ({ plant: p.plant, cells: groups.map((g) => open.filter((r) => Number(r.plant) === p.plant && r.g === g.key).length) }));

  const byApprover = new Map();
  for (const r of open) {
    const name = String(r.nextApprove || '').trim() || '(ไม่ระบุ)';
    (byApprover.get(name) || byApprover.set(name, []).get(name)).push(r);
  }
  const approversAll = [...byApprover.entries()]
    .map(([name, list]) => ({ name, ...summary(list), over365: list.filter((r) => r.age > 365).length, over180: list.filter((r) => r.age > 180).length }))
    .sort((a, b) => b.count - a.count || b.avgAge - a.avgAge);
  const approvers = approversAll.slice(0, 10);

  return {
    total,
    kpi: {
      avgAge: avg(ages),
      maxAge: ages.length ? Math.max(...ages) : 0,
      over365: open.filter((r) => r.age > 365).length,
      pct180: pct(open.filter((r) => r.age > 180).length, total),
      over180: open.filter((r) => r.age > 180).length,
      inProgress: open.filter((r) => r.g === 'inprg').length,
      value: valued.reduce((s, r) => s + Number(r.value), 0),
      valueCount: valued.length,
    },
    groups, teams, bands, plants, matrix, plantMatrix, approvers, approversAll,
    over365Wos: open.filter((r) => r.age > 365).sort((a, b) => b.age - a.age).map((r) => String(r.wo)),
    oldest: [...open].sort((a, b) => b.age - a.age).slice(0, 10),
  };
}
