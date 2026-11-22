// Supabase Auth's hooks are signed the "Standard Webhooks" way: HMAC-SHA256 of "<id>.<timestamp>.<body>" with the hook's secret
// (set in Supabase as "v1,whsec_<base64>" – the same value goes to Vercel as SEND_SMS_HOOK_SECRET). Five minutes' tolerance.
import crypto from 'node:crypto';

export function verifyHook(secret, headers, payload, now = Date.now()) {
  const raw = String(secret || '').replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!raw) return false;
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigs = String(headers['webhook-signature'] || '');
  if (!id || !ts || !sigs) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update(id + '.' + ts + '.' + payload).digest('base64');
  return sigs.split(' ').some((s) => {
    const v = s.split(',')[1] || '';
    return v.length === want.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(want));
  });
}
