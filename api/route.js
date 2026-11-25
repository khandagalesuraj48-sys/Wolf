// POST /api/route {from: {lat, lng}, to: {lat, lng}} → {metres, seconds} – the distance BY ROAD (api/_lib/road.js). Only for a person
// signed in to FALCON; at most 60 a person in 10 minutes (this server's memory). {road: null} – Google found no road.
import { handler, body, bearer, Fail } from './_lib/http.js';
import { caller } from './_lib/supa.js';
import { env } from './_lib/env.js';
import { point, road } from './_lib/road.js';

const asked = new Map(); // person → [times]
export function tooMany(who, now = Date.now()) {
  const t = (asked.get(who) || []).filter((x) => now - x < 10 * 60 * 1000);
  t.push(now);
  asked.set(who, t);
  if (asked.size > 5000) asked.clear();
  return t.length > 60;
}

export default handler(['POST'], async (req) => {
  const user = await caller(bearer(req));
  const b = body(req), from = point(b.from), to = point(b.to);
  if (!from || !to) throw new Fail(400, 'Two places are needed.', 'place');
  if (tooMany(user.id)) throw new Fail(429, 'Too many questions of the road – the straight line is shown for a while.', 'many');
  const v = await road(from, to, env('GOOGLE_ROUTES_KEY'));
  return { road: v };
});
