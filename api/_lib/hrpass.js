// Opened from HR (his decision of 23-11-2026: "falcon la erp madhe nahi hr madhe jodaych … falcon hr madhe asel"; pictures N6–N8):
//   * readPass(): the pass RCL's HR server signed for the employee who tapped "Mess" in the HR / ERP app – checked here with the
//     word FALCON and HR share (HR_FALCON_SECRET here, FALCON_HR_SECRET in HR – the same value, set by him in Vercel). It carries
//     only his RCL ID, name, mobile, site, designation and today's first punch-in; it is good for 2 minutes and once.
//       "v1." + base64url(JSON) + "." + base64url(HMAC-SHA256(secret, "falcon-hr-pass.v1." + base64url(JSON)))
//   * mealNow(): which meal is on now, by the server's clock (his word: "day night auto select asel server time asel").
//   * hrEmail(): the made-up address a sign-in from HR needs (it receives no mail) – one per employee, never his real e-mail.
import crypto from 'node:crypto';
import { Fail } from './http.js';

export const PASS_MAX_SECONDS = 300;            // a pass is made for 2 minutes; more than 5 is never taken

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
export function signPass(claims, secret) {             // HR's side, here for the tests (rcl-hr lib/falcon.js makes the same)
  const payload = b64(JSON.stringify(claims));
  return 'v1.' + payload + '.' + crypto.createHmac('sha256', secret).update('falcon-hr-pass.v1.' + payload).digest('base64url');
}

export function readPass(pass, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 24) throw new Fail(503, 'FALCON is not connected to HR (HR_FALCON_SECRET in Vercel).', 'settings');
  const parts = String(pass || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[A-Za-z0-9_-]{20,1400}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
    throw new Fail(400, 'This is not a pass from HR – open Mess from the HR app again.', 'pass');
  }
  const want = crypto.createHmac('sha256', secret).update('falcon-hr-pass.v1.' + parts[1]).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Fail(401, 'HR did not sign this pass.', 'pass');
  let c;
  try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Fail(400, 'This pass cannot be read.', 'pass'); }
  if (!c || typeof c !== 'object') throw new Fail(400, 'This pass cannot be read.', 'pass');
  const exp = Number(c.exp);
  if (!Number.isInteger(exp) || exp < nowSec) throw new Fail(401, 'This pass has expired – open Mess from the HR app again.', 'expired');
  if (exp - nowSec > PASS_MAX_SECONDS) throw new Fail(401, 'This pass is not valid.', 'pass');
  const code = String(c.c || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw new Fail(400, 'HR has no employee code for you.', 'pass');
  const mobile = indian(c.m);
  if (!mobile) throw new Fail(400, 'HR has no mobile for you – the HR office adds it.', 'pass');
  if (!/^[0-9a-f]{32}$/.test(String(c.jti || ''))) throw new Fail(400, 'This pass is not valid.', 'pass');
  return {
    code, mobile, jti: c.jti, exp,
    name: str(c.n, 120), site: str(c.s, 16).toUpperCase(), designation: str(c.d, 80),
    in: /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(c.in || '')) ? c.in : null,
    day: /^\d{4}-\d{2}-\d{2}$/.test(String(c.day || '')) ? c.day : null,
  };
}

// "98xxxxxxxx", "+91 98…", "9198…" → "+9198…"; anything else → null
export function indian(v) {
  const d = String(v || '').replace(/\D/g, ''), t = d.slice(-10);
  return /^[6-9][0-9]{9}$/.test(t) && (d.length === 10 || d === '91' + t || d === '0' + t) ? '+91' + t : null;
}
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

export const hrEmail = (company, code) =>
  'hr-' + crypto.createHash('sha256').update(String(company).toUpperCase() + ':' + String(code).toUpperCase()).digest('hex').slice(0, 24) + '@falcon.invalid';

// The site's clock (India) as "YYYY-MM-DD" and "HH:MM".
export function istNow(ms = Date.now()) {
  const d = new Date(ms);
  return {
    day: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    hm: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
  };
}

// windows: [{meal, serve_from, serve_to, order_by}] of today. The meal on now (or the next one today); null = all over today.
export function mealNow(windows, hm) {
  const t = (x) => String(x || '').slice(0, 5);
  const w = (windows || []).slice().sort((a, b) => t(a.serve_from).localeCompare(t(b.serve_from))).find((x) => hm <= t(x.serve_to));
  if (!w) return null;
  return { meal: w.meal, from: t(w.serve_from), to: t(w.serve_to), order_by: t(w.order_by), now: hm >= t(w.serve_from), parcel_open: hm <= t(w.order_by) };
}
