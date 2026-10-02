import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_JOBS_PER_PLANT, PLANT_IDS, SEED, STORAGE_KEY, commitData, counts, loadData } from './data.js';
import { iso, today0 } from './dates.js';
import { sameWo } from './dedupe.js';
import { applyDailyToHist, baselineStats, dayEvents, foldDayStats, openSnapshot } from './cmms.js';

// Fold one CMMS upload into today's performance document (same rules as the server's saveBacklog).
const statsAfterUpload = (prevRows, rows, old, fileName, at) => {
  const t = today0();
  const day = iso(t);
  return foldDayStats(old, { day, events: dayEvents(prevRows, rows, day), snapshot: openSnapshot(rows, t), at, fileName });
};

/*
 * Data layer. Two backends behind one hook:
 *  - shared: the claude.ai artifact `db` capability (artifact build, __BACKEND__ = 'artifact').
 *    Everyone with edit access reads and writes the same records, live.
 *      jobs/<jobId>      one job (without photos)
 *      photos/<photoId>  { jobId, src, date } — kept apart to stay under the 256 KiB doc limit
 *      plants/<plantId>  { impact: string[] }
 *      history/<date>    { date, done, doing, stuck, p } — one snapshot per day for the trend
 *      meta/app          { updatedAt, updatedBy }
 *  - api: the Cloudflare Worker in worker/ (or the Node server in server/), Neon Postgres behind it.
 *    Built with `npm run build:server`.
 *  - local: browser localStorage (plain website build), seeded with sample data.
 */

// eslint-disable-next-line no-undef
export const BACKEND = typeof __BACKEND__ !== 'undefined' ? __BACKEND__ : 'local';

const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class StoreError extends Error {
  constructor(code, message, detail) { super(message || code); this.code = code; this.detail = detail; }
}

// Retry once on a transient `unavailable`, as the db contract recommends.
async function call(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code !== 'unavailable') throw new StoreError(e?.code || 'unknown', e?.message);
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    try { return await fn(); } catch (e2) { throw new StoreError(e2?.code || 'unknown', e2?.message); }
  }
}

const snapshotFor = (jobs) => {
  const t = today0();
  const p = Object.fromEntries(PLANT_IDS.map((id) => [id, counts(jobs.filter((j) => j.plant === id), t)]));
  return { date: iso(t), ...counts(jobs, t), p };
};

const stripPhotos = ({ photos, ...job }) => job; // eslint-disable-line no-unused-vars

// Adding a job to a plant (new, or moved from another plant) must not exceed the per-plant limit.
const assertRoom = (jobs, job) => {
  if (sameWo(jobs, job)) throw new StoreError('duplicate_wo');
  const prev = jobs.find((j) => j.id === job.id);
  if (prev?.plant === job.plant) return;
  if (jobs.filter((j) => j.plant === job.plant && j.id !== job.id).length >= MAX_JOBS_PER_PLANT) throw new StoreError('plant_full');
};

/** The old single-browser data (from the local-only version of this page), if any. */
export const readLocalBackup = () => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return s && Array.isArray(s.jobs) && s.jobs.length ? s : null;
  } catch {
    return null;
  }
};

// BACKEND is a build-time constant, so the same hook is used on every render.
export function useDashboardStore() {
  /* eslint-disable react-hooks/rules-of-hooks */
  if (BACKEND === 'artifact') return useSharedStore();
  if (BACKEND === 'api') return useApiStore();
  return useLocalStore();
  /* eslint-enable react-hooks/rules-of-hooks */
}

/* ---------------- api (Cloudflare Worker or Node server + Postgres) ---------------- */

const KEY_STORE = 'p1dash.editKey';
const readKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const writeKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ } };
const POLL_MS = 15000;
const TIMEOUT_MS = 30000;
// fetch() that gives up after TIMEOUT_MS instead of leaving the page waiting forever.
const fetchT = (url, opts = {}) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
};

