// The LION Portal's ticket (decision of 23-11-2026): trusted only after its ES256 signature is checked with the Portal's
// /api/jwks, its "aud" is "falcon", it has not expired, and its "jti" was never used (the database keeps used ones).
import crypto from 'node:crypto';
import { Fail } from './http.js';

let cache = { at: 0, url: '', keys: [] };

export async function portalKeys(portalUrl, fetchImpl = fetch) {
  if (cache.url === portalUrl && Date.now() - cache.at < 5 * 60 * 1000) return cache.keys;
  const r = await fetchImpl(portalUrl + '/api/jwks', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Fail(502, 'The Portal did not give its key.', 'jwks');
  const j = await r.json();
  cache = { at: Date.now(), url: portalUrl, keys: Array.isArray(j.keys) ? j.keys : [] };
  return cache.keys;
}

const part = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; } };

export async function verifyTicket(token, { portalUrl, audience = 'falcon', now = Date.now(), fetchImpl } = {}) {
  const bits = String(token || '').split('.');
  if (bits.length !== 3) throw new Fail(401, 'This sign-in link is not valid.', 'ticket');
  const head = part(bits[0]), claims = part(bits[1]);
  if (!head || !claims || head.alg !== 'ES256') throw new Fail(401, 'This sign-in link is not valid.', 'ticket');
  const keys = await portalKeys(portalUrl, fetchImpl);
  const jwk = keys.find((k) => k.kid === head.kid) || (keys.length === 1 && !head.kid ? keys[0] : null);
  if (!jwk) throw new Fail(401, 'This sign-in link is not from the Portal.', 'ticket');
  const ok = crypto.verify('sha256', Buffer.from(bits[0] + '.' + bits[1]), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
    Buffer.from(bits[2], 'base64url'));
  if (!ok) throw new Fail(401, 'This sign-in link is not from the Portal.', 'ticket');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(audience)) throw new Fail(401, 'This sign-in link is not for FALCON.', 'ticket');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) throw new Fail(401, 'This sign-in link has expired – open FALCON from the Portal again.', 'ticket');
  if (!claims.sub || !claims.jti) throw new Fail(401, 'This sign-in link is not valid.', 'ticket');
  if (claims.iss && portalUrl && String(claims.iss).replace(/\/+$/, '') !== portalUrl) throw new Fail(401, 'This sign-in link is not from this Portal.', 'ticket');
  return claims;
}
