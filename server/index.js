// P1 Repair Dashboard server: serves the built site (dist/) and a small shared-data API
// backed by Postgres (Supabase). Every change is pushed to open browsers over Server-Sent Events.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDb } from './db.js';

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Use the Supabase "Session pooler" connection string.');
  process.exit(1);
}

const db = createDb(DATABASE_URL);
await db.init();

const app = express();
app.use(express.json({ limit: '20mb' }));

/* ---------- live updates ---------- */
const clients = new Set();
const broadcast = () => { for (const res of clients) res.write('event: change\ndata: {}\n\n'); };
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

/* ---------- API ---------- */
const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    res.json(out ?? { ok: true });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.expose ? e.message : 'server_error' });
  }
};
const changed = (fn) => wrap(async (req, res) => { const out = await fn(req, res); broadcast(); return out; });

app.get('/api/health', wrap(async () => { await db.ping(); return { ok: true }; }));
app.get('/api/state', wrap(() => db.state()));
app.put('/api/jobs/:id', changed((req) => db.saveJob(req.params.id, req.body)));
app.delete('/api/jobs/:id', changed((req) => db.deleteJob(req.params.id)));
app.put('/api/plants/:id', changed((req) => db.saveImpact(req.params.id, req.body?.impact)));
app.post('/api/import', changed((req) => db.importData(req.body)));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

/* ---------- static site ---------- */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`P1 dashboard listening on :${PORT}`));
