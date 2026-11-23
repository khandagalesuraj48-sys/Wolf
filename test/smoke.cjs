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
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[ext] || 'application/octet-stream';
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
  contractors: [{ id: ID(40), name: 'Test Caterers', kind: 'proprietor', contact_name: 'Made Up', contact_mobile: '+910000000040', gstin: null, pan: null, udyam: null, address: null, active: true, login_code: null }],
  sections: [{ id: ID(20), site_id: ID(10), code: 'A1', name: 'A1', km: 2.4, place: 'office', lat: null, lng: null, radius_m: null, active: true }],
  items: [{ id: ID(60), code: 'lunch', name: 'Lunch', kind: 'meal', meal: 'lunch', unit: 'plate', active: true }],
  work_orders: [{ id: ID(80), number: 'WO-T-1', site_id: ID(10), mess_id: ID(30), contractor_id: ID(40), valid_from: '2026-04-01', valid_to: '2027-03-31', payment_days: 30, advance_amount: 0, advance_recovery_pct: 0, security_deposit: 0, retention_pct: 5, state: 'active', messes: { name: 'Test Mess' }, contractors: { name: 'Test Caterers' } }],
  rates: [{ id: ID(81), item_id: ID(60), rate: 95, valid_from: '2026-04-01', valid_to: null, state: 'approved', asked_by: null, reason: null, items: { name: 'Lunch', code: 'lunch' } }],
  work_order_boq: [{ id: ID(82), item_id: ID(60), qty: 30000, note: null, items: { name: 'Lunch', code: 'lunch', unit: 'plate' } }],
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

const ROUTES = ['/', '/start', '/start/employee', '/start/contractor', '/start/rcl-id', '/start/new', '/guest/new', '/app', '/app/scan', '/app/meal', '/app/parcel', '/app/section', '/app/menu', '/app/menu/poster',
  '/app/orders', '/app/orders/' + ID(99), '/app/orders/' + ID(99) + '/track', '/app/orders/' + ID(99) + '/driver', '/app/orders/' + ID(99) + '/confirm', '/app/orders/' + ID(99) + '/quantity',
  '/app/orders/' + ID(99) + '/review', '/app/complaints/new', '/app/complaints/' + ID(98), '/app/guest', '/app/group', '/app/me',
  '/owner', '/owner/requests', '/owner/requests/' + ID(99), '/owner/kitchen', '/owner/parcels', '/owner/batches/' + ID(97) + '/driver', '/owner/batches/' + ID(97) + '/route',
  '/owner/batches/' + ID(97) + '/dispatch', '/owner/live', '/owner/menu', '/owner/guests', '/owner/closing', '/owner/complaints', '/owner/billing', '/owner/follow-up',
  '/driver', '/driver/assignments/' + ID(97), '/driver/vehicle', '/driver/trip', '/driver/route/' + ID(20), '/driver/stops/' + ID(20), '/driver/hand/' + ID(99) + '/' + ID(1), '/driver/summary/' + ID(97),
  '/admin', '/admin/consumption', '/admin/complaints', '/admin/sites', '/admin/mess', '/admin/work-orders', '/admin/billing', '/admin/reconciliation', '/admin/approvals',
  '/admin/reports', '/admin/analytics', '/admin/scorecard', '/admin/registrations', '/admin/hr', '/admin/guests', '/admin/people', '/admin/settings', '/admin/audit', '/m/' + ID(30) + '?c=2'];

