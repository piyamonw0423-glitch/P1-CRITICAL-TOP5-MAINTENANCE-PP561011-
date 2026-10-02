// Node server alternative to the Cloudflare Worker, e.g. for an in-house server:
// serves the built site (dist/) and the same /api routes, with Postgres at DATABASE_URL.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { createDb, inTx } from './core.js';
import { handleApi, permissions } from './api.js';

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
const db = createDb({
  query: (t, p) => pool.query(t, p),
  tx: async (fn) => {
    const c = await pool.connect();
    try { return await inTx(c, fn); } finally { c.release(); }
  },
});
await db.init();

const app = express();
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// No Cloudflare Access here, so no verified email; EDIT_PASSWORD still applies.
app.use('/api', async (req, res) => {
  const perm = permissions(process.env, null, req.get('X-Edit-Key'));
  // LINE webhook signatures need the raw body; express.json keeps it in req.rawBody (see verify below).
  const r = await handleApi(db, {
    method: req.method, path: req.baseUrl + req.path, body: req.body, perm, env: process.env,
    rawBody: req.rawBody || '', signature: req.get('X-Line-Signature') || '', url: process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}/`,
  });
  if (r.raw != null) { res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).status(r.status).send(r.raw); return; }
  if (r.bytes) {
    res.set({ 'Content-Type': r.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' }).status(r.status).send(Buffer.from(r.bytes));
    return;
  }
  res.set('Cache-Control', 'no-store').status(r.status).json(r.json);
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`P1 dashboard listening on :${PORT}`));
