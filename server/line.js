// LINE Messaging API: daily CMMS summary to the dashboard owner, upload reminders and replies to "สรุป".
// Settings (Cloudflare → Variables and Secrets):
//   LINE_CHANNEL_ACCESS_TOKEN (secret)  long-lived channel access token
//   LINE_CHANNEL_SECRET (secret)        verifies webhook calls (only needed for replies to chat commands)
//   LINE_TO (secret)                    user ID(s) that receive pushes, comma-separated (U…)
//   PUBLIC_URL (variable, optional)     link added to messages
// Push messages count toward the LINE OA monthly quota; replies to a user's message do not.
import { TEAMS, statTotals } from '../src/lib/cmms.js';
import { PLANT_IDS } from '../src/lib/data.js';
import { TH_M, pd } from '../src/lib/dates.js';

const API = (env) => env.LINE_API_BASE || 'https://api.line.me';
const MAX_TEXT = 4900; // LINE text messages are limited to 5,000 characters

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
  for (const to of recipients(env)) await call(env, '/v2/bot/message/push', { to, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] });
}

export const lineReply = (env, replyToken, text) =>
  call(env, '/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] });

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
const shortDate = (day) => { const d = pd(day); return `${d.getDate()} ${TH_M[d.getMonth()]}`; };
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Summary of the latest day in `days` (oldest → newest stats docs) for all plants. */
export function summaryText({ days, backlog, url }) {
  const cur = days.at(-1);
  if (!cur) return `ยังไม่มีรายงาน — อัปโหลดไฟล์ CMMS ในโหมดแก้ไขก่อน${url ? `\n🔗 ${url}` : ''}`;
  const prev = days.length > 1 ? days.at(-2) : null;
  const t = statTotals(cur, PLANT_IDS);
  const p = prev ? statTotals(prev, PLANT_IDS) : null;
  const teams = TEAMS.map((tm) => [tm.label, statTotals(cur, PLANT_IDS, tm.k).open]).filter(([, n]) => n > 0);
  const byWo = new Map((backlog?.rows || []).map((r) => [String(r.wo), r]));
  const fresh = [...(cur.new || [])].sort((a, b) => (b[4] || 0) - (a[4] || 0)).slice(0, 8)
    .map(([wo, plant, team, , mid]) => `${mid === 1 ? '⚡' : '•'} ${wo} PP${plant} ${team} – ${String(byWo.get(String(wo))?.desc || '').slice(0, 45)}`);
  const missingSet = new Set((cur.assumed || []).map((x) => String(x[0])));
  const closedByStatus = (cur.closed || []).filter((x) => !missingSet.has(String(x[0])));
  const round = cur.rounds?.at(-1)?.at;
  return [
    `📋 รายงาน WO P1 · ${thaiDate(cur.date)}${round ? ` · รอบ ${hm(round)} น.` : ''}`,
    `เปิดงาน ${t.new}${t.inserted ? ` (⚡แทรก ${t.inserted})` : ''} · เริ่มงาน ${t.started} · เสร็จรอปิด ${t.finished} · CLOSED ${t.closed}${t.assumed ? ` (Status ${t.closedStatus} + ไม่พบในไฟล์ ${t.assumed})` : ''} (สะสมทั้งวัน)`,
    `คงค้าง ${t.open} WO${p ? ` (${signed(t.open - p.open)} จาก ${shortDate(prev.date)})` : ''} · เกิน 30 วัน ${t.a90 + t.aMore}`,
    teams.map(([l, n]) => `${l} ${n}`).join(' · '),
    ...(closedByStatus.length ? ['', `✅ CLOSED (Status) ${closedByStatus.length} WO`, ...closedByStatus.slice(0, 8).map(([wo, plant, team]) => `• ${wo} PP${plant} ${team} – ${String(byWo.get(String(wo))?.desc || '').slice(0, 45)}`), ...(closedByStatus.length > 8 ? [`…และอีก ${closedByStatus.length - 8} รายการ`] : [])] : []),
    ...(fresh.length ? ['', `🆕 WO เข้าใหม่ ${t.new} รายการ${t.inserted ? ` (⚡ แทรกระหว่างวัน ${t.inserted})` : ''}`, ...fresh, ...(t.new > fresh.length ? [`…และอีก ${t.new - fresh.length} รายการ`] : [])] : []),
    ...((cur.assumed || []).length ? ['', `✅ CLOSED (ไม่พบในไฟล์ล่าสุด) ${cur.assumed.length} WO`,
      ...cur.assumed.slice(0, 8).map(([wo, plant, team]) => `• ${wo} PP${plant} ${team} – ${String(byWo.get(String(wo))?.desc || '').slice(0, 45)}`),
      ...(cur.assumed.length > 8 ? [`…และอีก ${cur.assumed.length - 8} รายการ`] : [])] : []),
    ...(url ? ['', `🔗 ${url}`] : []),
  ].join('\n');
}

const HELP = 'พิมพ์ "สรุป" เพื่อดูรายงาน WO P1 ล่าสุด · พิมพ์ "id" เพื่อดูรหัสผู้ใช้ LINE ของคุณ (ใช้ตั้งค่า LINE_TO)';

/** Handle a webhook body (already signature-checked): reply to "สรุป" / "id" / anything else. */
export async function handleWebhook(env, db, body, url) {
  for (const ev of body?.events || []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) continue;
    const text = String(ev.message.text || '').trim();
    let reply = HELP;
    if (/^(สรุป|รายงาน|summary|report)$/i.test(text)) reply = summaryText({ days: await db.stats(2), backlog: await db.backlog(), url });
    else if (/^(id|ไอดี)$/i.test(text)) reply = `รหัสผู้ใช้ LINE ของคุณ: ${ev.source?.userId || '(ไม่พบ)'}`;
    await lineReply(env, ev.replyToken, reply);
  }
}

/**
 * Cron: remind when the round's upload is missing — morning run checks for an upload since 06:00,
 * afternoon run since 13:00 (Thai time). Returns 'sent' | 'skipped'.
 */
export async function remindIfNoUpload(env, db, scheduledTime, url) {
  const { h } = thaiParts(scheduledTime);
  const morning = h < 12;
  const dayStartUtc = Math.floor((scheduledTime + 7 * 3600e3) / 864e5) * 864e5 - 7 * 3600e3;
  const since = dayStartUtc + (morning ? 6 : 13) * 3600e3;
  const last = (await db.backlog())?.uploadedAt;
  if (last && Date.parse(last) >= since) return 'skipped';
  await linePush(env, [
    `⏰ ยังไม่ได้อัปโหลดไฟล์ CMMS รอบ${morning ? 'เช้า (09:30)' : 'บ่าย (16:00)'} วันนี้`,
    `อัปโหลดล่าสุด: ${last ? `${thaiDate(new Date(Date.parse(last) + 7 * 3600e3).toISOString().slice(0, 10))} ${hm(last)} น.` : 'ยังไม่เคย'}`,
    'รายงานประจำวันจะอัปเดตหลังอัปโหลด (โหมดแก้ไข → อัปโหลด WO Backlog)',
    ...(url ? [`🔗 ${url}`] : []),
  ].join('\n'));
  return 'sent';
}