function useApiStore() {
  const [status, setStatus] = useState('connecting');
  const [data, setData] = useState({ jobs: [], plants: {}, history: [], updatedAt: null, updatedBy: null });
  const [me, setMe] = useState({ email: null, canWrite: null, needsKey: false });
  const [editKey, setEditKey] = useState(readKey);
  const [problem, setProblem] = useState('');
  const [backlog, setBacklog] = useState(null); // CMMS WO snapshot, fetched only when backlogAt changes
  const [stats, setStats] = useState([]); // daily performance docs, refreshed with the backlog
  const [wohist, setWohist] = useState(null); // yearly WO history, fetched when wohistAt changes
  const wohistAtRef = useRef(undefined);
  const versionRef = useRef(null);
  const backlogAtRef = useRef(undefined);

  const load = useCallback(async () => {
    const r = await fetchT('api/state', { cache: 'no-store' });
    if (!r.ok) throw new StoreError('unavailable');
    const d = await r.json();
    versionRef.current = d.updatedAt;
    setData(d);
    setStatus('ready');
    if (d.wohistAt !== wohistAtRef.current) {
      wohistAtRef.current = d.wohistAt;
      if (!d.wohistAt) setWohist(null);
      else fetchT('api/wohist', { cache: 'no-store' }).then((b) => (b.ok ? b.json() : null)).then((b) => b && setWohist(b)).catch(() => {});
    }
    if (d.backlogAt !== backlogAtRef.current) {
      backlogAtRef.current = d.backlogAt;
      if (!d.backlogAt) setBacklog(null);
      else {
        fetchT('api/backlog', { cache: 'no-store' }).then((b) => (b.ok ? b.json() : null)).then((b) => b && setBacklog(b)).catch(() => {});
        fetchT('api/stats', { cache: 'no-store' }).then((b) => (b.ok ? b.json() : null)).then((b) => b && setStats(b.days || [])).catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    // Learn the edit rules before the page is ready, so the edit button knows whether to ask for the password.
    const loadMe = fetchT('api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((m) => m && setMe(m)).catch(() => {});
    loadMe.then(load).catch(async (err) => {
      setStatus('unavailable');
      // Ask the server why, so the page can show a reason an administrator can act on.
      try {
        const r = await fetchT('api/health', { cache: 'no-store' });
        const b = await r.json().catch(() => ({}));
        setProblem(b.detail || b.error || `HTTP ${r.status}`);
      } catch (e) {
        setProblem(e?.name === 'AbortError' || err?.name === 'AbortError' ? 'timeout: เซิร์ฟเวอร์ไม่ตอบภายใน 30 วินาที' : 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
      }
    });
    // Poll a tiny version stamp while the tab is visible; fetch everything only when it changes.
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetchT('api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { updatedAt } = await r.json();
        if (updatedAt !== versionRef.current) await load();
      } catch { /* offline; try again next tick */ }
    };
    const t = setInterval(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const request = async (method, url, body, key = editKey) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    // URI-encoded so Thai or other non-Latin passwords can travel in a header; the server decodes and trims.
    if (key) headers['X-Edit-Key'] = encodeURIComponent(key.normalize('NFC').trim());
    try {
      return await fetchT(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new StoreError('unavailable');
    }
  };

  const send = async (method, url, body) => {
    const r = await request(method, url, body);
    if (r.status === 401) { writeKey(''); setEditKey(''); throw new StoreError('wrong_key'); }
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const code = String(b.error || '').startsWith('plant_full') ? 'plant_full'
        : b.error === 'no_password' || b.error === 'duplicate_wo' || b.error === 'line_not_configured' ? b.error
          : String(b.error || '').startsWith('line_failed') ? 'line_failed'
          : { 400: 'bad_request', 403: 'read_only', 413: 'quota_exceeded' }[r.status] || 'unavailable';
      throw new StoreError(code, b.error, b.detail || b.error || `HTTP ${r.status}`);
    }
    const out = await r.json().catch(() => ({}));
    await load().catch(() => {});
    return out;
  };

  // Check a team edit password with the server and remember it on this device.
  const unlock = async (key) => {
    const r = await request('POST', 'api/check-key', null, key);
    if (r.status === 401) throw new StoreError('wrong_key');
    if (!r.ok) throw new StoreError(r.status === 403 ? 'read_only' : 'unavailable');
    writeKey(key);
    setEditKey(key);
  };

  return {
    status,
    shared: true,
    canWrite: me.canWrite,
    setup: me.setup || null,
    needsKey: me.needsKey && !editKey,
    unlock,
    data,
    backlog,
    stats,
    wohist,
    // Sent in parts so no single request makes the Worker handle the whole year at once.
    uploadHistory: async ({ fileName, rows, asOf }) => {
      const PART = 500;
      for (let i = 0, part = 0; i < rows.length; i += PART, part++) {
        const last = i + PART >= rows.length;
        const r = await request('PUT', 'api/wohist', { fileName, asOf, rows: rows.slice(i, i + PART), part, last });
        if (r.status === 401) { writeKey(''); setEditKey(''); throw new StoreError('wrong_key'); }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new StoreError(r.status === 403 ? (b.error === 'no_password' ? 'no_password' : 'read_only') : r.status === 400 ? 'bad_request' : 'unavailable', b.error, b.detail || b.error || `HTTP ${r.status}`);
        }
      }
      await load().catch(() => {});
    },
    uploadBacklog: (b) => send('PUT', 'api/backlog', b),
    line: !!me.line, // LINE notifications configured on the server
    testLine: () => send('POST', 'api/line/test'),
    whoUpdated: data.updatedBy || '',
    unavailableText: `เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้ หากยังไม่ได้ ให้แจ้งผู้ดูแลแดชบอร์ดพร้อมรหัสปัญหา${problem ? ` · รหัสปัญหา: ${problem}` : ''}`,
    saveJob: (job) => send('PUT', `api/jobs/${encodeURIComponent(job.id)}`, job),
    deleteJob: (id) => send('DELETE', `api/jobs/${encodeURIComponent(id)}`),
    reorderJobs: (ids) => send('POST', 'api/jobs/rank', { ids }),
    // Bulk delete in chunks (one transaction each) so large clean-ups can report progress.
    deleteJobs: async (ids, onProgress) => {
      const CHUNK = 10;
      onProgress?.(0, ids.length);
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const r = await request('POST', 'api/jobs/delete', { ids: part });
        if (r.status === 401) { writeKey(''); setEditKey(''); throw new StoreError('wrong_key'); }
        if (!r.ok) throw new StoreError(r.status === 403 ? 'read_only' : 'unavailable', null, `HTTP ${r.status}`);
        onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
      }
      await load().catch(() => {});
    },
    saveImpact: (pid, impact) => send('PUT', `api/plants/${pid}`, { impact }),
    importData: (d) => send('POST', 'api/import', d),
    resetSample: null,
  };
}

/* ---------------- local (per-browser) ---------------- */

const BACKLOG_KEY = 'p1dash.backlog';
const readBacklog = () => { try { return JSON.parse(localStorage.getItem(BACKLOG_KEY)); } catch { return null; } };
const STATS_KEY = 'p1dash.stats';
const HIST_KEY = 'p1dash.wohist';
const readHist = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY)); } catch { return null; } };
const readStats = () => { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || []; } catch { return []; } };

