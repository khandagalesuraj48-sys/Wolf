// POST /api/welcome – right after a WhatsApp code: who is this? A person already in FALCON; a FALCON person with this mobile (made
// by the office); an ACTIVE HR employee with this mobile (made at once – his RCL ID, name, site – no form, no Site Admin check);
// and the first System Admin: the mobile set by him in Vercel (FALCON_FIRST_ADMIN), only while the company has none.
// { person: null } = nobody knows this mobile yet – he registers as before.
import { handler, bearer, body } from './_lib/http.js';
import { companyFor } from './_lib/door.js';
import { env, companyCode } from './_lib/env.js';
import { caller, rpc } from './_lib/supa.js';

// "98xxxxxxxx", "+91 98…", "9198…" → "+9198…" (India); anything else is not taken
export function firstAdmin(v = env('FALCON_FIRST_ADMIN')) {
  const d = String(v || '').replace(/\D/g, '');
  const ten = d.length >= 10 ? d.slice(-10) : '';
  return /^[6-9][0-9]{9}$/.test(ten) && (d.length === 10 || d === '91' + ten || d === '091' + ten || d === '0' + ten) ? '+91' + ten : null;
}

// (23-11-2026) {company}: the code of the first screen (a company's, or a contractor's – its company); none = this FALCON's own.
// FALCON_FIRST_ADMIN is for this FALCON's own company only.
export default handler(['POST'], async (req) => {
  const user = await caller(bearer(req));
  const company = await companyFor(body(req).company);
  return rpc('server_welcome', { p_auth_user: user.id, p_company_code: company, p_first_admin: company === companyCode() ? firstAdmin() : null });
});
