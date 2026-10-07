// Shared data logic for the Cloudflare Worker (worker/) and the Node server (server/index.js).
// Postgres holds one table of JSON documents keyed by (collection, id): jobs, photos (kept apart
// from jobs), plants, history (one row per day) and meta. `conn` supplies query() and tx(fn).
import { MAX_JOBS_PER_PLANT, PLANT_IDS, SEED, counts } from '../src/lib/data.js';
import { iso, pd } from '../src/lib/dates.js';
import { compactDash } from '../src/lib/analysis.js';
import { TRACKED_WL, baselineStats, dayEvents, foldDayStats, isTrackedRow, latestSeen, openSnapshot, presentIn, teamOf } from '../src/lib/cmms.js';

const ID_RE = /^[\w\-.~:@+]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 400000;
const STATUSES = ['pending', 'doing', 'done'];
const BLOCKERS = ['none', 'part', 'permit', 'manpower', 'shutdown', 'vendor', 'budget'];

// "Today" in Thailand (UTC+7, no DST), as a local-midnight Date like the client's today0(),
// so trend snapshots and overdue checks roll over at Thai midnight on any server clock.
const bangkokToday = () => {
  const d = new Date(Date.now() + 7 * 3600e3);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const newId = (p) => `${p}${crypto.randomUUID()}`;

const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });

