// POST /api/device {device_hash} – a phone he used before only SUGGESTS who he is; the answer says whether a new WhatsApp code is
// needed (a new phone, or 30 days since the last code). "Just signed in with a code" is decided here from Supabase's own record.
import { handler, body, bearer, Fail } from './_lib/http.js';
import { caller, rpc } from './_lib/supa.js';

export default handler(['POST'], async (req) => {
  const user = await caller(bearer(req));
  const hash = String(body(req).device_hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Fail(400, 'Bad phone fingerprint.', 'device');
  const justCoded = Boolean(user.phone) && Date.now() - Date.parse(user.last_sign_in_at || 0) < 10 * 60 * 1000;
  return rpc('server_device', { p_auth_user: user.id, p_device_hash: hash, p_code_now: justCoded });
});