(async () => {
  await new Promise((ok) => server.listen(4179, ok));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('https://smoke.supabase.co/**', route);
  await ctx.route('wss://smoke.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((s) => {
    localStorage.setItem('sb-smoke-auth-token', JSON.stringify(s));
    // (23-11-2026) the first screen's code, as typed before
    localStorage.setItem('falcon.door', JSON.stringify({ kind: 'company', code: 'TST', name: 'Test Company', company: 'TST', company_name: 'Test Company' }));
  }, session);
  const bad = [];
  for (const p of ROUTES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource|ERR_FAILED|net::/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('http://127.0.0.1:4179' + p, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errs.push('goto: ' + e.message));
    await page.waitForTimeout(400);
    // every picture of the page is there (the logo of 23-11-2026 too)
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src'))).catch(() => []);
    for (const b of broken) errs.push('picture not found: ' + b);
    if (process.env.SMOKE_SHOTS && ['/start', '/start/employee', '/admin', '/admin/work-orders', '/admin/mess', '/admin/sites'].includes(p)) await page.screenshot({ path: path.join(process.env.SMOKE_SHOTS, (p.slice(1) || 'root').replace(/\//g, '_') + '.png') });
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 90);
    const blank = text.trim().length < 3;
    const denied = /not open to you|not yours/i.test(text);
    if (errs.length || blank) bad.push({ p, errs, text });
    console.log((errs.length || blank ? 'FAIL ' : 'ok   ') + p.padEnd(58) + (denied ? '[denied] ' : '') + text);
    await page.close();
  }
  console.log('\n' + (ROUTES.length - bad.length) + ' of ' + ROUTES.length + ' routes rendered without an uncaught error');

  // (23-11-2026) where he is, the server's clock, opened from HR (pictures N1, N2, N8) – the mess gets a place for this part
  Object.assign(TABLES.messes[0], { lat: 18.52, lng: 73.85, radius_m: 100 });
  Object.assign(TABLES.sections[0], { lat: 18.53, lng: 73.85, radius_m: 500 });   // (0017) Section A1: its place and 500 m around it
  TABLES.meal_windows = ['breakfast|07:30|09:30|07:00', 'lunch|12:00|14:30|11:30', 'dinner|19:30|22:00|19:00'].map((x, i) => {
    const [meal, f, t, o] = x.split('|');
    return { id: ID(170 + i), mess_id: ID(30), meal, serve_from: f + ':00', serve_to: t + ':00', order_by: o + ':00', change_minutes: 30, valid_from: '2026-01-01', valid_to: null };
  });
  const at = (hm) => new Date(T + 'T' + hm + ':00+05:30').toISOString();
  const CASES = [
    { name: 'at the mess, 13:00 by the server', geo: { latitude: 18.5201, longitude: 73.8501 }, clock: at('13:00'), want: ['You are at Test Mess', 'Lunch at the mess', 'Scan the counter QR', 'Inside the mess area'] },
    { name: 'away (3.3 km), 18:00 by the server', geo: { latitude: 18.55, longitude: 73.85 }, clock: at('18:00'), want: ['km from Test Mess', 'Dinner parcel to your section', 'Ask dinner parcel', 'Directions'] },
    { name: 'location off', geo: null, clock: at('13:00'), want: ['Location is off', 'Scan QR', 'Parcel'] },
    // (0017, his word: "only section … section che baheun koni kel asel tr … location direction") the van goes where he is
    { name: 'parcel inside Section A1', path: '/app/parcel', geo: { latitude: 18.531, longitude: 73.85 }, clock: at('13:00'), want: ['found by your location', 'Section A1'] },
    { name: 'parcel outside every section', path: '/app/parcel', geo: { latitude: 18.60, longitude: 73.85 }, clock: at('13:00'), want: ['outside the sections', 'Your location', 'km from the mess', 'Your location goes with this order only'] },
    { name: 'parcel, location off', path: '/app/parcel', geo: null, clock: at('13:00'), want: ['your work place', 'Section A1'] },
    { name: 'opened from HR (#hrpass)', geo: { latitude: 18.5201, longitude: 73.8501 }, clock: at('13:00'), hash: '#hrpass=made-up-pass', want: ['Signed in through RCL HR', 'Present since 08:52', 'Comes from HR by itself'] },
  ];
  for (const c of CASES) {
    const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...(c.geo ? { geolocation: c.geo, permissions: ['geolocation'] } : {}) });
    await cx.route('https://smoke.supabase.co/**', route);
    await cx.route('wss://smoke.supabase.co/**', (r) => r.abort());
    await cx.route('**/api/start', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, now: c.clock }) }));
    await cx.route('**/api/hr', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: { access_token: jwt, refresh_token: 'r' }, hr: { day: T, in: '08:52' } }) }));
    await cx.addInitScript((s) => { localStorage.setItem('sb-smoke-auth-token', JSON.stringify(s)); }, session);
    const page = await cx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto('http://127.0.0.1:4179' + (c.path || '/app') + (c.hash || ''), { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errs.push('goto: ' + e.message));
    await page.waitForTimeout(1200);
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
    const missing = c.want.filter((w) => !text.includes(w));
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'place_' + c.name.replace(/[^a-z0-9]+/gi, '_') + '.png') });
    if (missing.length || errs.length) bad.push({ p: 'place: ' + c.name, errs: [...errs, ...missing.map((m) => 'not shown: ' + m)] });
    console.log((missing.length || errs.length ? 'FAIL ' : 'ok   ') + 'place: ' + c.name);
    await cx.close();
  }
  // (23-11-2026, pictures M1–M8) the masters: Edit opens its side panel, Remove its box (from a date, the reason), History its list
  const MCASES = [
    { name: 'mess – Edit', path: '/admin/mess', click: [['button', 'Edit']], want: ['Edit · Test Mess', 'Place on the map', 'Latitude', 'Use my location', 'In use from', 'Why (kept in History)'] },
    { name: 'mess – Remove', path: '/admin/mess', click: [['button', 'Remove']], want: ['Remove Test Mess?', 'From which date', 'Reason (must be given)', 'It stays in the record'] },
    { name: 'mess – History', path: '/admin/mess', click: [['button', 'History']], want: ['History · Test Mess', 'Nothing changed yet.'] },
    { name: 'meal times – Edit', path: '/admin/mess', click: [['button', 'Edit', 2]], want: ['Edit · Lunch · Test Mess', 'Which days get the new times?', 'From a date', 'Correct it from its start'] },
    { name: 'section – Edit', path: '/admin/sites', click: [['button', 'Edit', -1]], want: ['Edit · Section A1', 'The Km comes by itself', 'Latitude', 'the metres around it', 'Metres'] },
    { name: 'contractors', path: '/admin/mess', click: [['tab', 'Contractors']], want: ['New contractor', 'Papers', 'Sign-in code'] },
    { name: 'rate – Edit', path: '/admin/work-orders', click: [['button', 'Edit', 2]], want: ['Edit · Lunch rate', 'Rate ₹', 'Not in a bill yet'] },
  ];
  for (const c of MCASES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto('http://127.0.0.1:4179' + c.path, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errs.push('goto: ' + e.message));
    await page.waitForTimeout(400);
    for (const [role, name, nth] of c.click) {
      const all = page.getByRole(role, { name, exact: true });
      const n = await all.count();
      const i = nth == null ? 0 : nth < 0 ? n + nth : nth;
      if (i < 0 || i >= n) { errs.push('no ' + role + ' "' + name + '" #' + i + ' (there are ' + n + ')'); continue; }
      await all.nth(i).click().catch((e) => errs.push('click: ' + e.message));
      await page.waitForTimeout(500);
    }
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
    const missing = c.want.filter((w) => !text.includes(w));
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: path.join(process.env.SMOKE_SHOTS, 'masters_' + c.name.replace(/[^a-z0-9]+/gi, '_') + '.png') });
    if (missing.length || errs.length) bad.push({ p: 'masters: ' + c.name, errs: [...errs, ...missing.map((m) => 'not shown: ' + m)] });
    console.log((missing.length || errs.length ? 'FAIL ' : 'ok   ') + 'masters: ' + c.name);
    await page.close();
  }
  for (const b of bad) console.log('\n' + b.p + '\n  ' + b.errs.join('\n  '));
  await browser.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})();
