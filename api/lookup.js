// POST /api/lookup {rcl_id} – before he registers, a person sees what HR knows of his RCL ID (name, designation) to say "this is me";
// the Site Admin uses the same to link a registration. When HR is not connected the answer says so.
import { handler, body, bearer, Fail } from './_lib/http.js';
import { caller } from './_lib/supa.js';
import { hrLookup } from './_lib/hr.js';

export default handler(['POST'], async (req) => {
  const user = await caller(bearer(req));
  const rcl = String(body(req).rcl_id || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(rcl)) throw new Fail(400, 'The RCL ID has letters, numbers and "-" only.', 'rcl');
  const r = await hrLookup(rcl, user.phone ? '+' + String(user.phone).replace(/^\+/, '') : null);
  // only what is needed to recognise oneself – never more
  return { result: r.result, name: r.result === 'found' || r.result === 'maybe' ? r.name : undefined,
    designation: r.result === 'found' ? r.designation : undefined, mobile_matches: r.result === 'found' ? r.mobile_matches : undefined };
});
