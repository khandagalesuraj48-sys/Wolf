// GET /api/daily – once a day (Vercel's timer, vercel.json → crons): temporary access ending, papers ending, days not closed,
// complaints not answered. Only Vercel's timer may call it (CRON_SECRET).
import { handler, Fail } from './_lib/http.js';
import { env } from './_lib/env.js';
import { rpc } from './_lib/supa.js';

export default handler(['GET'], async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || String(req.headers.authorization || '') !== 'Bearer ' + secret) throw new Fail(401, 'Not the timer.', 'cron');
  const n = await rpc('daily_alerts', {});
  return { ok: true, alerts: n };
});
