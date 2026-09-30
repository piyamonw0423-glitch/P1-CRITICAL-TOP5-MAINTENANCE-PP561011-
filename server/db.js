// Postgres storage. One table of JSON documents keyed by (collection, id), mirroring the
// artifact store: jobs, photos (kept apart from jobs), plants, history (one row per day), meta.
import crypto from 'node:crypto';
import pg from 'pg';
import { PLANT_IDS, SEED, counts } from '../src/lib/data.js';
import { iso, today0 } from '../src/lib/dates.js';

const ID_RE = /^[\w\-.~:@+]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 400000;
const STATUSES = ['pending', 'doing', 'done'];
const BLOCKERS = ['none', 'part', 'permit', 'manpower', 'shutdown', 'vendor', 'budget'];

const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });
const str = (v, max = 500) => String(v ?? '').slice(0, max);

function cleanJob(id, b) {
  if (!ID_RE.test(id)) throw bad('invalid job id');
  if (!b || typeof b !== 'object') throw bad('invalid body');
  const plant = Number(b.plant);
  if (!PLANT_IDS.includes(plant)) throw bad('invalid plant');
  if (!str(b.issue).trim()) throw bad('issue is required');
  if (!DATE_RE.test(b.start) || !DATE_RE.test(b.end)) throw bad('invalid dates');
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, MAX_PHOTOS) : [];
  for (const ph of photos) {
    if (ph.id && !ID_RE.test(ph.id)) throw bad('invalid photo id');
    if (!ph.id && !(typeof ph.src === 'string' && ph.src.startsWith('data:image/') && ph.src.length <= MAX_PHOTO_CHARS)) throw bad('invalid photo');
    if (!DATE_RE.test(ph.date)) throw bad('invalid photo date');
  }
  return {
    job: {
      id, plant,
      wo: str(b.wo, 60), rank: Math.max(1, parseInt(b.rank, 10) || 1),
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

export function createDb(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });

  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };
  const put = (c, col, id, data) => c.query(
    `INSERT INTO docs (collection, id, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [col, String(id), data],
  );
  const del = (c, col, id) => c.query('DELETE FROM docs WHERE collection = $1 AND id = $2', [col, String(id)]);
  const all = async (c, col) => (await c.query('SELECT id, data FROM docs WHERE collection = $1', [col])).rows;

  // Today's trend snapshot + last-updated time, recomputed from the stored jobs.
  const stamp = async (c) => {
    const jobs = (await all(c, 'jobs')).map((r) => r.data);
    const t = today0();
    const p = Object.fromEntries(PLANT_IDS.map((id) => [id, counts(jobs.filter((j) => j.plant === id), t)]));
    await put(c, 'history', iso(t), { date: iso(t), ...counts(jobs, t), p });
    await put(c, 'meta', 'app', { updatedAt: new Date().toISOString() });
  };

  const writeJob = async (c, job, photos) => {
    const existing = await c.query("SELECT id FROM docs WHERE collection = 'photos' AND data->>'jobId' = $1", [job.id]);
    const keep = new Set(photos.filter((ph) => ph.id).map((ph) => ph.id));
    for (const r of existing.rows) if (!keep.has(r.id)) await del(c, 'photos', r.id);
    for (const ph of photos) {
      if (!ph.id) await put(c, 'photos', `p${crypto.randomUUID()}`, { jobId: job.id, src: ph.src, date: ph.date });
    }
    await put(c, 'jobs', job.id, job);
  };

  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS docs (
        collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, id))`);
      // First start only: load the sample dashboard so the site opens populated.
      await tx(async (c) => {
        const seeded = await c.query("SELECT 1 FROM docs WHERE collection = 'meta' AND id = 'seeded'");
        if (seeded.rowCount) return;
        const d = SEED();
        for (const { photos, ...j } of d.jobs) await put(c, 'jobs', j.id, j); // eslint-disable-line no-unused-vars
        for (const [pid, v] of Object.entries(d.plants)) await put(c, 'plants', pid, { impact: v.impact });
        for (const h of d.history) await put(c, 'history', h.date, h);
        await put(c, 'meta', 'seeded', { at: new Date().toISOString() });
        await stamp(c);
      });
    },
    ping: () => pool.query('SELECT 1'),

    async state() {
      const rows = (await pool.query("SELECT collection, id, data FROM docs WHERE collection IN ('jobs','photos','plants','history','meta')")).rows;
      const photos = {};
      rows.filter((r) => r.collection === 'photos').forEach((r) => (photos[r.data.jobId] ||= []).push({ id: r.id, src: r.data.src, date: r.data.date }));
      Object.values(photos).forEach((a) => a.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)));
      const meta = rows.find((r) => r.collection === 'meta' && r.id === 'app');
      return {
        jobs: rows.filter((r) => r.collection === 'jobs').map((r) => ({ ...r.data, id: r.id, photos: photos[r.id] || [] })),
        plants: Object.fromEntries(rows.filter((r) => r.collection === 'plants').map((r) => [r.id, r.data])),
        history: rows.filter((r) => r.collection === 'history').map((r) => r.data).sort((a, b) => a.date.localeCompare(b.date)),
        updatedAt: meta?.data.updatedAt || null,
      };
    },

    saveJob(id, body) {
      const { job, photos } = cleanJob(id, body);
      return tx(async (c) => { await writeJob(c, job, photos); await stamp(c); });
    },

    deleteJob(id) {
      if (!ID_RE.test(id)) throw bad('invalid job id');
      return tx(async (c) => {
        await c.query("DELETE FROM docs WHERE collection = 'photos' AND data->>'jobId' = $1", [id]);
        await del(c, 'jobs', id);
        await stamp(c);
      });
    },

    saveImpact(pid, impact) {
      if (!PLANT_IDS.includes(Number(pid))) throw bad('invalid plant');
      if (!Array.isArray(impact)) throw bad('impact must be a list');
      return tx(async (c) => { await put(c, 'plants', String(pid), { impact: impact.slice(0, 20).map((s) => str(s)) }); await stamp(c); });
    },

    importData(d) {
      if (!d || !Array.isArray(d.jobs)) throw bad('file must contain jobs');
      const cleaned = d.jobs.map((j) => {
        const id = String(j.id || `j${crypto.randomUUID()}`).replace(/[^\w\-.~:@+]/g, '_').slice(0, 100);
        return cleanJob(id, { ...j, photos: (j.photos || []).map(({ src, date }) => ({ src, date })) });
      });
      return tx(async (c) => {
        for (const { job, photos } of cleaned) await writeJob(c, job, photos);
        for (const [pid, v] of Object.entries(d.plants || {})) {
          if (PLANT_IDS.includes(Number(pid)) && Array.isArray(v?.impact)) await put(c, 'plants', String(pid), { impact: v.impact.map((s) => str(s)) });
        }
        for (const h of d.history || []) if (DATE_RE.test(h?.date)) await put(c, 'history', h.date, h);
        await stamp(c);
      });
    },
  };
}