function useLocalStore() {
  const [data, setData] = useState(loadData);
  const [backlog, setBacklog] = useState(readBacklog);
  const [stats, setStats] = useState(readStats);
  const [wohist, setWohist] = useState(readHist);
  const commit = (next) => {
    const { next: saved, ok } = commitData(next);
    setData(saved);
    if (!ok) throw new StoreError('quota_exceeded');
  };
  return {
    status: 'ready',
    shared: false,
    canWrite: true,
    data,
    backlog,
    stats,
    wohist,
    uploadHistory: async ({ fileName, rows, asOf }) => {
      const doc = { uploadedAt: new Date().toISOString(), fileName, asOf: asOf || null, rows };
      try { localStorage.setItem(HIST_KEY, JSON.stringify(doc)); } catch { throw new StoreError('quota_exceeded'); }
      setWohist(doc);
    },
    uploadBacklog: async ({ fileName, rows, baseline, fileDate }) => {
      const doc = { uploadedAt: new Date().toISOString(), fileName, rows };
      // A baseline restarts the report from this file; otherwise fold the upload into today's stats.
      const nextStats = baseline
        ? [baselineStats(rows, baseline, doc.uploadedAt, fileName)]
        : (() => {
          const day = statsAfterUpload(backlog?.rows, rows, stats.find((x) => x.date === iso(today0())), fileName, doc.uploadedAt);
          return stats.filter((x) => x.date !== day.date).concat([day]).sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
        })();
      // Same guard as the server: a daily file older than the history does not update it.
      const histOk = wohist && !(fileDate && wohist.asOf && fileDate < wohist.asOf);
      const nextHist = histOk ? { ...wohist, rows: applyDailyToHist(wohist.rows, rows, iso(today0())).rows, syncedAt: doc.uploadedAt, asOf: [wohist.asOf || '', fileDate || ''].sort().at(-1) || null } : null;
      try {
        localStorage.setItem(BACKLOG_KEY, JSON.stringify(doc));
        localStorage.setItem(STATS_KEY, JSON.stringify(nextStats));
        if (nextHist) localStorage.setItem(HIST_KEY, JSON.stringify(nextHist));
      } catch { throw new StoreError('quota_exceeded'); }
      setBacklog(doc);
      setStats(nextStats);
      if (nextHist) setWohist(nextHist);
      return { hist: !wohist ? 'none' : histOk ? 'synced' : 'skipped' };
    },
    whoUpdated: '',
    saveJob: async (job) => {
      assertRoom(data.jobs, job);
      const exists = data.jobs.some((j) => j.id === job.id);
      commit({ ...data, jobs: exists ? data.jobs.map((j) => (j.id === job.id ? job : j)) : data.jobs.concat([job]) });
    },
    deleteJob: async (id) => commit({ ...data, jobs: data.jobs.filter((j) => j.id !== id) }),
    reorderJobs: async (ids) => commit({ ...data, jobs: data.jobs.map((j) => (ids.includes(j.id) ? { ...j, rank: ids.indexOf(j.id) + 1 } : j)) }),
    deleteJobs: async (ids, onProgress) => { commit({ ...data, jobs: data.jobs.filter((j) => !ids.includes(j.id)) }); onProgress?.(ids.length, ids.length); },
    saveImpact: async (pid, impact) => commit({ ...data, plants: { ...data.plants, [pid]: { ...data.plants[pid], impact } } }),
    // Upsert by id (d.replace: only d.jobs remain). Jobs without `photos` keep their current photos.
    importData: async (d) => {
      const old = new Map(data.jobs.map((j) => [j.id, j]));
      const withPhotos = (j) => (Array.isArray(j.photos) ? j : { ...j, photos: old.get(j.id)?.photos || [] });
      const incoming = new Map(d.jobs.map((j) => [j.id, withPhotos(j)]));
      const jobs = d.replace
        ? [...incoming.values()]
        : data.jobs.map((j) => incoming.get(j.id) || j).concat([...incoming.values()].filter((j) => !old.has(j.id)));
      const history = d.history
        ? data.history.filter((h) => !d.history.some((x) => x.date === h.date)).concat(d.history)
        : data.history;
      commit({ ...data, jobs, plants: { ...data.plants, ...(d.plants || {}) }, history });
    },
    resetSample: async () => commit(SEED()),
  };
}

