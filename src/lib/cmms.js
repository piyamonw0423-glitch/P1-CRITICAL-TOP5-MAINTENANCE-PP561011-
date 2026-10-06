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
  { key: 'closed', label: 'ปิดแล้ว', codes: ['CLOSED', 'CLOSE'], color: 'oklch(0.5 0.08 150)' },
  { key: 'other', label: 'อื่นๆ', codes: [], color: 'oklch(0.7 0.02 258)' },
];
const GROUP_BY_CODE = Object.fromEntries(STATUS_GROUPS.flatMap((g) => g.codes.map((c) => [c, g])));
export const groupOf = (status) => GROUP_BY_CODE[String(status || '').trim().toUpperCase()] || STATUS_GROUPS.at(-1);
/** Headline KPI bucket for a status group: done (finished/closed), doing (in progress/rework), stuck (everything waiting). */
export const kpiBucket = (key) => (isClosedGroup(key) ? 'done' : key === 'inprg' || key === 'rework' ? 'doing' : 'stuck');

/** Finished or closed in the CMMS: no longer backlog. */
export const isClosedGroup = (key) => key === 'finish' || key === 'closed';

export const normWo = (w) => String(w || '').replace(/\s+/g, '').toUpperCase();

// The CMMS export holds Thai wall-clock times (Actual Start peaks at 08:00 and 13:00). read-excel-file returns
// such a cell as a Date whose UTC fields are that wall clock, so the calendar day is read from the UTC fields as-is
// (adding +7 h here would push everything after 17:00 into the next day). Text dates are parsed in local time.
const thaiDay = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : iso(d);
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
  { k: 'MECH', label: 'MECH', codes: ['WL5112', 'WL5121'] },
  { k: 'ELEC', label: 'ELEC', codes: ['WL5115'] },
  { k: 'AUTO', label: 'AUTO', codes: ['WL5118'] },
  { k: 'EMER', label: 'EMER', codes: ['WL5122', 'WL5123'] },
  { k: 'OTHER', label: 'ไม่ระบุ', codes: [] },
];
const TEAM_KEYS = new Set(TEAMS.map((t) => t.k));
export const normWl = (s) => String(s || '').trim().toUpperCase();
/** Report scope filter: '' or [] = everything, a team key (MECH…) = that team, a WO_Worklocation code, or an array of those. */
export const scopeMatch = (f, team, wl) => {
  if (Array.isArray(f)) return !f.length || f.some((x) => scopeMatch(x, team, wl)); // several WL codes / teams
  return !f || (TEAM_KEYS.has(f) ? team === f : normWl(wl) === f);
};
/**
 * Only the team's own work locations are tracked (team rule, 5 Oct 2026): WOs of any other WO_Worklocation
 * (WL1220, WL1310, WL5111, …) or with none are dropped on upload and ignored in every count.
 */
export const TRACKED_WL = new Set(TEAMS.flatMap((t) => t.codes));
export const isTrackedRow = (r) => {
  const code = normWl(r?.workLoc ?? r?.wl);
  return code ? TRACKED_WL.has(code) : !!r?.team && r.team !== 'OTHER' && TEAM_KEYS.has(r.team);
};
/** WO_Worklocation codes for the filter: the tracked team codes only. */
export const wlOptions = () => [...TRACKED_WL].map((c) => ({ code: c, team: teamOf(c) }));
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
    const skippedWl = {};
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
      if (!isTrackedRow(row)) { const k = normWl(row.workLoc) || '(ไม่มี WL)'; skippedWl[k] = (skippedWl[k] || 0) + 1; continue; }
      for (const f of DATE_FIELDS) row[f] = thaiDay(get(f));
      row.value = Number(get('value')) || 0;
      rows.push(row);
    }
    return { rows, duplicates: dupes, skipped: Object.entries(skipped).map(([plant, count]) => ({ plant, count })), skippedWl: Object.entries(skippedWl).map(([wl, count]) => ({ wl, count })), unknownStatuses: [...unknown] };
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

