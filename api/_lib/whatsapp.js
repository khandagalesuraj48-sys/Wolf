// The sign-in code by WhatsApp: Meta's Cloud API with the approved Authentication template (the same number and template as the
// Portal's – decision 3 of docs/DECISIONS.md). The code is never written in a log; Meta's answer is logged without it.
import { env } from './env.js';

export const waMissing = () => ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((n) => !env(n));

export function toNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return '91' + d;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  return '';
}

export function codePayload(phone, code) {
  const name = env('WHATSAPP_OTP_TEMPLATE') || 'otp', lang = env('WHATSAPP_OTP_LANG') || 'en', c = String(code);
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: toNumber(phone), type: 'template',
    template: { name, language: { code: lang }, components: [
      { type: 'body', parameters: [{ type: 'text', text: c }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: c }] }] } };
}

export async function sendCode(phone, code, fetchImpl = fetch) {
  if (waMissing().length) return { ok: false, why: waMissing().join(', ') + ' missing in Vercel' };
  if (!toNumber(phone)) return { ok: false, why: 'not an Indian mobile number' };
  if (!/^\d{4,8}$/.test(String(code))) return { ok: false, why: 'bad code' };
  const url = (env('WHATSAPP_API_BASE') || 'https://graph.facebook.com').replace(/\/+$/, '') + '/' + (env('WHATSAPP_API_VERSION') || 'v27.0') +
    '/' + env('WHATSAPP_PHONE_NUMBER_ID') + '/messages';
  let r, j = {};
  try {
    r = await fetchImpl(url, { method: 'POST', headers: { Authorization: 'Bearer ' + env('WHATSAPP_TOKEN'), 'Content-Type': 'application/json' },
      body: JSON.stringify(codePayload(phone, code)), signal: AbortSignal.timeout(10000) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    console.error('[falcon wa] no answer: ' + String((e && e.name) || 'error'));
    return { ok: false, why: 'WhatsApp did not answer' };
  }
  if (!r.ok) {
    const er = (j && j.error) || {};
    console.error('[falcon wa] ' + r.status + ' ' + (er.code || '') + ' ' + String(er.message || '').slice(0, 160));
    return { ok: false, why: 'WhatsApp refused (' + r.status + ')' };
  }
  return { ok: true };
}