/* ---------------- shared (claude.ai artifact db) ---------------- */

function useSharedStore() {
  const [status, setStatus] = useState('connecting'); // connecting | ready | unavailable
  const [parts, setParts] = useState({ jobs: null, photos: [], plants: {}, history: [], meta: {} });
  const [canWrite, setCanWrite] = useState(null); // null = platform did not say; keep inputs
  const [whoUpdated, setWhoUpdated] = useState('');
  const dbRef = useRef(null);
  const userRef = useRef(null);
  const partsRef = useRef(parts);
  partsRef.current = parts;

  useEffect(() => {
    let alive = true;
    const unsubs = [];
    (async () => {
      const db = window.claude?.use ? await window.claude.use('db').catch(() => null) : null;
      if (!alive) return;
      if (!db) { setStatus('unavailable'); return; }
      dbRef.current = db;
      const user = await window.claude.use('user').catch(() => null);
      if (!alive) return;
      userRef.current = user;
      if (user) user.can('data.write').then((v) => alive && setCanWrite(v)).catch(() => {});
      else setCanWrite(false);

      const onErr = (e) => { if (e?.code === 'revoked') setStatus('unavailable'); };
      const docsToObj = (snap) => Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      unsubs.push(
        db.collection('jobs').onSnapshot((s) => {
          setParts((p) => ({ ...p, jobs: s.docs.map((d) => ({ ...d.data(), id: d.id })) }));
          setStatus('ready');
        }, onErr),
        db.collection('photos').onSnapshot((s) => setParts((p) => ({ ...p, photos: s.docs.map((d) => ({ ...d.data(), id: d.id })) })), onErr),
        db.collection('plants').onSnapshot((s) => setParts((p) => ({ ...p, plants: docsToObj(s) })), onErr),
        db.collection('history').onSnapshot((s) => setParts((p) => ({ ...p, history: s.docs.map((d) => d.data()) })), onErr),
        db.doc('meta/app').onSnapshot((s) => setParts((p) => ({ ...p, meta: s.exists ? s.data() : {} })), onErr),
        db.doc('backlog/current').onSnapshot((s) => setParts((p) => ({ ...p, backlog: s.exists ? s.data() : null })), onErr),
        db.collection('stats').onSnapshot((s) => setParts((p) => ({ ...p, stats: s.docs.map((d) => d.data()).sort((a, b) => a.date.localeCompare(b.date)) })), onErr),
      );
    })();
    return () => { alive = false; unsubs.forEach((u) => u()); };
  }, []);

  // Resolve "updated by" to a display name each time it changes (names are never stored).
  const updatedBy = parts.meta.updatedBy;
  useEffect(() => {
    const user = userRef.current;
    if (!user || !updatedBy) { setWhoUpdated(''); return; }
    let alive = true;
    user.profiles([updatedBy]).then((ps) => { if (alive) setWhoUpdated(ps[updatedBy]?.name || ''); }).catch(() => {});
    return () => { alive = false; };
  }, [updatedBy, status]);

  const guard = useCallback(async (fn) => {
    try {
      return await fn(dbRef.current);
    } catch (e) {
      const err = e instanceof StoreError ? e : new StoreError(e?.code || 'unknown', e?.message);
      if (err.code === 'invalid_argument') setCanWrite(false);
      throw err;
    }
  }, []);

  // After every change: today's trend snapshot + who/when.
  const stamp = async (db, jobsAfter) => {
    const snap = snapshotFor(jobsAfter);
    await call(() => db.doc(`history/${snap.date}`).set(snap));
    const uid = userRef.current ? await userRef.current.id().catch(() => null) : null;
    await call(() => db.doc('meta/app').set({ updatedAt: new Date().toISOString(), ...(uid ? { updatedBy: uid } : {}) }));
  };

  const writePhotos = async (db, jobId, wanted) => {
    const existing = partsRef.current.photos.filter((ph) => ph.jobId === jobId);
    const keep = new Set(wanted.filter((ph) => ph.id).map((ph) => ph.id));
    for (const ph of existing) if (!keep.has(ph.id)) await call(() => db.doc(`photos/${ph.id}`).delete());
    for (const ph of wanted) {
      if (ph.id) continue;
      const pid = newId('p');
      await call(() => db.doc(`photos/${pid}`).set({ jobId, src: ph.src, date: ph.date }));
    }
  };

  const saveJob = (job) => guard(async (db) => {
    assertRoom(partsRef.current.jobs || [], job);
    await writePhotos(db, job.id, job.photos || []);
    await call(() => db.doc(`jobs/${job.id}`).set(stripPhotos(job)));
    const others = (partsRef.current.jobs || []).filter((j) => j.id !== job.id);
    await stamp(db, others.concat([job]));
  });

  const deleteJob = (id) => guard(async (db) => {
    for (const ph of partsRef.current.photos.filter((p) => p.jobId === id)) await call(() => db.doc(`photos/${ph.id}`).delete());
    await call(() => db.doc(`jobs/${id}`).delete());
    await stamp(db, (partsRef.current.jobs || []).filter((j) => j.id !== id));
  });

  const saveImpact = (pid, impact) => guard(async (db) => {
    await call(() => db.doc(`plants/${pid}`).set({ impact }));
    await stamp(db, partsRef.current.jobs || []);
  });

  // Adds/overwrites every job, plant and history entry from an exported file (or the old local data).
  // Jobs without a `photos` key keep their photos; d.replace removes jobs missing from d.jobs.
  const importData = (d) => guard(async (db) => {
    const ids = new Set();
    for (const job of d.jobs) {
      const j = { ...job, id: String(job.id || newId('j')).replace(/[^\w\-.~:@+]/g, '_') };
      ids.add(j.id);
      if (Array.isArray(j.photos)) await writePhotos(db, j.id, j.photos.map(({ src, date }) => ({ src, date })));
      await call(() => db.doc(`jobs/${j.id}`).set(stripPhotos(j)));
    }
    if (d.replace) {
      for (const j of partsRef.current.jobs || []) {
        if (ids.has(j.id)) continue;
        for (const ph of partsRef.current.photos.filter((p) => p.jobId === j.id)) await call(() => db.doc(`photos/${ph.id}`).delete());
        await call(() => db.doc(`jobs/${j.id}`).delete());
      }
    }
    for (const [pid, v] of Object.entries(d.plants || {})) await call(() => db.doc(`plants/${pid}`).set({ impact: v.impact || [] }));
    for (const h of d.history || []) if (h?.date) await call(() => db.doc(`history/${h.date}`).set(h));
    const byId = new Map(d.replace ? [] : (partsRef.current.jobs || []).map((j) => [j.id, j]));
    d.jobs.forEach((j) => byId.set(j.id, j));
    await stamp(db, [...byId.values()]);
  });

  const photosByJob = {};
  parts.photos.forEach((ph) => { (photosByJob[ph.jobId] ||= []).push({ id: ph.id, src: ph.src, date: ph.date }); });
  Object.values(photosByJob).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));

  const data = {
    jobs: (parts.jobs || []).map((j) => ({ ...j, photos: photosByJob[j.id] || [] })),
    plants: parts.plants,
    history: [...parts.history].sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt: parts.meta.updatedAt || null,
  };

  return {
    status, shared: true, canWrite, data, whoUpdated, saveJob, deleteJob, saveImpact, importData, resetSample: null,
    reorderJobs: (ids) => guard(async (db) => {
      const jobs = (partsRef.current.jobs || []).map((j) => (ids.includes(j.id) ? { ...j, rank: ids.indexOf(j.id) + 1 } : j));
      for (const j of jobs) if (ids.includes(j.id)) await call(() => db.doc(`jobs/${j.id}`).set(stripPhotos(j)));
      await stamp(db, jobs);
    }),
    deleteJobs: (ids, onProgress) => guard(async (db) => {
      onProgress?.(0, ids.length);
      for (const [i, id] of ids.entries()) {
        for (const ph of partsRef.current.photos.filter((p) => p.jobId === id)) await call(() => db.doc(`photos/${ph.id}`).delete());
        await call(() => db.doc(`jobs/${id}`).delete());
        onProgress?.(i + 1, ids.length);
      }
      await stamp(db, (partsRef.current.jobs || []).filter((j) => !ids.includes(j.id)));
    }),
    backlog: parts.backlog || null,
    stats: parts.stats || [],
    // One document (≤ 256 KiB in the artifact store), replaced on every upload; plus stats/<day>.
    uploadBacklog: ({ fileName, rows, baseline }) => guard(async (db) => {
      const doc = { uploadedAt: new Date().toISOString(), fileName, rows };
      if (JSON.stringify(doc).length > 250000) throw new StoreError('quota_exceeded');
      if (baseline) {
        for (const old of partsRef.current.stats || []) await call(() => db.doc(`stats/${old.date}`).delete());
        await call(() => db.doc(`stats/${baseline}`).set(baselineStats(rows, baseline, doc.uploadedAt, fileName)));
      } else {
        const day = statsAfterUpload(partsRef.current.backlog?.rows, rows, (partsRef.current.stats || []).find((x) => x.date === iso(today0())), fileName, doc.uploadedAt);
        await call(() => db.doc(`stats/${day.date}`).set(day));
      }
      await call(() => db.doc('backlog/current').set(doc));
      await stamp(db, partsRef.current.jobs || []);
    }),
    unavailableText: 'กรุณาเข้าสู่ระบบ claude.ai ด้วยบัญชีที่ได้รับเชิญ แล้วเปิดลิงก์นี้อีกครั้ง หากยังเปิดไม่ได้ ให้ขอสิทธิ์จากเจ้าของแดชบอร์ด',
  };
}
