// HR's list into FALCON (his decision of 23-11-2026). GET – Vercel's timer, every hour (CRON_SECRET); POST – the System Admin's
// "Bring from HR now" on the web. HR's whole list is read and given to the database in one step (server_hr_sync): new sites made,
// who left stopped, names kept as in HR. A run that could not reach HR is written too, with why.
import { handler, bearer, Fail } from './_lib/http.js';
import { env, companyCode } from './_lib/env.js';
import { asCaller, rpc } from './_lib/supa.js';
import { hrList } from './_lib/hr.js';

export default handler(['GET', 'POST'], async (req) => {
  let how;
  if (req.method === 'GET') {
    const secret = env('CRON_SECRET');
    if (!secret || String(req.headers.authorization || '') !== 'Bearer ' + secret) throw new Fail(401, 'Not the timer.', 'cron');
    how = 'timer';
  } else {
    const ok = await asCaller(bearer(req)).rpc('has_role', { roles: ['system_admin'] });
    if (ok.error || ok.data !== true) throw new Fail(403, 'Only the System Admin brings HR\'s list.', 'role');
    how = 'office';
  }
  let list;
  try {
    list = await hrList();
  } catch (e) {
    await rpc('server_hr_failed', { p_company_code: companyCode(), p_how: how, p_message: String(e.message || e) }).catch(() => {});
    throw e;
  }
  const r = await rpc('server_hr_sync', { p_company_code: companyCode(), p_rows: list, p_how: how });
  return { ok: true, ...r };
});
