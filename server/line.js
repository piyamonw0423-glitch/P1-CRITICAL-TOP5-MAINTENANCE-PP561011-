// LINE Messaging API: daily CMMS summary to the dashboard owner, upload reminders and replies to "สรุป".
// Settings (Cloudflare → Variables and Secrets):
//   LINE_CHANNEL_ACCESS_TOKEN (secret)  long-lived channel access token
//   LINE_CHANNEL_SECRET (secret)        verifies webhook calls (only needed for replies to chat commands)
//   LINE_TO (secret)                    user ID(s) that receive pushes, comma-separated (U…)
//   PUBLIC_URL (variable, optional)     link added to messages
// Push messages count toward the LINE OA monthly quota; replies to a user's message do not.
import { reportText } from '../src/lib/analysis.js';
import { TH_M, pd } from '../src/lib/dates.js';

const API = (env) => env.LINE_API_BASE || 'https://api.line.me';
const MAX_TEXT = 4900; // LINE text messages are limited to 5,000 characters
// Long text is split at line breaks into up to 5 text bubbles of one request (LINE counts a push per recipient,
// not per bubble, so the quota is unchanged).
export function textMessages(text) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    const piece = line.slice(0, MAX_TEXT);
    if (cur && cur.length + 1 + piece.length > MAX_TEXT) { out.push(cur); cur = piece; } else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur || !out.length) out.push(cur);
  return out.slice(0, 5).map((t) => ({ type: 'text', text: t }));
}

export const lineConfigured = (env) => !!(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_TO);
const recipients = (env) => String(env.LINE_TO || '').split(',').map((s) => s.trim()).filter(Boolean);

async function call(env, path, payload) {
  const r = await fetch(`${API(env)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw Object.assign(new Error(`LINE ${r.status}: ${detail.slice(0, 160)}`), { lineStatus: r.status });
  }
}

/** Push one text to every LINE_TO recipient. */
export async function linePush(env, text) {
  if (!lineConfigured(env)) throw Object.assign(new Error('LINE is not configured'), { lineStatus: 0 });
  for (const to of recipients(env)) await call(env, '/v2/bot/message/push', { to, messages: textMessages(text) });
}

export const lineReply = (env, replyToken, text) =>
  call(env, '/v2/bot/message/reply', { replyToken, messages: textMessages(text) });

/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)). */
export async function verifyLineSignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/* ---------------- message text ---------------- */

const thaiParts = (ms) => { const d = new Date(ms + 7 * 3600e3); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; };
const hm = (iso) => { const { h, m } = thaiParts(Date.parse(iso)); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const thaiDate = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };

/** Daily summary of the latest upload vs the previous report day (reported once a day, ~16:30). */
export const summaryText = ({ days, backlog, url, jobs = null }) => {
  const today = new Date(Date.now() + 7 * 3600e3);
  return reportText({ cur: days.at(-1), prev: days.length > 1 ? days.at(-2) : null, backlog, url, jobs, today: new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) });
};

const HELP = 'พิมพ์ "สรุป" เพื่อดูรายงาน WO P1 ล่าสุด · พิมพ์ "id" เพื่อดูรหัสผู้ใช้ LINE ของคุณ (ใช้ตั้งค่า LINE_TO)';

/** Handle a webhook body (already signature-checked): reply to "สรุป" / "id" / anything else. */
export async function handleWebhook(env, db, body, url) {
  for (const ev of body?.events || []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) continue;
    const text = String(ev.message.text || '').trim();
    let reply = HELP;
    if (/^(สรุป|รายงาน|summary|report)$/i.test(text)) reply = summaryText({ days: await db.stats(2), backlog: await db.backlog(), jobs: await db.jobs(), url });
    else if (/^(id|ไอดี)$/i.test(text)) reply = `รหัสผู้ใช้ LINE ของคุณ: ${ev.source?.userId || '(ไม่พบ)'}`;
    await lineReply(env, ev.replyToken, reply);
  }
}

/**
 * Cron (16:45 Thai, Mon–Sat): remind when today's CMMS file has not been uploaded yet — the team reports once a
 * day in the evening, so any upload since 00:00 today counts. Returns 'sent' | 'skipped'.
 */
export async function remindIfNoUpload(env, db, scheduledTime, url) {
  const { h } = thaiParts(scheduledTime);
  const dayStartUtc = Math.floor((scheduledTime + 7 * 3600e3) / 864e5) * 864e5 - 7 * 3600e3;
  const since = dayStartUtc;
  const last = (await db.backlog())?.uploadedAt;
  if (last && Date.parse(last) >= since) return 'skipped';
  await linePush(env, [
    `⏰ ยังไม่ได้อัปโหลดไฟล์ CMMS ประจำวันนี้ (รอบ 16:30 น.)`,
    `อัปโหลดล่าสุด: ${last ? `${thaiDate(new Date(Date.parse(last) + 7 * 3600e3).toISOString().slice(0, 10))} ${hm(last)} น.` : 'ยังไม่เคย'}`,
    'สรุปประจำวันจะส่งเข้า LINE หลังอัปโหลด (โหมดแก้ไข -> อัปโหลด WO Backlog)',
    ...(url ? [`🔗 ${url}`] : []),
  ].join('\n'));
  return 'sent';
}