// WO Backlog snapshot from the CMMS export (one document, replaced on each upload).
const MAX_BACKLOG = 5000;
const WO_RE = /^[\w\-./]{1,40}$/;
const BACKLOG_TEXT = { desc: 300, location: 80, asset: 80, parent: 40, workType: 20, nextApprove: 80, owner: 80, status: 30, prevStatus: 30, workLoc: 40, supervisor: 80 };
const BACKLOG_DATES = ['targetStart', 'targetFinish', 'schedStart', 'schedFinish', 'actualStart', 'actualFinish', 'firstSeen', 'lastSeen', 'statusSince'];
function cleanBacklog(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw bad('backlog file has no work orders');
  if (rows.length > MAX_BACKLOG) throw bad(`backlog is limited to ${MAX_BACKLOG} work orders`);
  const seen = new Set();
  return rows.filter((r) => isTrackedRow({ workLoc: r?.workLoc, team: r?.team })).filter((r) => { // team's work locations only; one row per WO
    const k = String(r?.wo ?? '').replace(/\s+/g, '').toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((r) => {
    const wo = String(r?.wo ?? '').trim();
    if (!WO_RE.test(wo)) throw bad(`invalid work order "${wo.slice(0, 40)}"`);
    const plant = Number(r.plant);
    if (!PLANT_IDS.includes(plant)) throw bad(`invalid plant for ${wo}`);
    const out = { wo, plant, value: Math.max(0, Number(r.value) || 0) };
    for (const [f, max] of Object.entries(BACKLOG_TEXT)) out[f] = String(r[f] ?? '').slice(0, max);
    for (const f of BACKLOG_DATES) out[f] = DATE_RE.test(r[f]) ? r[f] : null;
    out.actualStartTime = /^\d{2}:\d{2}$/.test(r.actualStartTime) ? r.actualStartTime : null;
    out.team = teamOf(out.workLoc); // derived here, never trusted from the browser
    for (const f of ['seenAt', 'changedAt']) out[f] = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(r[f]) ? r[f] : null;
    return out;
  });
}

// Work-order history (every P1 WO of the year, CLOSE included), one document; updated by each daily upload.
function cleanHist(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw bad('history file has no work orders');
  if (rows.length > 2000) throw bad('send the history in parts of at most 2000 work orders');
  const seen = new Set();
  return rows.filter((r) => isTrackedRow({ wl: r?.wl, team: r?.team })).filter((r) => {
    const k = String(r?.wo ?? '').replace(/\s+/g, '').toUpperCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((r) => {
    const wo = String(r.wo).trim();
    if (!WO_RE.test(wo)) throw bad(`invalid work order "${wo.slice(0, 40)}"`);
    const plant = Number(r.plant);
    if (!PLANT_IDS.includes(plant)) throw bad(`invalid plant for ${wo}`);
    const d = (v) => (DATE_RE.test(v) ? v : null);
    return {
      wo, plant, wl: String(r.wl || '').slice(0, 20), team: r.wl ? teamOf(r.wl) : String(r.team || 'OTHER').slice(0, 12), status: String(r.status || '').toUpperCase().slice(0, 30),
      as: d(r.as), af: d(r.af), ts: d(r.ts), desc: String(r.desc || '').slice(0, 90), ...(r.est ? { est: true } : {}),
    };
  });
}

// Sample jobs removed when the dashboard was limited to 5 jobs per plant; deleted once from
// databases seeded earlier, and only while they still carry the sample WO number and text.
const TRIMMED_SAMPLES = [
  ['WO-P5-006', 'Service Air Compressor รั่ว'], ['WO-P5-007', 'Ash Handling Valve ติดขัด'],
  ['WO-P10-006', 'Conveyor Belt C3 ขาด'], ['WO-P6-006', 'Lube Oil Cooler รั่ว'],
  ['WO-P6-007', 'Fire Protection Pump ไม่ Auto Start'], ['WO-P11-006', 'Condensate Pump A Strainer อุดตัน'],
];
const str = (v, max = 500) => String(v ?? '').slice(0, max);

function cleanJob(id, b) {
  if (!ID_RE.test(id)) throw bad('invalid job id');
  if (!b || typeof b !== 'object') throw bad('invalid body');
  const plant = Number(b.plant);
  if (!PLANT_IDS.includes(plant)) throw bad('invalid plant');
  if (!str(b.issue).trim()) throw bad('issue is required');
  if (!DATE_RE.test(b.start) || !DATE_RE.test(b.end)) throw bad('invalid dates');
  // No `photos` key (e.g. an Excel import) means "leave this job's photos as they are".
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, MAX_PHOTOS) : null;
  for (const ph of photos || []) {
    if (ph.id && !ID_RE.test(ph.id)) throw bad('invalid photo id');
    if (!ph.id && !(typeof ph.src === 'string' && ph.src.startsWith('data:image/') && ph.src.length <= MAX_PHOTO_CHARS)) throw bad('invalid photo');
    if (!DATE_RE.test(ph.date)) throw bad('invalid photo date');
  }
  return {
    job: {
      id, plant,
      wo: str(b.wo, 60), rank: Math.max(1, parseInt(b.rank, 10) || 1), list: b.list === 'daily' ? 'daily' : 'risk',
      issue: str(b.issue), action: str(b.action), owner: str(b.owner, 120), team: str(b.team, 120),
      start: b.start, end: b.end,
      progress: Math.min(100, Math.max(0, Number(b.progress) || 0)),
      status: STATUSES.includes(b.status) ? b.status : 'pending',
      blocker: BLOCKERS.includes(b.blocker) ? b.blocker : 'none',
      note: str(b.note, 1000),
    },
    photos,
  };
}

export const SCHEMA = `CREATE TABLE IF NOT EXISTS docs (
  collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, id))`;

/** Run fn inside BEGIN/COMMIT on one pg client (Client, or a PoolClient). */
export async function inTx(client, fn) {
  await client.query('BEGIN');
  try {
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

export function createDb(conn) {
  const { tx } = conn;
  const put = (c, col, id, data) => c.query(
    `INSERT INTO docs (collection, id, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [col, String(id), data],
  );
  const del = (c, col, id) => c.query('DELETE FROM docs WHERE collection = $1 AND id = $2', [col, String(id)]);
  const all = async (c, col) => (await c.query('SELECT id, data FROM docs WHERE collection = $1', [col])).rows;

  // Today's trend snapshot + last-updated time, recomputed from the stored jobs.
  const stamp = async (c, by) => {
    const jobs = (await all(c, 'jobs')).map((r) => r.data);
    const t = bangkokToday();
    const p = Object.fromEntries(PLANT_IDS.map((id) => [id, counts(jobs.filter((j) => j.plant === id), t)]));
    await put(c, 'history', iso(t), { date: iso(t), ...counts(jobs, t), p });
    await put(c, 'meta', 'app', { updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}) });
  };

  // Reject when a plant would end up with more than MAX_JOBS_PER_PLANT jobs (only `plants` if given).
  const checkLimit = async (c, plants = null) => {
    const r = await c.query("SELECT data->>'plant' AS plant, count(*)::int AS n FROM docs WHERE collection = 'jobs' GROUP BY 1");
    const full = r.rows.find((x) => x.n > MAX_JOBS_PER_PLANT && (!plants || plants.includes(Number(x.plant))));
    if (full) throw bad(`plant_full:${full.plant}`);
  };

  const writeJob = async (c, job, photos) => {
    if (photos === null) { await put(c, 'jobs', job.id, job); return; }
    const existing = await c.query("SELECT id FROM docs WHERE collection = 'photos' AND data->>'jobId' = $1", [job.id]);
    const keep = new Set(photos.filter((ph) => ph.id).map((ph) => ph.id));
    for (const r of existing.rows) if (!keep.has(r.id)) await del(c, 'photos', r.id);
    for (const ph of photos) {
      if (!ph.id) await put(c, 'photos', newId('p'), { jobId: job.id, src: ph.src, date: ph.date });
    }
    await put(c, 'jobs', job.id, job);
  };

  // Keep the yearly history in step with a daily CMMS file (no-op until a history has been imported).
  // Same rules as applyDailyToHist (cmms.js), run inside Postgres so the Worker never parses the ~0.5 MB
  // history (Workers Free allows ~10 ms CPU per request): open WOs take the file's status and dates,
  // new WOs are added, open WOs missing from the file close today (est), closed WOs stay closed.
  // Returns 'none' (no history), 'skipped' (file older than the history) or 'synced'.
  const syncHist = async (c, rows, day, fileDate) => {
    const meta = (await c.query("SELECT data->>'asOf' AS as_of FROM docs WHERE collection = 'wohist' AND id = 'current'")).rows[0];
    if (!meta) return 'none';
    if (fileDate && meta.as_of && fileDate < meta.as_of) return 'skipped';
    const latest = latestSeen(rows);
    const daily = rows.filter((r) => presentIn(r, latest)).map((r) => ({
      wo: r.wo, plant: r.plant, wl: r.workLoc || '', team: r.team || teamOf(r.workLoc), status: r.status,
      as: r.actualStart || null, af: r.actualFinish || null, ts: r.targetStart || null, desc: String(r.desc || '').slice(0, 90),
    }));
    await c.query(`
      WITH d AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(wo text, plant int, wl text, team text, status text, "as" text, af text, ts text, "desc" text)),
      h AS (SELECT e, ord FROM docs, jsonb_array_elements(data->'rows') WITH ORDINALITY AS t(e, ord) WHERE collection = 'wohist' AND id = 'current'),
      upd AS (
        SELECT h.ord, CASE
          WHEN upper(h.e->>'status') LIKE 'CLOSE%' THEN h.e
          WHEN d.wo IS NOT NULL THEN h.e || jsonb_build_object('status', d.status, 'wl', COALESCE(NULLIF(d.wl, ''), h.e->>'wl'), 'team', d.team,
            'as', COALESCE(d."as", h.e->>'as'), 'af', COALESCE(d.af, h.e->>'af'), 'ts', COALESCE(d.ts, h.e->>'ts'))
          ELSE h.e || jsonb_build_object('status', 'CLOSE', 'af', COALESCE(h.e->>'af', $2::text), 'est', true)
        END AS e
        FROM h LEFT JOIN d ON upper(d.wo) = upper(h.e->>'wo')),
      added AS (SELECT 1e9 AS ord, to_jsonb(d) AS e FROM d WHERE NOT EXISTS (SELECT 1 FROM h WHERE upper(h.e->>'wo') = upper(d.wo)))
      UPDATE docs SET updated_at = now(), data = data || jsonb_build_object(
        'rows', (SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) FROM (SELECT ord, e FROM upd UNION ALL SELECT ord, e FROM added) z),
        'syncedAt', $3::text, 'asOf', GREATEST(COALESCE(data->>'asOf', ''), COALESCE($4::text, '')))
      WHERE collection = 'wohist' AND id = 'current'`,
    [JSON.stringify(daily), day, new Date().toISOString(), fileDate || null]);
    return 'synced';
  };

  return {
    async init() {
      await conn.query(SCHEMA);
      // First start only: load the sample dashboard so the site opens populated.
      await tx(async (c) => {
        const seeded = await c.query("SELECT 1 FROM docs WHERE collection = 'meta' AND id = 'seeded'");
        if (seeded.rowCount) return;
        const d = SEED();
        for (const { photos, ...j } of d.jobs) await put(c, 'jobs', j.id, j); // eslint-disable-line no-unused-vars
        for (const [pid, v] of Object.entries(d.plants)) await put(c, 'plants', pid, { impact: v.impact });
        for (const h of d.history) await put(c, 'history', h.date, h);
        await put(c, 'meta', 'seeded', { at: new Date().toISOString() });
        await put(c, 'meta', 'trim5', { at: new Date().toISOString() });
        await stamp(c);
      });
      await tx(async (c) => {
        const done = await c.query("SELECT 1 FROM docs WHERE collection = 'meta' AND id = 'trim5'");
        if (done.rowCount) return;
        for (const [wo, issue] of TRIMMED_SAMPLES) {
          const r = await c.query("SELECT id FROM docs WHERE collection = 'jobs' AND data->>'wo' = $1 AND data->>'issue' = $2", [wo, issue]);
          for (const { id } of r.rows) {
            await c.query("DELETE FROM docs WHERE collection = 'photos' AND data->>'jobId' = $1", [id]);
            await del(c, 'jobs', id);
          }
        }
        await put(c, 'meta', 'trim5', { at: new Date().toISOString() });
        await stamp(c);
      });
      // Once: drop WOs of work locations the team does not track (WL1220, WL1310, WL5111, …) from the stored
      // backlog and history (team rule, 5 Oct 2026). Daily stats keep them but every count ignores team OTHER.
      await tx(async (c) => {
        const done = await c.query("SELECT 1 FROM docs WHERE collection = 'meta' AND id = 'dropOtherWl'");
        if (done.rowCount) return;
        await c.query(`UPDATE docs SET updated_at = now(), data = jsonb_set(data, '{rows}', (
            SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(data->'rows') e
            WHERE upper(trim(COALESCE(e->>'workLoc', e->>'wl', ''))) = ANY($1::text[])))
          WHERE collection IN ('backlog', 'wohist') AND id = 'current' AND jsonb_typeof(data->'rows') = 'array'`, [[...TRACKED_WL]]);
        await put(c, 'meta', 'dropOtherWl', { at: new Date().toISOString() });
        await stamp(c);
      });
    },
    ping: () => conn.query('SELECT 1'),

    // Cheap change check the browser polls; it fetches the full state only when this moves.
    async version() {
      const r = await conn.query("SELECT data FROM docs WHERE collection = 'meta' AND id = 'app'");
      return { updatedAt: r.rows[0]?.data.updatedAt || null };
    },

    /** Top 5 jobs only (no photos) — for the LINE message. */
    async jobs() {
      return (await conn.query("SELECT id, data FROM docs WHERE collection = 'jobs'")).rows.map((r) => ({ ...r.data, id: r.id }));
    },

    async state() {
      // Photos are listed by link only (served by photo()), keeping this response small.
      const rows = (await conn.query(`SELECT collection, id,
          CASE WHEN collection = 'photos' THEN jsonb_build_object('jobId', data->'jobId', 'date', data->'date') ELSE data END AS data
        FROM docs WHERE collection IN ('jobs','photos','plants','history','meta')`)).rows;
      const photos = {};
      rows.filter((r) => r.collection === 'photos').forEach((r) => (photos[r.data.jobId] ||= []).push({ id: r.id, src: `api/photos/${encodeURIComponent(r.id)}`, date: r.data.date }));
      Object.values(photos).forEach((a) => a.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)));
      const meta = rows.find((r) => r.collection === 'meta' && r.id === 'app');
      return {
        jobs: rows.filter((r) => r.collection === 'jobs').map((r) => ({ ...r.data, id: r.id, photos: photos[r.id] || [] })),
        plants: Object.fromEntries(rows.filter((r) => r.collection === 'plants').map((r) => [r.id, r.data])),
        history: rows.filter((r) => r.collection === 'history').map((r) => r.data).sort((a, b) => a.date.localeCompare(b.date)),
        updatedAt: meta?.data.updatedAt || null,
        updatedBy: meta?.data.updatedBy || null,
        backlogAt: (await conn.query("SELECT data->>'uploadedAt' AS at FROM docs WHERE collection = 'backlog' AND id = 'current'")).rows[0]?.at || null,
        wohistAt: (await conn.query("SELECT COALESCE(data->>'syncedAt', data->>'uploadedAt') AS at FROM docs WHERE collection = 'wohist' AND id = 'current'")).rows[0]?.at || null,
      };
    },

    /** One photo as { contentType, bytes }, or null. Photos are stored as data: URLs. */
    async photo(id) {
      if (!ID_RE.test(id)) return null;
      const r = await conn.query("SELECT data->>'src' AS src FROM docs WHERE collection = 'photos' AND id = $1", [id]);
      const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(r.rows[0]?.src || '');
      if (!m) return null;
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { contentType: m[1], bytes };
    },

    saveJob(id, body, by) {
      const { job, photos } = cleanJob(id, body);
      return tx(async (c) => {
        const prev = await c.query("SELECT (data->>'plant')::int AS plant FROM docs WHERE collection = 'jobs' AND id = $1", [job.id]);
        if (job.wo.trim()) { // one Top 5 job per WO number
          const dup = await c.query(
            "SELECT 1 FROM docs WHERE collection = 'jobs' AND id <> $1 AND upper(regexp_replace(data->>'wo', '\\s', '', 'g')) = $2",
            [job.id, job.wo.replace(/\s+/g, '').toUpperCase()],
          );
          if (dup.rowCount) throw bad('duplicate_wo');
        }
        await writeJob(c, job, photos);
        // Only adding a job to a plant (new, or moved from another plant) can exceed the limit.
        if (prev.rows[0]?.plant !== job.plant) await checkLimit(c, [job.plant]);
        await stamp(c, by);
      });
    },

    deleteJob(id, by) {
      if (!ID_RE.test(id)) throw bad('invalid job id');
      return tx(async (c) => {
        await c.query("DELETE FROM docs WHERE collection = 'photos' AND data->>'jobId' = $1", [id]);
        await del(c, 'jobs', id);
        await stamp(c, by);
      });
    },

    // New order for one ranked list: ids[0] becomes rank 1, ids[1] rank 2, …
    reorderJobs(ids, by) {
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_JOBS_PER_PLANT || !ids.every((id) => typeof id === 'string' && ID_RE.test(id))) {
        throw bad('invalid job ids');
      }
      return tx(async (c) => {
        for (const [i, id] of ids.entries()) {
          await c.query("UPDATE docs SET data = jsonb_set(data, '{rank}', to_jsonb($2::int)), updated_at = now() WHERE collection = 'jobs' AND id = $1", [id, i + 1]);
        }
        await stamp(c, by);
      });
    },

    // Several jobs in one transaction (the "ลบงานซ้ำ" button), so the trend is restamped once.
    deleteJobs(ids, by) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((id) => typeof id === 'string' && ID_RE.test(id))) {
        throw bad('invalid job ids');
      }
      return tx(async (c) => {
        await c.query("DELETE FROM docs WHERE collection = 'photos' AND data->>'jobId' = ANY($1::text[])", [ids]);
        await c.query("DELETE FROM docs WHERE collection = 'jobs' AND id = ANY($1::text[])", [ids]);
        await stamp(c, by);
      });
    },

    /** The history as JSON text, passed straight through to the browser (no parse/stringify in the Worker). */
    async wohistText() {
      const r = await conn.query("SELECT data::text AS t FROM docs WHERE collection = 'wohist' AND id = 'current'");
      return r.rows[0]?.t || 'null';
    },

    /** Import in parts (the browser sends ~500 rows at a time): part 0 replaces, later parts append in SQL. */
    saveWohist(body, by) {
      const rows = cleanHist(body?.rows);
      const part = Math.max(0, parseInt(body?.part, 10) || 0);
      return tx(async (c) => {
        if (part === 0) {
          const asOf = DATE_RE.test(body?.asOf) ? body.asOf : null; // how current the export is (latest date in it)
          await put(c, 'wohist', 'current', { uploadedAt: new Date().toISOString(), uploadedBy: by || null, fileName: String(body?.fileName || '').slice(0, 120), asOf, rows });
        } else {
          const r = await c.query("UPDATE docs SET data = jsonb_set(data, '{rows}', (data->'rows') || $1::jsonb), updated_at = now() WHERE collection = 'wohist' AND id = 'current'", [JSON.stringify(rows)]);
          if (!r.rowCount) throw bad('history import must start with part 0');
        }
        if (body?.last) await stamp(c, by);
      });
    },

    async backlog() {
      const r = await conn.query("SELECT data FROM docs WHERE collection = 'backlog' AND id = 'current'");
      return r.rows[0]?.data || null;
    },

    saveBacklog(body, by) {
      const rows = cleanBacklog(body?.rows);
      const doc = { uploadedAt: new Date().toISOString(), uploadedBy: by || null, fileName: String(body?.fileName || '').slice(0, 120), rows };
      const fileDate = DATE_RE.test(body?.fileDate) ? body.fileDate : null; // as-of date of this daily file
      // Baseline: restart the performance report from this file on the given day (today or up to 60 days back).
      const base = DATE_RE.test(body?.baseline) ? body.baseline : null;
      if (base) {
        const today = iso(bangkokToday());
        const oldest = iso(new Date(bangkokToday().getTime() - 60 * 864e5));
        if (base > today || base < oldest) throw bad('invalid baseline date');
        return tx(async (c) => {
          const hist = await syncHist(c, rows, iso(bangkokToday()), fileDate);
          await c.query("DELETE FROM docs WHERE collection = 'stats'");
          await put(c, 'stats', base, baselineStats(rows, base, doc.uploadedAt, doc.fileName, compactDash(rows, pd(base))));
          await put(c, 'backlog', 'current', doc);
          await stamp(c, by);
          return { hist };
        });
      }
      return tx(async (c) => {
        // Record the day's performance (new / started / finished / closed + open snapshot) against the previous upload.
        const prev = (await c.query("SELECT data FROM docs WHERE collection = 'backlog' AND id = 'current'")).rows[0]?.data;
        const t = bangkokToday();
        const day = iso(t);
        const old = (await c.query("SELECT data FROM docs WHERE collection = 'stats' AND id = $1", [day])).rows[0]?.data;
        const stats = foldDayStats(old, { day, events: dayEvents(prev?.rows, rows, day), snapshot: openSnapshot(rows, t), at: doc.uploadedAt, fileName: doc.fileName, dash: compactDash(rows, t) });
        await put(c, 'stats', day, stats);
        const hist = await syncHist(c, rows, day, fileDate);
        await put(c, 'backlog', 'current', doc);
        await stamp(c, by);
        return { hist };
      });
    },

    /** Daily performance documents, oldest first (the last `days` days that had an upload). */
    async stats(days = 90) {
      const r = await conn.query("SELECT data FROM docs WHERE collection = 'stats' ORDER BY id DESC LIMIT $1", [Math.min(366, Math.max(1, days))]);
      return r.rows.map((x) => x.data).reverse();
    },

    saveImpact(pid, impact, by) {
      if (!PLANT_IDS.includes(Number(pid))) throw bad('invalid plant');
      if (!Array.isArray(impact)) throw bad('impact must be a list');
      return tx(async (c) => { await put(c, 'plants', String(pid), { impact: impact.slice(0, 20).map((s) => str(s)) }); await stamp(c, by); });
    },

    importData(d, by) {
      if (!d || !Array.isArray(d.jobs)) throw bad('file must contain jobs');
      const cleaned = d.jobs.map((j) => {
        const id = String(j.id || newId('j')).replace(/[^\w\-.~:@+]/g, '_').slice(0, 100);
        return cleanJob(id, { ...j, photos: Array.isArray(j.photos) ? j.photos.map(({ src, date }) => ({ src, date })) : undefined });
      });
      return tx(async (c) => {
        for (const { job, photos } of cleaned) await writeJob(c, job, photos);
        if (d.replace) { // remove jobs (and their photos) that are not in the imported set
          const keep = cleaned.map((x) => x.job.id);
          await c.query("DELETE FROM docs WHERE collection = 'photos' AND NOT (data->>'jobId' = ANY($1::text[]))", [keep]);
          await c.query("DELETE FROM docs WHERE collection = 'jobs' AND NOT (id = ANY($1::text[]))", [keep]);
        }
        await checkLimit(c);
        for (const [pid, v] of Object.entries(d.plants || {})) {
          if (PLANT_IDS.includes(Number(pid)) && Array.isArray(v?.impact)) await put(c, 'plants', String(pid), { impact: v.impact.map((s) => str(s)) });
        }
        for (const h of d.history || []) if (DATE_RE.test(h?.date)) await put(c, 'history', h.date, h);
        await stamp(c, by);
      });
    },
  };
}
