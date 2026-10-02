// Framework-free API router shared by the Cloudflare Worker and the Node server.
// Access control (all optional, set as environment variables):
//   ACCESS_TEAM_DOMAIN + ACCESS_AUD  Cloudflare Access login; the Worker verifies it and passes `email`.
//   EDITOR_EMAILS                    comma-separated emails allowed to edit (needs Access). Others view only.
//   EDIT_PASSWORD                    team password required for every change (sent as X-Edit-Key).
//                                    Not set → the site is view-only, unless ALLOW_OPEN_EDIT=true (local testing).

import { handleWebhook, lineConfigured, linePush, summaryText, verifyLineSignature } from './line.js';

const enc = new TextEncoder();
// Compare secrets without leaking their length/prefix through timing.
const safeEqual = (a, b) => {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

// Passwords are compared trimmed and NFC-normalised: browsers strip spaces around header values and a
// secret pasted into the Cloudflare dashboard often carries a trailing newline.
const normKey = (s) => String(s ?? '').normalize('NFC').trim();
// The browser sends the key URI-encoded so non-Latin (e.g. Thai) passwords survive the HTTP header.
const decodeKey = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Who is calling and what they may do, from the verified email and the environment. */
export function permissions(env, email, editKey) {
  const editors = String(env.EDITOR_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const byEmail = editors.length ? !!email && editors.includes(email.toLowerCase()) : true;
  const secret = normKey(env.EDIT_PASSWORD);
  const given = normKey(decodeKey(editKey || ''));
  const needsKey = !!secret;
  const keyOk = !needsKey || (!!given && safeEqual(given, secret));
  // Secure default: with no team password and no Access editor list, nobody may change data.
  const unprotected = !needsKey && !editors.length && String(env.ALLOW_OPEN_EDIT) !== 'true';
  return { email: email || null, canWrite: byEmail && !unprotected, needsKey, keyOk, setup: unprotected ? 'no_password' : null };
}

const ok = (json = { ok: true }) => ({ status: 200, json });
const fail = (status, error) => ({ status, json: { error } });

/**
 * @param db    createDb(...) instance
 * @param req   { method, path, body, perm, env, rawBody, signature, url } — perm from permissions();
 *              env/rawBody/signature/url are only needed for the LINE routes (url = site link for messages)
 * @returns     { status, json } — or { status, bytes, contentType } for a photo
 */
export async function handleApi(db, { method, path, body, perm, env = {}, rawBody = '', signature = '', url = '' }) {
  const m = path.match(/^\/api\/(jobs|plants|photos)\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[2]) : null;
  const isWrite = method !== 'GET' && method !== 'HEAD';

  try {
    if (method === 'GET' && path === '/api/health') { await db.ping(); return ok(); }
    if (method === 'GET' && path === '/api/me') return ok({ email: perm.email, canWrite: perm.canWrite, needsKey: perm.needsKey, setup: perm.setup, line: lineConfigured(env) });
    // LINE calls this with its own signature (no team password); replies are free and need no quota.
    if (method === 'POST' && path === '/api/line/webhook') {
      if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) return fail(404, 'not_found');
      if (!(await verifyLineSignature(env.LINE_CHANNEL_SECRET, rawBody, signature))) return fail(401, 'bad_signature');
      await handleWebhook(env, db, body, url).catch((e) => console.error('line webhook', e));
      return ok();
    }
    if (method === 'GET' && path === '/api/backlog') return ok(await db.backlog());
    if (method === 'GET' && path === '/api/stats') return ok({ days: await db.stats() });
    if (method === 'GET' && path === '/api/wohist') return ok(await db.wohist());
    if (method === 'GET' && path === '/api/state') return ok(await db.state());
    if (method === 'GET' && path === '/api/version') return ok(await db.version());
    if (method === 'GET' && m?.[1] === 'photos') {
      const ph = await db.photo(id);
      return ph ? { status: 200, ...ph } : fail(404, 'not_found');
    }

    if (isWrite) {
      if (!perm.canWrite) return fail(403, perm.setup || 'read_only');
      if (method === 'POST' && path === '/api/check-key') return perm.keyOk ? ok() : fail(401, 'wrong_key');
      if (!perm.keyOk) return fail(401, 'wrong_key');
      const by = perm.email || null;
      if (method === 'POST' && path === '/api/jobs/delete') { await db.deleteJobs(body?.ids, by); return ok(); }
      if (method === 'POST' && path === '/api/jobs/rank') { await db.reorderJobs(body?.ids, by); return ok(); }
      if (method === 'PUT' && m?.[1] === 'jobs') { await db.saveJob(id, body, by); return ok(); }
      if (method === 'DELETE' && m?.[1] === 'jobs') { await db.deleteJob(id, by); return ok(); }
      if (method === 'PUT' && m?.[1] === 'plants') { await db.saveImpact(id, body?.impact, by); return ok(); }
      if (method === 'POST' && path === '/api/import') { await db.importData(body, by); return ok(); }
      if (method === 'PUT' && path === '/api/wohist') { await db.saveWohist(body, by); return ok(); }
      if (method === 'POST' && path === '/api/line/test') {
        if (!lineConfigured(env)) return fail(400, 'line_not_configured');
        try {
          await linePush(env, `✅ ทดสอบการแจ้งเตือนจาก TOP5 Maintenance Dashboard\n\n${summaryText({ days: await db.stats(2), backlog: await db.backlog(), url })}`);
          return ok();
        } catch (e) {
          return fail(502, `line_failed:${e.lineStatus ?? ''}`);
        }
      }
      if (method === 'PUT' && path === '/api/backlog') {
        await db.saveBacklog(body, by);
        // Summary to LINE after each upload (not for a baseline); a LINE failure never fails the upload itself.
        let line = 'off';
        if (lineConfigured(env) && !body?.baseline) {
          try {
            await linePush(env, summaryText({ days: await db.stats(2), backlog: await db.backlog(), url }));
            line = 'sent';
          } catch (e) {
            console.error('line push', e);
            line = 'failed';
          }
        }
        return ok({ ok: true, line });
      }
    }
    return fail(404, 'not_found');
  } catch (e) {
    if (e.status && e.expose) return fail(e.status, e.message);
    console.error(e);
    return { status: 500, json: { error: 'server_error', detail: String(e?.message || e).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 160) } };
  }
}
