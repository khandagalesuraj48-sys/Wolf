// The start, before he is signed in (his decision of 23-11-2026: the company code first, then the employee code, his details, the
// WhatsApp code; a contractor's own code for the mess owner and his operators):
//   POST /api/start {door}                  → what the code is: {kind: "company" | "contractor", code, name, company, company_name}
//   POST /api/start {company, rcl_id}       → HR's answer to recognise himself ("Is this you?"), HR's mobile masked, a 10-minute token
//   POST /api/start {door, mobile}          → a contractor's code: is this mobile given for it (owner / operator)? → a 10-minute token
//   POST /api/start {token, send}           → the WhatsApp code goes to that mobile (Supabase's own sign-in code, through the hook)
//   POST /api/start {token, code}           → the code checked; the answer is his session (and the company)
// The mobile of HR never reaches the browser. Look-ups are limited per place (internet address); codes per mobile (the hook).
// {rcl_id} without a company (an app of before) = this FALCON's own company.
import { handler, body, Fail } from './_lib/http.js';
import { publicClient, rpc } from './_lib/supa.js';
import { hrLookup } from './_lib/hr.js';
import { companyCode } from './_lib/env.js';
import { doorOf, companyFor, clientIp, limit } from './_lib/door.js';

const mask = (m) => m.slice(0, 3) + ' ' + m.slice(3, 5) + 'XXX XX' + m.slice(-3);
const indian = (v) => { const d = String(v || '').replace(/\D/g, ''); const t = d.slice(-10); return /^[6-9][0-9]{9}$/.test(t) ? '+91' + t : null; };

export default handler(['POST'], async (req) => {
  const b = body(req);
  if (b.token) {
    const t = await rpc('server_start_resolve', { p_token: String(b.token) });
    if (!t) throw new Fail(410, 'This step has expired – start again.', 'expired');
    if (b.send) {
      const { error } = await publicClient().auth.signInWithOtp({ phone: t.phone, options: { shouldCreateUser: true } });
      if (error) {
        const ours = /^Too many codes/i.test(String(error.message || ''));
        throw new Fail(error.status === 429 || ours ? 429 : 502, ours ? error.message : error.status === 429 ? 'Wait a minute before asking a new code.' : 'The code could not be sent – try again.', 'send');
      }
      return { ok: true, sent_to: mask(t.phone) };
    }
    if (!/^\d{6}$/.test(String(b.code || ''))) throw new Fail(400, 'Type the 6 digits.', 'code');
    const { data, error } = await publicClient().auth.verifyOtp({ phone: t.phone, token: String(b.code), type: 'sms' });
    if (error || !data.session) throw new Fail(401, 'This code is not right or has expired.', 'code');
    return { ok: true, rcl_id: t.hr && t.hr.kind === 'contractor' ? undefined : t.rcl_id, company: (t.hr && t.hr.company) || companyCode(),
      session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } };
  }

  // a contractor's code and a mobile: only a mobile the Admin gave for it (a live Mess owner / operator role)
  if (b.door && b.mobile !== undefined) {
    await limit('lookup', clientIp(req));
    const d = await doorOf(b.door);
    if (!d || d.kind !== 'contractor') throw new Fail(404, 'No contractor has this code.', 'door');
    const phone = indian(b.mobile);
    if (!phone) throw new Fail(400, 'Type your 10-digit WhatsApp mobile.', 'mobile');
    const m = await rpc('server_contractor_mobile', { p_code: d.code, p_mobile: phone });
    if (!m) throw new Fail(404, 'This mobile is not given for ' + d.name + '. Ask ' + d.company_name + '\'s Admin to add you.', 'mobile');
    const token = await rpc('server_start_token', { p_phone: phone, p_rcl: d.code,
      p_hr: { kind: 'contractor', company: d.company, contractor: d.name, name: m.name, role: m.role } });
    return { result: 'found', token, name: m.name, role: m.role, contractor: d.name, mobile_masked: mask(phone) };
  }

  // the first screen's code
  if (b.door) {
    await limit('door', clientIp(req));
    const d = await doorOf(b.door);
    if (!d) throw new Fail(404, 'No company or contractor has this code – check it with your office.', 'door');
    return d;
  }

  // the employee code (in the company of the first screen)
  const rcl = String(b.rcl_id || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(rcl)) throw new Fail(400, 'The employee code has letters, numbers and "-" only.', 'rcl');
  await limit('lookup', clientIp(req), undefined, !!b.company);        // (an app of before: not stopped while the update is not run)
  const company = await companyFor(b.company);
  const hr = await hrLookup(rcl, null, rpc, company);
  if (hr.result !== 'found' || !hr.mobile) return { result: hr.result === 'found' ? 'no_mobile' : hr.result, company };
  const token = await rpc('server_start_token', { p_phone: hr.mobile, p_rcl: rcl, p_hr: { ...hr, kind: 'employee', company } });
  return { result: 'found', token, rcl_id: rcl, company, name: hr.name, designation: hr.designation, department: hr.department, category: hr.category,
    site: hr.site, mobile_masked: mask(hr.mobile) };
});
