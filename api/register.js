// POST /api/register – after the WhatsApp code proved his mobile, a person who is not in FALCON yet registers: an employee (his
// RCL ID is checked in HR by THIS server – the browser cannot say "found") or a guest. The database decides the state.
import { handler, body, bearer, Fail } from './_lib/http.js';
import { companyCode } from './_lib/env.js';
import { caller, rpc } from './_lib/supa.js';
import { hrLookup } from './_lib/hr.js';

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const uuid = (v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default handler(['POST'], async (req) => {
  const user = await caller(bearer(req));
  if (!user.phone) throw new Fail(403, 'Verify your mobile with the WhatsApp code first.', 'phone');
  const b = body(req);
  const kind = b.kind === 'guest' ? 'guest' : 'employee';
  const name = text(b.full_name, 120);
  if (!name || name.length < 2) throw new Fail(400, 'Write your full name.', 'name');
  const rcl = text(b.rcl_id, 20) && text(b.rcl_id, 20).toUpperCase();
  if (rcl && !/^[A-Z0-9-]{2,20}$/.test(rcl)) throw new Fail(400, 'The RCL ID has letters, numbers and "-" only.', 'rcl');
  const hr = kind === 'employee' && rcl ? await hrLookup(rcl, '+' + String(user.phone).replace(/^\+/, '')) : { result: 'not_checked' };
  return rpc('server_register', {
    p_auth_user: user.id, p_company_code: companyCode(), p_kind: kind, p_full_name: name, p_site: uuid(b.site), p_section: uuid(b.section),
    p_rcl_id: rcl, p_hr: hr, p_category: ['staff', 'operator', 'driver', 'labour'].includes(b.category) ? b.category : null,
    p_work_role: text(b.work_role, 80), p_works_with: text(b.works_with, 120), p_photo: text(b.photo, 200),
    p_organisation: text(b.organisation, 120), p_designation: text(b.designation, 80) });
});
