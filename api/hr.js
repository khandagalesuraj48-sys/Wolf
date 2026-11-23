// Opened from HR (his decision of 23-11-2026: "falcon … hr madhe jodaych"; pictures N6–N8 approved):
//   POST /api/hr {pass, device_hash}     – the employee who tapped "Mess" in RCL's HR / ERP app: HR's pass checked (signed by HR,
//                                          2 minutes, once); he is found or made in FALCON as HR says; this phone is taken as
//                                          proven (no WhatsApp code again); the answer is his session.
//   POST /api/hr {card: {site}}          – for HR's server only (Authorization: the word FALCON and HR share): the site's messes,
//                                          where they are, the meal on now by the server's clock and today's dishes – the HR app's
//                                          "Mess" card. Nothing of a person.
import crypto from 'node:crypto';
import { handler, body, Fail } from './_lib/http.js';
import { env, companyCode } from './_lib/env.js';
import { service, publicClient, rpc } from './_lib/supa.js';
import { readPass, hrEmail, istNow, mealNow } from './_lib/hrpass.js';

const secret = () => env('HR_FALCON_SECRET');

function sameWord(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length >= 24 && crypto.timingSafeEqual(x, y);
}

async function card(req, site) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m || !sameWord(m[1].trim(), secret())) throw new Fail(401, 'Only RCL\'s HR server asks this.', 'secret');
  const code = String(site || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,16}$/.test(code)) throw new Fail(400, 'Which site?', 'site');
  const sb = service(), { day, hm } = istNow();
  const co = await sb.from('companies').select('id').eq('code', companyCode()).maybeSingle();
  if (co.error || !co.data) throw new Fail(503, 'FALCON has no company ' + companyCode() + ' yet.', 'settings');
  const s = await sb.from('sites').select('id,code,name').eq('company_id', co.data.id).eq('code', code).maybeSingle();
  if (!s.data) return { ok: true, now: new Date().toISOString(), site: code, messes: [] };
  // (23-11-2026) only the messes in use today (From / Till); a removed meal-time version is out
  const ms0 = await sb.from('messes').select('id,name,lat,lng,radius_m,valid_from,valid_to').eq('site_id', s.data.id).eq('active', true).order('name');
  const ms = { data: (ms0.data || []).filter((x) => (!x.valid_from || x.valid_from <= day) && (!x.valid_to || x.valid_to >= day)) };
  const ids = ms.data.map((x) => x.id);
  const [wins, menus] = ids.length ? await Promise.all([
    sb.from('meal_windows').select('mess_id,meal,serve_from,serve_to,order_by').in('mess_id', ids).is('removed_at', null).lte('valid_from', day).or('valid_to.is.null,valid_to.gte.' + day),
    sb.from('menus').select('mess_id,meal,dishes').in('mess_id', ids).eq('service_date', day),
  ]) : [{ data: [] }, { data: [] }];
  return {
    ok: true, now: new Date().toISOString(), site: code,
    messes: (ms.data || []).map((x) => {
      const meal = mealNow((wins.data || []).filter((w) => w.mess_id === x.id), hm);
      const dishes = meal ? (((menus.data || []).find((d) => d.mess_id === x.id && d.meal === meal.meal) || {}).dishes || []).slice(0, 3) : [];
      return { name: x.name, lat: x.lat == null ? null : Number(x.lat), lng: x.lng == null ? null : Number(x.lng), radius_m: x.radius_m, meal, dishes };
    }),
  };
}

async function signIn(b) {
  const p = readPass(b.pass, secret());
  const fresh = await rpc('server_use_ticket', { p_jti: 'hr-' + p.jti, p_exp: new Date(p.exp * 1000).toISOString() });
  if (fresh !== true) throw new Fail(401, 'This pass was used already – open Mess from the HR app again.', 'pass');
  const company = companyCode();
  const acc = await rpc('server_hr_pass_account', { p_company_code: company, p_rcl_id: p.code, p_mobile: p.mobile });
  const sb = service(), email = hrEmail(company, p.code);
  let authId = acc.auth_user, useEmail = acc.email;
  if (!authId) {
    const made = await sb.auth.admin.createUser({ phone: p.mobile, phone_confirm: true, email, email_confirm: true, user_metadata: { hr_rcl_id: p.code } });
    if (made.error || !made.data || !made.data.user) throw new Fail(502, 'Your FALCON sign-in could not be made – try again.', 'auth');
    authId = made.data.user.id; useEmail = email;
  } else if (!useEmail) {
    const up = await sb.auth.admin.updateUserById(authId, { email, email_confirm: true });
    if (up.error) throw new Fail(502, 'Your FALCON sign-in could not be made – try again.', 'auth');
    useEmail = email;
  }
  const who = await rpc('server_hr_pass_person', { p_company_code: company, p_auth_user: authId, p_rcl_id: p.code, p_name: p.name,
    p_mobile: p.mobile, p_site_code: p.site || null, p_designation: p.designation || null });
  // HR proved him just now: this phone needs no WhatsApp code (as right after one)
  const hash = String(b.device_hash || '');
  if (/^[0-9a-f]{64}$/.test(hash)) await rpc('server_device', { p_auth_user: authId, p_device_hash: hash, p_code_now: true });
  const link = await sb.auth.admin.generateLink({ type: 'magiclink', email: useEmail });
  const hashed = link.data && link.data.properties && link.data.properties.hashed_token;
  if (link.error || !hashed) throw new Fail(502, 'Your FALCON sign-in could not be made – try again.', 'auth');
  const { data, error } = await publicClient().auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
  if (error || !data || !data.session) throw new Fail(502, 'Your FALCON sign-in could not be made – try again.', 'auth');
  return { ok: true, company, person: who.person,
    hr: { code: p.code, name: p.name, site: p.site, in: p.day === istNow().day ? p.in : null, day: istNow().day },
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } };
}

export default handler(['POST'], async (req) => {
  const b = body(req);
  if (b.card) return card(req, b.card.site);
  if (b.pass) return signIn(b);
  throw new Fail(400, 'Nothing was asked.', 'ask');
});
