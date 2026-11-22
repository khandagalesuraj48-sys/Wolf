// The first screen's code (his decision of 23-11-2026: "company code takaych … ani tyache adhi mhanje app olkhel user kuthun aala"):
// a company's code (RCL) or a contractor's own sign-in code – the database says which (server_door); no list is ever shown.
// And the limits: how often one place looks up codes, how often one mobile gets a sign-in code (only fingerprints are kept).
import { companyCode } from './env.js';
import { rpc } from './supa.js';
import { Fail } from './http.js';

export const LIMITS = {
  door: [{ n: 30, secs: 600 }],                                             // codes of the first screen, from one place
  lookup: [{ n: 60, secs: 600 }, { n: 300, secs: 86400 }],                  // employee codes / contractor mobiles, from one place
  otp: [{ n: 1, secs: 60 }, { n: 5, secs: 3600 }, { n: 10, secs: 86400 }],  // sign-in codes to one mobile
};

const MISSING = new Set(['PGRST202', '42883']);                              // the database's update of 23-11-2026 not run yet
const notReady = () => new Fail(503, 'FALCON\'s database needs its update of 23-11-2026 first.', 'update');

export async function doorOf(code, rpcImpl = rpc) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(c)) return null;
  try {
    return (await rpcImpl('server_door', { p_code: c })) || null;
  } catch (e) {
    if (MISSING.has(e && e.code)) throw notReady();
    throw e;
  }
}

// The company a step is for: the company of the code it names; no code named (an app of before) → this FALCON's own company.
export async function companyFor(code, rpcImpl = rpc) {
  if (!code) return companyCode();
  const d = await doorOf(code, rpcImpl);
  if (!d) throw new Fail(404, 'No company or contractor has this code.', 'door');
  return d.company;
}

// Where the call comes from (Vercel's own header first). Only its fingerprint is kept.
export function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
}

const waitWords = (s) => (s < 120 ? s + ' seconds' : Math.ceil(s / 60) + ' minutes');

// Counts one try; too many → 429 with the time to wait. strict = false: a database without the update lets it pass (the sign-in
// code still has Supabase's own limits) – the limit must never stop everybody's sign-in.
export async function limit(what, key, rpcImpl = rpc, strict = true) {
  let r;
  try {
    r = await rpcImpl('server_hit', { p_what: what, p_key: String(key), p_limits: LIMITS[what] });
  } catch (e) {
    if (!strict) return { ok: true, unchecked: true };
    if (MISSING.has(e && e.code)) throw notReady();
    throw e;
  }
  if (!r || r.ok !== true) {
    const w = Math.max(1, Number(r && r.wait) || 60);
    throw new Fail(429, (what === 'otp' ? 'Too many codes for this mobile' : 'Too many tries') + ' – try again in ' + waitWords(w) + '.', 'limit');
  }
  return r;
}