/** Time of the most recent upload (rows with an older seenAt were not in that file). */
export const latestSeen = (rows) => (rows || []).reduce((m, r) => (r.seenAt && r.seenAt > m ? r.seenAt : m), '');
/** Was this row in the latest uploaded file? Rows without seenAt (older data) count as present. */
export const presentIn = (r, latest) => !latest || !r.seenAt || r.seenAt >= latest;
/**
 * Team rule (2 ต.ค. 2569): the CMMS export drops a WO once it is closed, so a WO missing from the latest
 * file IS closed. Set to false to make missing WOs keep their last status instead (they are listed either way).
 */
export const MISSING_IS_CLOSED = true;
/** Status group used for counting: CMMS Status (column L), or 'closed' for a WO missing from the latest file. */
export const effGroup = (r, latest) => (MISSING_IS_CLOSED && !presentIn(r, latest) ? 'closed' : groupOf(r.status).key);

/** Counts per status group for a set of rows: { total, open, byGroup: {key: n} }. */
export function summarize(rows, latest = latestSeen(rows)) {
  const byGroup = {};
  let open = 0;
  rows.forEach((r) => {
    const k = effGroup(r, latest);
    byGroup[k] = (byGroup[k] || 0) + 1;
    if (!isClosedGroup(k)) open++;
  });
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
 * Returns { rows, added, changed: [{ wo, plant, desc, from, to }], unchanged, missing, missingRows, removed }.
 */
export function mergeBacklog(current, incoming, today, removeMissing = false, now = new Date()) {
  const day = iso(today);
  const seenAt = now.toISOString(); // exact upload time, so two uploads on one day stay distinguishable
  const old = new Map((current?.rows || []).filter(isTrackedRow).map((r) => [normWo(r.wo), r]));
  const seen = new Set();
  const rows = [];
  const changed = [];
  incoming = incoming.filter(isTrackedRow);
  let added = 0, unchanged = 0;
  const addedRows = [];
  for (const r of incoming) {
    const key = normWo(r.wo);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = old.get(key);
    if (!prev) {
      added++;
      addedRows.push(r);
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
  return { rows, added, addedRows, changed, unchanged, missing: leftOut.length, missingRows: leftOut, removed: removeMissing ? leftOut.length : 0 };
}

/** Did the latest upload change this row's status? */
export const changedIn = (r, latest) => !!(latest && r.changedAt === latest);

/* ---------------- daily performance (recorded on every upload) ---------------- */

const WORKING = new Set(['inprg', 'rework']);
const DOING_OR_DONE = new Set(['inprg', 'rework', 'finish', 'closed']);
const rowTeam = (r) => (r.workLoc ? teamOf(r.workLoc) : r.team || 'OTHER');
const tuple = (r) => [r.wo, r.plant, rowTeam(r), normWl(r.workLoc)];

/**
 * What happened between two backlog snapshots on `day` (YYYY-MM-DD), as [wo, plant, team, workLoc] lists:
 * new WOs, started (moved from waiting into APPR/INPRG/REWORK, or Actual Start = day),
 * finished (moved into FINISH/WACCEPT/COMP, or Actual Finish = day) and closed (moved into CLOSED).
 * A WO that was in the previous file (not yet closed) but is missing from this one is listed in `assumed`
 * ("not found in file") and, with MISSING_IS_CLOSED, also counted in `closed`.
 * With no previous snapshot only the date columns count, so the first upload does not report every WO as new.
 */
export function dayEvents(prevRows, nextRows, day) {
  prevRows = (prevRows || []).filter(isTrackedRow);
  nextRows = nextRows.filter(isTrackedRow);
  const prevLatest = latestSeen(prevRows);
  const nextLatest = latestSeen(nextRows);
  const old = new Map((prevRows || []).map((r) => [normWo(r.wo), r]));
  const hasPrev = old.size > 0;
  const ev = { opened: [], entered: [], new: [], started: [], finished: [], closed: [], assumed: [] };
  const present = nextRows.filter((r) => presentIn(r, nextLatest));
  const presentKeys = new Set(present.map((r) => normWo(r.wo)));
  for (const prev of old.values()) {
    if (!presentIn(prev, prevLatest) || groupOf(prev.status).key === 'closed' || presentKeys.has(normWo(prev.wo))) continue;
    ev.assumed.push(tuple(prev));
    if (MISSING_IS_CLOSED) ev.closed.push(tuple(prev));
  }
  ev.back = []; // missing earlier, present again: drop it from the day's "not found" (and closed) lists
  for (const r of present) {
    const prev = old.get(normWo(r.wo));
    if (prev && !presentIn(prev, prevLatest) && groupOf(r.status).key !== 'closed') ev.back.push(normWo(r.wo));
    const g = groupOf(r.status).key;
    const pg = prev ? groupOf(prev.status).key : null;
    // Entered the backlog = open now, and not open in the previous file (new WO number, or back from finished).
    if (hasPrev && !isClosedGroup(g) && (!prev || isClosedGroup(pg) || !presentIn(prev, prevLatest))) ev.entered.push(tuple(r));
    // Opened on the day = Actual Start is that day (team rule, same as the history report); 5th field = new in the file.
    if (r.actualStart === day) ev.opened.push([...tuple(r), !prev && hasPrev ? 1 : 0]);
    // New in the file; the 5th field marks "inserted during the day" = its Actual Start is the upload day itself.
    if (!prev && hasPrev) ev.new.push([...tuple(r), r.actualStart === day ? 1 : 0]);
    const moved = prev && prev.status !== r.status;
    if ((moved && !DOING_OR_DONE.has(pg) && WORKING.has(g)) || (r.actualStart === day && prev?.actualStart !== day)) ev.started.push(tuple(r));
    if ((moved && g === 'finish' && !isClosedGroup(pg)) || (r.actualFinish === day && prev?.actualFinish !== day && !isClosedGroup(pg))) ev.finished.push(tuple(r));
    if (moved && g === 'closed') ev.closed.push(tuple(r));
  }
  return ev;
}

const AGE_BUCKETS = [['a7', 7], ['a30', 30], ['a90', 90], ['aMore', Infinity]];

/** Open (not finished/closed) WOs per "plant|team|workLoc" with age buckets, plus finished-waiting-to-close counts. */
export function openSnapshot(rows, today) {
  const by = {};
  const latest = latestSeen(rows);
  for (const r of rows) {
    if (!isTrackedRow(r)) continue;
    const g = effGroup(r, latest);
    if (g === 'closed') continue;
    const k = `${r.plant}|${rowTeam(r)}|${normWl(r.workLoc)}`;
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
const EVENT_KEYS = ['opened', 'entered', 'new', 'started', 'finished', 'closed', 'assumed'];
const noEvents = () => Object.fromEntries(EVENT_KEYS.map((k) => [k, []]));

export function foldDayStats(prev, { day, events, snapshot, at, fileName, baseline = false, dash = null }) {
  const out = { date: day, rounds: [...(prev?.rounds || []), { at, fileName: String(fileName || '').slice(0, 120), ...(baseline ? { baseline: true } : {}) }].slice(-12) };
  if (baseline || prev?.baseline) out.baseline = true;
  const back = new Set(events.back || []);
  // Every event carries [wo, plant, team, upload time, flag, workLoc] (workLoc added Oct 2026; older docs lack it). For new WOs the flag means "inserted during the day"
  // (team rule: a new WO whose Actual Start is the upload day); for other events it marks a later upload of the day.
  const midday = (prev?.rounds || []).length > 0 ? 1 : 0;
  const tagged = Object.fromEntries(EVENT_KEYS.map((k) => [k, (events[k] || []).map((t) => [t[0], t[1], t[2], at, k === 'new' || k === 'opened' ? (t[4] === 1 ? 1 : 0) : midday, t[3] || ''])]));
  for (const k of EVENT_KEYS) {
    const seen = new Set((prev?.[k] || []).map((t) => normWo(t[0])));
    out[k] = [...(prev?.[k] || []), ...(tagged[k] || []).filter((t) => !seen.has(normWo(t[0])))]
      .filter((t) => !((k === 'assumed' || k === 'closed') && back.has(normWo(t[0]))) || (events[k] || []).some((e) => normWo(e[0]) === normWo(t[0])))
      .slice(0, 2000);
  }
  const fresh = new Set((out.new || []).map((t) => normWo(t[0])));
  out.opened = (out.opened || []).map((t) => (fresh.has(normWo(t[0])) && t[4] !== 1 ? [t[0], t[1], t[2], t[3], 1, t[5]] : t));
  out.open = snapshot;
  if (dash || prev?.dash) out.dash = dash || prev.dash; // compact backlog summary of the day's latest upload (analysis.js)
  const first = prev ? prev.dashFirst || prev.dash : dash; // ... and of its first (morning) upload, for the evening report
  if (first) out.dashFirst = first;
  return out;
}

/**
 * WOs "inserted during the day" in a stats doc: new in the file that day AND Actual Start that day.
 * Taken from the day's lists, not from one upload, so a WO first seen in the morning file keeps its ⚡ when the
 * afternoon upload records it as opened. Older docs (no `opened` list) use the new-WO flag.
 */
export function insertedWos(doc) {
  const out = new Set();
  if (!doc) return out;
  const fresh = new Set((doc.new || []).map((t) => normWo(t[0])));
  if (doc.opened) for (const t of doc.opened) { if (fresh.has(normWo(t[0])) || t[4] === 1) out.add(normWo(t[0])); }
  else for (const t of doc.new || []) if (t[4] === 1) out.add(normWo(t[0]));
  return out;
}

/**
 * "Entered the backlog" on `day`, read from the backlog rows themselves: open in the latest file and first seen
 * that day, or moved that day from finished/closed back to open. Independent of how many uploads the day had
 * (the per-upload `entered` event only compares with the previous upload). Tuples like the stats events.
 */
export function enteredFromBacklog(rows, day) {
  const latest = latestSeen(rows);
  return (rows || []).filter((r) => isTrackedRow(r) && presentIn(r, latest) && !isClosedGroup(groupOf(r.status).key)
    && (r.firstSeen === day || (r.statusSince === day && r.prevStatus && isClosedGroup(groupOf(r.prevStatus).key))))
    .map((r) => [r.wo, r.plant, rowTeam(r), '', 0, normWl(r.workLoc)]);
}

/**
 * The report day's stats doc with `entered` taken from the backlog when it is the latest day (see above).
 * A baseline day has nothing "entered" (every row was first seen then).
 */
export function withEntered(doc, backlog, isLatest) {
  if (!doc || !isLatest || !backlog?.rows?.length) return doc;
  if (doc.baseline && (doc.rounds || []).length <= 1) return { ...doc, entered: [] };
  return { ...doc, entered: enteredFromBacklog(backlog.rows, doc.date) };
}

/** Per upload round of a stats document: [{ at, fileName, new, inserted, started, finished, closed, missing }]. */
export function roundTotals(doc, ids, team = null, wlOf = null) {
  const keep = (plant, t, wo, wl) => ids.includes(Number(plant)) && t !== 'OTHER' && scopeMatch(team, t, wl || wlOf?.(wo));
  const ins = insertedWos(doc);
  return (doc?.rounds || []).map((r, i) => {
    const mine = (k) => (doc[k] || []).filter((t) => keep(t[1], t[2], t[0], t[5]) && (t[3] ? t[3] === r.at : i === 0));
    return {
      at: r.at, fileName: r.fileName, baseline: !!r.baseline,
      opened: doc.opened ? mine('opened').length : mine('new').length,
      entered: doc.entered ? mine('entered').length : null,
      new: mine('new').length, inserted: (doc.opened ? mine('opened') : mine('new')).filter((t) => ins.has(normWo(t[0]))).length,
      started: mine('started').length, finished: mine('finished').length, closed: mine('closed').length, missing: mine('assumed').length,
    };
  });
}

/**
 * Sum a stats document for some plants and (optionally) one team or WO_Worklocation code (see scopeMatch).
 * wlOf(wo) fills in the code for events recorded before tuples carried it.
 */
export function statTotals(doc, ids, team = null, wlOf = null) {
  const keep = (plant, t, wo, wl) => ids.includes(Number(plant)) && t !== 'OTHER' && scopeMatch(team, t, wl || (wo != null ? wlOf?.(wo) : ''));
  const t = { opened: 0, entered: 0, new: 0, inserted: 0, started: 0, finished: 0, closed: 0, assumed: 0, closedStatus: 0, open: 0, finish: 0, a7: 0, a30: 0, a90: 0, aMore: 0 };
  if (!doc) return t;
  for (const k of EVENT_KEYS) t[k] = (doc[k] || []).filter(([wo, p, tm, , , wl]) => keep(p, tm, wo, wl)).length;
  const ins = insertedWos(doc);
  t.inserted = (doc.opened || doc.new || []).filter(([wo, p, tm, , , wl]) => keep(p, tm, wo, wl) && ins.has(normWo(wo))).length;
  t.closedStatus = MISSING_IS_CLOSED ? t.closed - t.assumed : t.closed; // Status (column L) → CLOSED
  if (!doc.opened) t.opened = t.new; // stats saved before "opened" existed (Oct 2026) only know new WOs
  if (!doc.entered) t.entered = null; // saved before "entered the backlog" was recorded (6 Oct 2026)
  for (const [key, o] of Object.entries(doc.open || {})) {
    const [p, tm, wl = ''] = key.split('|');
    if (!keep(p, tm, null, wl)) continue;
    for (const f of ['open', 'finish', 'a7', 'a30', 'a90', 'aMore']) t[f] += o[f] || 0;
  }
  return t;
}

/**
 * Starting point for the performance report: the open snapshot of `rows` on `day`, with no events.
 * Used when a file is uploaded as the baseline (all older stats are discarded).
 */
export const baselineStats = (rows, day, at, fileName, dash = null) => {
  const [y, m, d] = day.split('-').map(Number);
  return foldDayStats(null, { day, events: noEvents(), snapshot: openSnapshot(rows, new Date(y, m - 1, d)), at, fileName, baseline: true, dash });
};

/** "List WO Backlog P1_1.10.26.xlsx" → "2026-10-01" (day.month.year in the file name), else null. */
export const dateFromFileName = (name) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(String(name || ''));
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  const dt = new Date(y, Number(m[2]) - 1, Number(m[1]));
  return dt.getDate() === Number(m[1]) ? iso(dt) : null;
};

/* ---------------- work-order history (yearly base data + daily updates) ---------------- */

/**
 * Latest Actual Start/Finish in rows, never after today (Thai time) — how current a file or the history is.
 * Target dates are ignored: planned work can sit in the future and would block every later daily file.
 */
export const latestDateIn = (rows) => {
  const cap = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  return rows.reduce((m, r) => {
    for (const d of [r.as, r.af, r.actualStart, r.actualFinish]) if (d && d > m && d <= cap) m = d;
    return m;
  }, '');
};

/**
 * As-of date of a daily CMMS file: the date in its file name (e.g. "_2.10.26"), else the latest date inside it.
 * The history is only updated from files at least as recent as the history itself (no going back in time).
 */
export const fileAsOf = (fileName, rows) => dateFromFileName(fileName) || latestDateIn(rows) || null;

/**
 * Compact history rows from a parsed CMMS export of every P1 WO of the year (all statuses, CLOSE included):
 * { wo, plant, team, status, as: Actual Start, af: Actual Finish, ts: Target Start, desc }.
 */
export const histRowsFrom = (rows) => rows.filter(isTrackedRow).map((r) => ({
  wo: r.wo, plant: r.plant, wl: r.workLoc || '', team: r.workLoc ? teamOf(r.workLoc) : r.team || 'OTHER', status: r.status,
  as: r.actualStart || null, af: r.actualFinish || null, ts: r.targetStart || null, desc: String(r.desc || '').slice(0, 90),
}));

const histClosed = (h) => groupOf(h.status).key === 'closed';

/**
 * Bring the history up to date with a daily CMMS file (present rows only): new WOs are added, open WOs take the
 * file's status and dates, and — the export drops closed WOs — an open WO missing from the file is closed on
 * `day` (af = day, est = true). A WO the history already has as closed stays closed (an older file cannot reopen it).
 */
export function applyDailyToHist(hist, dailyRows, day) {
  hist = (hist || []).filter(isTrackedRow);
  dailyRows = dailyRows.filter(isTrackedRow);
  const latest = latestSeen(dailyRows);
  const present = dailyRows.filter((r) => presentIn(r, latest));
  const byWo = new Map(present.map((r) => [normWo(r.wo), r]));
  const out = [];
  const seen = new Set();
  let added = 0, updated = 0, closed = 0;
  for (const h of hist) {
    const key = normWo(h.wo);
    seen.add(key);
    const d = byWo.get(key);
    if (histClosed(h)) { out.push(h); continue; }
    if (d) {
      const next = { ...h, status: d.status, wl: d.workLoc || h.wl, team: d.workLoc ? teamOf(d.workLoc) : d.team || h.team, as: d.actualStart || h.as, af: d.actualFinish || h.af, ts: d.targetStart || h.ts };
      if (next.status !== h.status || next.as !== h.as || next.af !== h.af) updated++;
      out.push(next);
    } else {
      closed++;
      out.push({ ...h, status: 'CLOSE', af: h.af || day, est: true });
    }
  }
  for (const [key, d] of byWo) {
    if (seen.has(key)) continue;
    added++;
    out.push(histRowsFrom([d])[0]);
  }
  return { rows: out, added, updated, closed };
}

/**
 * Performance from the history for plants `ids` (and optionally one team) between `from` and `to` (YYYY-MM-DD):
 * opened = Actual Start in range, closed = closed with Actual Finish in range, backlog at `to` = started on or
 * before `to` and not closed by then; plus "now" counts: in progress, finished waiting to close, waiting for parts
 * (WMATL) and waiting to start (no Actual Start).
 */
/** Team of a history row, re-derived from its work-location code when it has one (mapping changes apply at once). */
export const histTeam = (h) => (h.wl ? teamOf(h.wl) : h.team || 'OTHER');

export function histTotals(rows, ids, from, to, team = null) {
  const mine = rows.filter((h) => ids.includes(Number(h.plant)) && isTrackedRow(h) && scopeMatch(team, histTeam(h), h.wl));
  const t = { opened: 0, closed: 0, backlogEnd: 0, inProgress: 0, waiting: 0, finishWait: 0, material: 0 };
  for (const h of mine) {
    const closed = histClosed(h);
    if (h.as && h.as >= from && h.as <= to) t.opened++;
    if (closed && h.af && h.af >= from && h.af <= to) t.closed++;
    if (h.as && h.as <= to && !(closed && h.af && h.af <= to)) t.backlogEnd++;
    if (!closed) {
      if (groupOf(h.status).key === 'material') t.material++; // WMATL: waiting for spare parts, with or without Actual Start
      else if (!h.as) t.waiting++;
      else if (groupOf(h.status).key === 'finish') t.finishWait++;
      else t.inProgress++;
    }
  }
  return t;
}

/** Opened / closed / backlog per bucket: [{ key, label, from, to, opened, closed, backlogEnd }]. */
export function histSeries(rows, ids, buckets, team = null) {
  return buckets.map((b) => ({ ...b, ...histTotals(rows, ids, b.from, b.to, team) }));
}

