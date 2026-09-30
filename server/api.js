// Framework-free API router shared by the Cloudflare Worker and the Node server.
// Access control (all optional, set as environment variables):
//   ACCESS_TEAM_DOMAIN + ACCESS_AUD  Cloudflare Access login; the Worker verifies it and passes `email`.
//   EDITOR_EMAILS                    comma-separated emails allowed to edit (needs Access). Others view only.
//   EDIT_PASSWORD                    team password required for every change (sent as X-Edit-Key).

const enc = new TextEncoder();
// Compare secrets without leaking their length/prefix through timing.
const safeEqual = (a, b) => {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

/** Who is calling and what they may do, from the verified email and the environment. */
export function permissions(env, email, editKey) {
  const editors = String(env.EDITOR_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const byEmail = editors.length ? !!email && editors.includes(email.toLowerCase()) : true;
  const needsKey = !!env.EDIT_PASSWORD;
  const keyOk = !needsKey || (!!editKey && safeEqual(editKey, env.EDIT_PASSWORD));
  return { email: email || null, canWrite: byEmail, needsKey, keyOk };
}

const ok = (json = { ok: true }) => ({ status: 200, json });
const fail = (status, error) => ({ status, json: { error } });

/**
 * @param db    createDb(...) instance
 * @param req   { method, path, body, perm } — perm from permissions()
 * @returns     { status, json } — or { status, bytes, contentType } for a photo
 */
export async function handleApi(db, { method, path, body, perm }) {
  const m = path.match(/^\/api\/(jobs|plants|photos)\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[2]) : null;
  const isWrite = method !== 'GET' && method !== 'HEAD';

  try {
    if (method === 'GET' && path === '/api/health') { await db.ping(); return ok(); }
    if (method === 'GET' && path === '/api/me') return ok({ email: perm.email, canWrite: perm.canWrite, needsKey: perm.needsKey });
    if (method === 'GET' && path === '/api/state') return ok(await db.state());
    if (method === 'GET' && path === '/api/version') return ok(await db.version());
    if (method === 'GET' && m?.[1] === 'photos') {
      const ph = await db.photo(id);
      return ph ? { status: 200, ...ph } : fail(404, 'not_found');
    }

    if (isWrite) {
      if (!perm.canWrite) return fail(403, 'read_only');
      if (method === 'POST' && path === '/api/check-key') return perm.keyOk ? ok() : fail(401, 'wrong_key');
      if (!perm.keyOk) return fail(401, 'wrong_key');
      const by = perm.email || null;
      if (method === 'PUT' && m?.[1] === 'jobs') { await db.saveJob(id, body, by); return ok(); }
      if (method === 'DELETE' && m?.[1] === 'jobs') { await db.deleteJob(id, by); return ok(); }
      if (method === 'PUT' && m?.[1] === 'plants') { await db.saveImpact(id, body?.impact, by); return ok(); }
      if (method === 'POST' && path === '/api/import') { await db.importData(body, by); return ok(); }
    }
    return fail(404, 'not_found');
  } catch (e) {
    if (e.status && e.expose) return fail(e.status, e.message);
    console.error(e);
    return { status: 500, json: { error: 'server_error', detail: String(e?.message || e).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 160) } };
  }
}
