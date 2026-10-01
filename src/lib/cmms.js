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
/** Headline KPI bucket for a status group: done (finished/closed), doing (in progress/rework), stuck (everything waiting). */
export const kpiBucket = (key) => (isClosedGroup(key) ? 'done' : key === 'inprg' || key === 'rework' ? 'doing' : 'stuck');

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
  workLoc: 'WO_Worklocation', supervisor: 'Supervisor',
};

/** Maintenance teams, from the export's WO_Worklocation code (column Q). Order = display order. */
export const TEAMS = [
  { k: 'MECH', label: 'MECH', codes: ['WL5112'] },
  { k: 'ELEC', label: 'ELEC', codes: ['WL5115'] },
  { k: 'AUTO', label: 'AUTO', codes: ['WL5118'] },
  { k: 'EMER', label: 'EMER', codes: ['WL5122', 'WL5123'] },
  { k: 'OTHER', label: 'ไม่ระบุ', codes: [] },
];
const TEAM_BY_CODE = Object.fromEntries(TEAMS.flatMap((t) => t.codes.map((c) => [c, t.k])));
/** Team key for a work-location code (also accepts a code that already carries the team name). */
export const teamOf = (workLoc) => {
  const code = String(workLoc || '').trim().toUpperCase();
  return TEAM_BY_CODE[code] || TEAMS.find((t) => t.k !== 'OTHER' && code.includes(t.k))?.k || 'OTHER';
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
    let dupes = 0;
    for (const r of sheet.data.slice(at + 1)) {
      const get = (f) => (idx[f] >= 0 ? r[idx[f]] : null);
      const wo = str(get('wo'), 40);
      if (!wo) continue;
      if (seen.has(normWo(wo))) { dupes++; continue; } // same WO twice in the file: count once
      seen.add(normWo(wo));
      const plantCode = str(get('plant'));
      const plant = Number(plantCode.replace(/\D/g, ''));
      if (!PLANT_IDS.includes(plant)) { skipped[plantCode || '(ว่าง)'] = (skipped[plantCode || '(ว่าง)'] || 0) + 1; continue; }
      const status = str(get('status'), 30).toUpperCase();
      if (groupOf(status).key === 'other') unknown.add(status || '(ว่าง)');
      const row = { wo, plant, status };
      for (const f of ['desc', 'location', 'asset', 'parent', 'workType', 'nextApprove', 'owner', 'workLoc', 'supervisor']) row[f] = str(get(f), f === 'desc' ? 300 : 80);
      row.team = teamOf(row.workLoc);
      for (const f of DATE_FIELDS) row[f] = thaiDay(get(f));
      row.value = Number(get('value')) || 0;
      rows.push(row);
    }
    return { rows, duplicates: dupes, skipped: Object.entries(skipped).map(([plant, count]) => ({ plant, count })), unknownStatuses: [...unknown] };
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

/**
 * Merge a new CMMS export into the current snapshot, keyed by WO number (duplicates count once).
 * New WOs are added, changed statuses are updated (remembering the previous status and the day it
 * changed), unchanged WOs keep their history. WOs missing from the new file are kept and flagged
 * (lastSeen stays old) unless `removeMissing`.
 * Returns { rows, added, changed: [{ wo, plant, desc, from, to }], unchanged, missing, removed }.
 */
export function mergeBacklog(current, incoming, today, removeMissing = false, now = new Date()) {
  const day = iso(today);
  const seenAt = now.toISOString(); // exact upload time, so two uploads on one day stay distinguishable
  const old = new Map((current?.rows || []).map((r) => [normWo(r.wo), r]));
  const seen = new Set();
  const rows = [];
  const changed = [];
  let added = 0, unchanged = 0;
  for (const r of incoming) {
    const key = normWo(r.wo);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = old.get(key);
    if (!prev) {
      added++;
      rows.push({ ...r, firstSeen: day, lastSeen: day, seenAt, statusSince: day, prevStatus: '' });
    } else if (prev.status !== r.status) {
      changed.push({ wo: r.wo, plant: r.plant, desc: r.desc, from: prev.status, to: r.status });
      rows.push({ ...r, firstSeen: prev.firstSeen || day, lastSeen: day, seenAt, statusSince: day, changedAt: seenAt, prevStatus: prev.status });
    } else {
      unchanged++;
      rows.push({ ...r, firstSeen: prev.firstSeen || day, lastSeen: day, seenAt, statusSince: prev.statusSince || day, changedAt: prev.changedAt || null, prevStatus: prev.prevStatus || '' });
    }
  }
  const leftOut = [...old.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r);
  if (!removeMissing) rows.push(...leftOut);
  return { rows, added, changed, unchanged, missing: leftOut.length, removed: removeMissing ? leftOut.length : 0 };
}

/** Time of the most recent upload (rows with an older seenAt were not in that file). */
export const latestSeen = (rows) => rows.reduce((m, r) => (r.seenAt && r.seenAt > m ? r.seenAt : m), '');
/** Did the latest upload change this row's status? */
export const changedIn = (r, latest) => !!(latest && r.changedAt === latest);

/* ---------------- daily performance (recorded on every upload) ---------------- */

const WORKING = new Set(['inprg', 'rework']);
const DOING_OR_DONE = new Set(['inprg', 'rework', 'finish', 'closed']);
const rowTeam = (r) => r.team || teamOf(r.workLoc);
const tuple = (r) => [r.wo, r.plant, rowTeam(r)];

/**
 * What happened between two backlog snapshots on `day` (YYYY-MM-DD), as [wo, plant, team] lists:
 * new WOs, started (moved from waiting into APPR/INPRG/REWORK, or Actual Start = day),
 * finished (moved into FINISH/WACCEPT/COMP, or Actual Finish = day) and closed (moved into CLOSED).
 * With no previous snapshot only the date columns count, so the first upload does not report every WO as new.
 */
export function dayEvents(prevRows, nextRows, day) {
  const old = new Map((prevRows || []).map((r) => [normWo(r.wo), r]));
  const hasPrev = old.size > 0;
  const ev = { new: [], started: [], finished: [], closed: [] };
  for (const r of nextRows) {
    const prev = old.get(normWo(r.wo));
    const g = groupOf(r.status).key;
    const pg = prev ? groupOf(prev.status).key : null;
    if (!prev && hasPrev) ev.new.push(tuple(r));
    const moved = prev && prev.status !== r.status;
    if ((moved && !DOING_OR_DONE.has(pg) && WORKING.has(g)) || (r.actualStart === day && prev?.actualStart !== day)) ev.started.push(tuple(r));
    if ((moved && g === 'finish' && !isClosedGroup(pg)) || (r.actualFinish === day && prev?.actualFinish !== day && !isClosedGroup(pg))) ev.finished.push(tuple(r));
    if (moved && g === 'closed') ev.closed.push(tuple(r));
  }
  return ev;
}

const AGE_BUCKETS = [['a7', 7], ['a30', 30], ['a90', 90], ['aMore', Infinity]];

/** Open (not finished/closed) WOs per "plant|team" with age buckets, plus finished-waiting-to-close counts. */
export function openSnapshot(rows, today) {
  const by = {};
  for (const r of rows) {
    const g = groupOf(r.status).key;
    if (g === 'closed') continue;
    const k = `${r.plant}|${rowTeam(r)}`;
    const o = (by[k] ||= { open: 0, finish: 0, a7: 0, a30: 0, a90: 0, aMore: 0 });
    if (g === 'finish') { o.finish++; continue; }
    o.open++;
    const age = ageDays(r, today) ?? 0;
    o[AGE_BUCKETS.find(([, max]) => age <= max)[0]]++;
  }
  return by;
}

/**
 * Fold one upload into that day's stats document. Event lists are unions by WO, so uploading at 09:30
 * and again at 16:00 never counts a WO twice; the open snapshot is the latest of the day.
 */
export function foldDayStats(prev, { day, events, snapshot, at, fileName }) {
  const out = { date: day, rounds: [...(prev?.rounds || []), { at, fileName: String(fileName || '').slice(0, 120) }].slice(-12) };
  for (const k of ['new', 'started', 'finished', 'closed']) {
    const seen = new Set((prev?.[k] || []).map((t) => normWo(t[0])));
    out[k] = [...(prev?.[k] || []), ...events[k].filter((t) => !seen.has(normWo(t[0])))].slice(0, 2000);
  }
  out.open = snapshot;
  return out;
}

/** Sum a stats document for some plants and (optionally) one team. */
export function statTotals(doc, ids, team = null) {
  const keep = (plant, t) => ids.includes(Number(plant)) && (!team || t === team);
  const t = { new: 0, started: 0, finished: 0, closed: 0, open: 0, finish: 0, a7: 0, a30: 0, a90: 0, aMore: 0 };
  if (!doc) return t;
  for (const k of ['new', 'started', 'finished', 'closed']) t[k] = (doc[k] || []).filter(([, p, tm]) => keep(p, tm)).length;
  for (const [key, o] of Object.entries(doc.open || {})) {
    const [p, tm] = key.split('|');
    if (!keep(p, tm)) continue;
    for (const f of ['open', 'finish', 'a7', 'a30', 'a90', 'aMore']) t[f] += o[f] || 0;
  }
  return t;
}

