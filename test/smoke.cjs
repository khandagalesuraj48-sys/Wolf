// TEST ONLY – smoke test: every route of FALCON opened in Chromium with a MOCKED database (no real Supabase is reached): each
// page must render without an uncaught error. The data is made up and minimal; it shows that the screens do not crash – not
// that the data or the rules are right (the database tests check those). Needs Playwright with Chromium on the computer:
//   VITE_SUPABASE_URL=https://smoke.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_smoke_only npx vite build --outDir dist-smoke
//   timeout 400 node test/smoke.cjs dist-smoke
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dist = path.resolve(process.argv[2] || 'dist-smoke');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  const ext = path.extname(f);
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
});

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u1', role: 'authenticated', exp: now + 86400 * 30, aud: 'authenticated' }) + '.sig';
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', phone: '910000000000', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400 * 30, expires_at: now + 86400 * 30, user };
const T = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const ID = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const person = { id: ID(1), company_id: ID(90), kind: 'employee', auth_user_id: 'u1', portal_user: 'smoke', full_name: 'Test Person', mobile: '+910000000000', state: 'linked', home_site_id: ID(10), home_section_id: ID(20), rcl_id: 'T-1', may_group: true, created_at: T };
const roles = ['mess_owner', 'mess_operator', 'mess_supervisor', 'driver', 'site_admin', 'accounts', 'management', 'system_admin'];
const grants = roles.map((r, i) => ({ id: ID(200 + i), person_id: ID(1), role: r, site_id: null, mess_id: r.startsWith('mess_o') ? ID(30) : null, valid_from: '2026-01-01', valid_to: null, revoked_at: null }));
const TABLES = {
  people: [person], role_grants: grants, sites: [{ id: ID(10), code: 'S1', name: 'Test site', active: true }], companies: [{ id: ID(90), code: 'TST', name: 'Test Company' }],
  messes: [{ id: ID(30), name: 'Test Mess', site_id: ID(10), contractor_id: ID(40), counters: 2, active: true, lat: null, lng: null, radius_m: null, contractors: { name: 'Test Caterers' } }],
  circles: [{ id: ID(50), site_id: ID(10), code: 'A', name: 'Circle A', km_from: 0, km_to: 10 }],
  sections: [{ id: ID(20), site_id: ID(10), circle_id: ID(50), code: 'A1', name: 'A1', km: 2.4, place: 'office', lat: null, lng: null, active: true }],
  items: [{ id: ID(60), code: 'lunch', name: 'Lunch', kind: 'meal', meal: 'lunch', unit: 'plate', active: true }],
  meal_windows: [{ id: ID(70), mess_id: ID(30), meal: 'lunch', serve_from: '00:00:00', serve_to: '23:59:00', order_by: '23:00:00', change_minutes: 30, valid_from: '2026-01-01', valid_to: null }],
};
const route = async (r) => {
  const u = new URL(r.request().url());
  const send = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  if (r.request().method() === 'OPTIONS') return send({});
  if (u.pathname.startsWith('/auth/v1/user')) return send(user);
  if (u.pathname.startsWith('/auth/v1/')) return send(session);
  if (u.pathname.startsWith('/rest/v1/rpc/')) return send(null);
  if (u.pathname.startsWith('/storage/v1/')) return send({});
  const t = u.pathname.replace('/rest/v1/', '');
  if (r.request().method() !== 'GET') return send([]);
  return send(TABLES[t] || []);
};

const ROUTES = ['/', '/start', '/start/rcl-id', '/start/new', '/guest/new', '/app', '/app/scan', '/app/meal', '/app/parcel', '/app/section', '/app/menu', '/app/menu/poster',
  '/app/orders', '/app/orders/' + ID(99), '/app/orders/' + ID(99) + '/track', '/app/orders/' + ID(99) + '/driver', '/app/orders/' + ID(99) + '/confirm', '/app/orders/' + ID(99) + '/quantity',
  '/app/orders/' + ID(99) + '/review', '/app/complaints/new', '/app/complaints/' + ID(98), '/app/guest', '/app/group', '/app/me',
  '/owner', '/owner/requests', '/owner/requests/' + ID(99), '/owner/kitchen', '/owner/parcels', '/owner/batches/' + ID(97) + '/driver', '/owner/batches/' + ID(97) + '/route',
  '/owner/batches/' + ID(97) + '/dispatch', '/owner/live', '/owner/menu', '/owner/guests', '/owner/closing', '/owner/complaints', '/owner/billing', '/owner/follow-up',
  '/driver', '/driver/assignments/' + ID(97), '/driver/vehicle', '/driver/trip', '/driver/route/' + ID(20), '/driver/stops/' + ID(20), '/driver/hand/' + ID(99) + '/' + ID(1), '/driver/summary/' + ID(97),
  '/admin', '/admin/consumption', '/admin/complaints', '/admin/sites', '/admin/mess', '/admin/work-orders', '/admin/billing', '/admin/reconciliation', '/admin/approvals',
  '/admin/reports', '/admin/analytics', '/admin/scorecard', '/admin/registrations', '/admin/guests', '/admin/people', '/admin/settings', '/admin/audit', '/m/' + ID(30) + '?c=2'];

(async () => {
  await new Promise((ok) => server.listen(4179, ok));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('https://smoke.supabase.co/**', route);
  await ctx.route('wss://smoke.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((s) => { localStorage.setItem('sb-smoke-auth-token', JSON.stringify(s)); }, session);
  const bad = [];
  for (const p of ROUTES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource|ERR_FAILED|net::/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('http://127.0.0.1:4179' + p, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errs.push('goto: ' + e.message));
    await page.waitForTimeout(400);
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 90);
    const blank = text.trim().length < 3;
    const denied = /not open to you|not yours/i.test(text);
    if (errs.length || blank) bad.push({ p, errs, text });
    console.log((errs.length || blank ? 'FAIL ' : 'ok   ') + p.padEnd(58) + (denied ? '[denied] ' : '') + text);
    await page.close();
  }
  console.log('\n' + (ROUTES.length - bad.length) + ' of ' + ROUTES.length + ' routes rendered without an uncaught error');
  for (const b of bad) console.log('\n' + b.p + '\n  ' + b.errs.join('\n  '));
  await browser.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})();
