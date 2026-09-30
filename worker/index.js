// Cloudflare Worker: serves the built site (dist/, via the ASSETS binding) and the /api routes,
// storing data in Neon Postgres (DATABASE_URL secret) through node-postgres.
import pg from 'pg';
import { Client as NeonClient } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createDb, inTx } from '../server/core.js';
import { handleApi, permissions } from '../server/api.js';

let initialized = false; // schema + first-run seed, once per isolate
let jwks = null;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
// Photo ids never change content, so browsers may cache them for a long time.
const toResponse = (r) => (r.bytes
  ? new Response(r.bytes, { status: r.status, headers: { 'Content-Type': r.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' } })
  : json(r.status, r.json));
// Reject if `promise` takes longer than `ms`; pg's own timeouts do not fire on the Workers runtime.
const within = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms)),
]);
// Short reason shown on the site when the database cannot be reached (never includes secrets).
const reason = (e) => String(e?.code || e?.message || 'unknown').replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 220);

// Verify the Cloudflare Access login token; returns the user's email, or null when Access is off.
async function accessEmail(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('missing token');
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  jwks ||= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
  return typeof payload.email === 'string' ? payload.email : null;
}

// Open a database client. For Neon, try its WebSocket driver (port 443, Neon's recommended path
// from Workers) first and fall back to a direct TCP connection; report every attempt's error.
async function connectDb(url) {
  const attempts = /\.neon\.tech\b/.test(url)
    ? [['websocket', () => new NeonClient(url)], ['tcp', () => new pg.Client({ connectionString: url })]]
    : [['tcp', () => new pg.Client({ connectionString: url })]];
  const errors = [];
  for (const [how, make] of attempts) {
    const client = make();
    try {
      await within(client.connect(), 10000, `${how} connection`);
      return client;
    } catch (e) {
      errors.push(reason(e));
      client.end().catch(() => {});
    }
  }
  throw Object.assign(new Error(errors.join(' | ')), { joined: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    let email;
    try {
      email = await accessEmail(request, env);
    } catch {
      return json(401, { error: 'login_required' });
    }
    if (!env.DATABASE_URL) return json(503, { error: 'database_unavailable', detail: 'DATABASE_URL is not set' });

    // Fail fast with a reason instead of hanging when the database is unreachable or waking up.
    let client = null;
    let stage = 'connect';
    try {
      client = await connectDb(env.DATABASE_URL);
      stage = 'query';
      const db = createDb({ query: (t, p) => client.query(t, p), tx: (fn) => inTx(client, fn) });
      if (!initialized) { await within(db.init(), 20000, 'database setup'); initialized = true; }
      const body = request.method === 'PUT' || request.method === 'POST' ? await request.json().catch(() => null) : null;
      const perm = permissions(env, email, request.headers.get('X-Edit-Key'));
      const r = await within(handleApi(db, { method: request.method, path: url.pathname, body, perm }), 20000, 'database query');
      return toResponse(r);
    } catch (e) {
      console.error(e);
      return json(503, { error: 'database_unavailable', detail: `${stage}: ${e?.joined ? e.message : reason(e)}` });
    } finally {
      if (client) ctx.waitUntil(client.end().catch(() => {}));
    }
  },
};
