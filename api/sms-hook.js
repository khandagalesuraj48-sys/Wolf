// POST /api/sms-hook – Supabase Auth's "Send SMS" hook: FALCON's own sign-in code goes by WhatsApp (never SMS), with the approved
// template. Supabase signs each call; an unsigned or wrong call is refused. The code is never logged.
import { rawBody, send } from './_lib/http.js';
import { env } from './_lib/env.js';
import { verifyHook } from './_lib/webhook.js';
import { sendCode } from './_lib/whatsapp.js';

const fail = (res, status, message) => send(res, status, { error: { http_code: status, message } });

export default async function smsHook(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const payload = await rawBody(req);
  if (!verifyHook(env('SEND_SMS_HOOK_SECRET'), req.headers, payload)) return fail(res, 401, 'Not signed by Supabase');
  let j;
  try { j = JSON.parse(payload); } catch { return fail(res, 400, 'Not JSON'); }
  const phone = j && j.user && j.user.phone, otp = j && j.sms && j.sms.otp;
  const r = await sendCode(phone, otp);
  if (!r.ok) return fail(res, 502, 'The code could not be sent by WhatsApp: ' + r.why);
  return send(res, 200, {});
}
