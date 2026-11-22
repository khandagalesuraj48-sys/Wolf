// POST /api/portal-signin {ticket} – a verified company employee comes from LION with his ONE sign-in (decision of 23-11-2026).
// The Portal's ticket is checked (signature, "falcon", expiry, used once); he is found or made in FALCON; the answer is a one-time
// token the browser turns into its own session. The Portal's user ID is kept as it is; Supabase knows him by a made-up address
// that receives no mail.
import crypto from 'node:crypto';
import { handler, body, Fail } from './_lib/http.js';
import { env, companyCode } from './_lib/env.js';
import { verifyTicket } from './_lib/ticket.js';
import { service, rpc } from './_lib/supa.js';

export default handler(['POST'], async (req) => {
  const portal = env('PORTAL_URL').replace(/\/+$/, '');
  if (!portal) throw new Fail(503, 'The LION sign-in is not connected yet (PORTAL_URL in Vercel).', 'settings');
  const claims = await verifyTicket(body(req).ticket, { portalUrl: portal });
  const fresh = await rpc('server_use_ticket', { p_jti: String(claims.jti), p_exp: new Date(claims.exp * 1000).toISOString() });
  if (fresh !== true) throw new Fail(401, 'This sign-in link was used already – open FALCON from the Portal again.', 'ticket');

  const user = String(claims.sub).trim().toLowerCase();
  const email = 'portal-' + crypto.createHash('sha256').update(user).digest('hex').slice(0, 24) + '@falcon.invalid';
  const sb = service();
  const made = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { portal_user: user } });
  if (made.error && !/already|registered|exists/i.test(made.error.message || '')) throw new Fail(502, 'The sign-in could not be made.', 'auth');
  const link = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.data && link.data.properties && link.data.properties.hashed_token;
  const authId = (made.data && made.data.user && made.data.user.id) || (link.data && link.data.user && link.data.user.id);
  if (link.error || !hashed || !authId) throw new Fail(502, 'The sign-in could not be made.', 'auth');

  await rpc('server_portal_person', { p_company_code: companyCode(), p_portal_user: user, p_name: String(claims.name || ''),
    p_auth_user: authId, p_mobile: null, p_site_code: claims.site ? String(claims.site) : null, p_is_super: claims.super === true });
  return { ok: true, token_hash: hashed, type: 'magiclink' };
});
