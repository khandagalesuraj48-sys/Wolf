// The RCL-employee start (boards r02 → r03 → r04), before he is signed in:
//   POST /api/start {rcl_id}        → HR's answer to recognise himself ("Is this you?"), HR's mobile masked, and a 10-minute token
//   POST /api/start {token, send}   → the WhatsApp code goes to HR's mobile (Supabase's own sign-in code, through the hook)
//   POST /api/start {token, code}   → the code checked; the answer is his session
// HR's full mobile never reaches the browser. HR not connected → "not_checked" (he registers as new; the Site Admin checks).
import { handler, body, Fail } from './_lib/http.js';
import { publicClient, rpc } from './_lib/supa.js';
import { hrLookup } from './_lib/hr.js';

const mask = (m) => m.slice(0, 3) + ' ' + m.slice(3, 5) + 'XXX XX' + m.slice(-3);

export default handler(['POST'], async (req) => {
  const b = body(req);
  if (b.token) {
    const t = await rpc('server_start_resolve', { p_token: String(b.token) });
    if (!t) throw new Fail(410, 'This step has expired – start again with your RCL ID.', 'expired');
    if (b.send) {
      const { error } = await publicClient().auth.signInWithOtp({ phone: t.phone, options: { shouldCreateUser: true } });
      if (error) throw new Fail(error.status === 429 ? 429 : 502, error.status === 429 ? 'Wait a minute before asking a new code.' : 'The code could not be sent – try again.', 'send');
      return { ok: true, sent_to: mask(t.phone) };
    }
    if (!/^\d{6}$/.test(String(b.code || ''))) throw new Fail(400, 'Type the 6 digits.', 'code');
    const { data, error } = await publicClient().auth.verifyOtp({ phone: t.phone, token: String(b.code), type: 'sms' });
    if (error || !data.session) throw new Fail(401, 'This code is not right or has expired.', 'code');
    return { ok: true, rcl_id: t.rcl_id, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } };
  }
  const rcl = String(b.rcl_id || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(rcl)) throw new Fail(400, 'The RCL ID has letters, numbers and "-" only.', 'rcl');
  const hr = await hrLookup(rcl, null);
  if (hr.result !== 'found' || !hr.mobile) return { result: hr.result === 'found' ? 'no_mobile' : hr.result };
  const token = await rpc('server_start_token', { p_phone: hr.mobile, p_rcl: rcl, p_hr: hr });
  return { result: 'found', token, rcl_id: rcl, name: hr.name, designation: hr.designation, department: hr.department, category: hr.category,
    site: hr.site, mobile_masked: mask(hr.mobile) };
});
