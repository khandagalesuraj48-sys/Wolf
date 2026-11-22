// HR's employees (his decision of 23-11-2026: every RCL employee of every site, new sites and new joiners by themselves).
//   * hrList(): HR's whole list, page by page, from HR's server (rcl-hr api/falcon-employees) with HR_FALCON_SECRET – only RCL ID,
//     name, designation, category, site, mobile, status, left; never birth date, e-mail, KYC, bank, pay, photo or face.
//   * hrLookup(): an RCL ID in FALCON's kept copy (the database's server_hr_find). Nothing copied yet → "not_checked": the person
//     waits for the Site Admin – nothing is made up. HR's mobile stays on the server (the code is sent to it).
import { env, companyCode } from './env.js';
import { rpc } from './supa.js';
import { Fail } from './http.js';

export const hrMissing = () => ['HR_EMPLOYEES_URL', 'HR_FALCON_SECRET'].filter((n) => !env(n));

export async function hrList(fetchImpl = fetch) {
  const url = env('HR_EMPLOYEES_URL'), secret = env('HR_FALCON_SECRET');
  if (!url || !secret) throw new Fail(503, hrMissing().join(', ') + ' missing in Vercel – FALCON is not connected to HR yet.', 'settings');
  const all = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {                       // 50 pages of 1000 – far more than RCL's people
    let r;
    try {
      r = await fetchImpl(url, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, limit: 1000 }), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new Fail(502, 'HR did not answer.', 'hr');
    }
    if (r.status === 401) throw new Fail(502, 'HR refused FALCON – HR_FALCON_SECRET here and FALCON_HR_SECRET in HR must be the same.', 'hr');
    if (!r.ok) throw new Fail(502, 'HR answered ' + r.status + '.', 'hr');
    const j = await r.json();
    if (!j || !Array.isArray(j.employees)) throw new Fail(502, 'HR gave something that is not its list.', 'hr');
    for (const e of j.employees) {
      all.push({ id: str(e.id, 64), code: str(e.code, 20), name: str(e.name, 120), designation: str(e.designation, 80), category: str(e.category, 20),
        site: str(e.site, 16), mobile: str(e.mobile, 15), status: str(e.status, 12), left: str(e.left, 10) });
    }
    if (j.next == null) return all;
    offset = Number(j.next);
    if (!Number.isFinite(offset) || offset <= 0) return all;
  }
  return all;
}

export async function hrLookup(rclId, mobile, rpcImpl = rpc, company = companyCode()) {
  if (!rclId) return { result: 'not_checked' };
  try {
    const j = await rpcImpl('server_hr_find', { p_company_code: company, p_rcl_id: String(rclId).toUpperCase(), p_mobile: mobile || null });
    const result = ['found', 'not_found', 'maybe'].includes(j && j.result) ? j.result : 'not_checked';
    if (result === 'not_checked' || result === 'not_found') return { result };
    return { result, name: str(j.name, 120), designation: str(j.designation, 80), category: str(j.category, 20), site: str(j.site, 16),
      ref: str(j.ref, 64), mobile: /^\+[0-9]{10,15}$/.test(String(j.mobile || '')) ? j.mobile : undefined, mobile_matches: j.mobile_matches === true };
  } catch {
    return { result: 'not_checked' };
  }
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
