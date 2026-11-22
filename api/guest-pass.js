// e15 · a host brings a guest without the app:
//   POST /api/guest-pass {mobile}                    → a code to the guest's WhatsApp (the host asks him for it)
//   POST /api/guest-pass {token, code, name, …}     → the code checked; the guest's one profile and today's visit with this host
import { handler, body, bearer, Fail } from './_lib/http.js';
import { caller, rpc } from './_lib/supa.js';
import { sendCode, toNumber } from './_lib/whatsapp.js';

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export default handler(['POST'], async (req) => {
  const host = await caller(bearer(req));
  const b = body(req);
  if (!b.token) {
    const n = toNumber(b.mobile);
    if (!n) throw new Fail(400, 'Type the guest\'s 10-digit mobile.', 'mobile');
    const r = await rpc('server_guest_code', { p_host_auth: host.id, p_phone: '+' + n });
    const sent = await sendCode('+' + n, r.code);
    if (!sent.ok) throw new Fail(502, 'The code could not be sent: ' + sent.why, 'send');
    return { ok: true, token: r.token };
  }
  if (!/^\d{6}$/.test(String(b.code || ''))) throw new Fail(400, 'Type the 6 digits the guest got.', 'code');
  const name = text(b.name, 120);
  if (!name || name.length < 2) throw new Fail(400, 'Write the guest\'s name.', 'name');
  const r = await rpc('server_guest_pass', { p_host_auth: host.id, p_token: String(b.token), p_code: String(b.code), p_name: name,
    p_org: text(b.organisation, 120), p_designation: text(b.designation, 80), p_purpose: text(b.purpose, 200) || 'Visit', p_site: b.site, p_section: b.section || null });
  if (r && r.ok === false) throw new Fail(400, 'This code is not right – ' + r.tries_left + ' tries left.', 'code');
  return r;
});
