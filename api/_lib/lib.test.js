import crypto from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { verifyTicket } from './ticket.js';
import { verifyHook } from './webhook.js';
import { codePayload, toNumber, sendCode } from './whatsapp.js';
import { hrList, hrLookup } from './hr.js';
import { firstAdmin } from '../welcome.js';
import { doorOf, companyFor, limit, clientIp, LIMITS } from './door.js';

const PORTAL = 'https://portal.test';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'ES256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function ticket(claims, key = privateKey, kid = 'k1') {
  const h = b64({ alg: 'ES256', typ: 'JWT', kid }), b = b64(claims);
  return h + '.' + b + '.' + crypto.sign('sha256', Buffer.from(h + '.' + b), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
const jwks = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const now = Math.floor(Date.now() / 1000);
const good = { iss: PORTAL, aud: 'falcon', sub: 'someone@test.invalid', exp: now + 60, jti: 'abcdef0123456789' };

describe('the Portal ticket', () => {
  it('is taken when signed by the Portal, for FALCON, not expired', async () => {
    expect((await verifyTicket(ticket(good), { portalUrl: PORTAL, fetchImpl: jwks })).sub).toBe('someone@test.invalid');
  });
  it('is refused for another module', async () => {
    await expect(verifyTicket(ticket({ ...good, aud: 'hr' }), { portalUrl: PORTAL, fetchImpl: jwks })).rejects.toThrow(/not for FALCON/);
  });
  it('is refused when expired', async () => {
    await expect(verifyTicket(ticket({ ...good, exp: now - 5 }), { portalUrl: PORTAL, fetchImpl: jwks })).rejects.toThrow(/expired/);
  });
  it('is refused when signed by another key', async () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    await expect(verifyTicket(ticket(good, other), { portalUrl: PORTAL, fetchImpl: jwks })).rejects.toThrow(/not from the Portal/);
  });
  it('is refused when changed after signing', async () => {
    const t = ticket(good).split('.');
    t[1] = b64({ ...good, sub: 'boss@test.invalid', super: true });
    await expect(verifyTicket(t.join('.'), { portalUrl: PORTAL, fetchImpl: jwks })).rejects.toThrow(/not from the Portal/);
  });
  it('is refused from another Portal address', async () => {
    await expect(verifyTicket(ticket({ ...good, iss: 'https://evil.test' }), { portalUrl: PORTAL, fetchImpl: jwks })).rejects.toThrow(/not from this Portal/);
  });
});

describe('the Supabase hook signature', () => {
  const secret = 'v1,whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  const sign = (id, ts, body) => 'v1,' + crypto.createHmac('sha256', Buffer.from('0123456789abcdef0123456789abcdef')).update(id + '.' + ts + '.' + body).digest('base64');
  const ts = String(Math.floor(Date.now() / 1000)), body = '{"user":{"phone":"919800000000"},"sms":{"otp":"123456"}}';
  it('takes a call signed with the secret', () => {
    expect(verifyHook(secret, { 'webhook-id': 'm1', 'webhook-timestamp': ts, 'webhook-signature': sign('m1', ts, body) }, body)).toBe(true);
  });
  it('refuses a changed body, a wrong secret and an old call', () => {
    expect(verifyHook(secret, { 'webhook-id': 'm1', 'webhook-timestamp': ts, 'webhook-signature': sign('m1', ts, body) }, body.replace('123456', '000000'))).toBe(false);
    expect(verifyHook('v1,whsec_' + Buffer.from('another-secret-another-secret!!!').toString('base64'), { 'webhook-id': 'm1', 'webhook-timestamp': ts, 'webhook-signature': sign('m1', ts, body) }, body)).toBe(false);
    const old = String(Number(ts) - 3600);
    expect(verifyHook(secret, { 'webhook-id': 'm1', 'webhook-timestamp': old, 'webhook-signature': sign('m1', old, body) }, body)).toBe(false);
    expect(verifyHook(secret, {}, body)).toBe(false);
  });
});

describe('the WhatsApp code', () => {
  beforeEach(() => { delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; });
  it('goes to 91 + ten digits, with the code in the body and the copy button', () => {
    expect(toNumber('+919800000000')).toBe('919800000000');
    expect(toNumber('9800000000')).toBe('919800000000');
    expect(toNumber('+14155550100')).toBe('');
    const p = codePayload('919800000000', '123456');
    expect(p.template.name).toBe('otp');
    expect(p.template.components[0].parameters[0].text).toBe('123456');
    expect(p.template.components[1].parameters[0].text).toBe('123456');
  });
  it('is not sent – and says why – when WhatsApp is not set up', async () => {
    const r = await sendCode('919800000000', '123456', async () => { throw new Error('must not be called'); });
    expect(r).toEqual({ ok: false, why: 'WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID missing in Vercel' });
  });
});

describe('the HR look-up (FALCON\'s kept copy)', () => {
  it('says "not_checked" when the database does not answer – nothing is made up', async () => {
    expect(await hrLookup('TST-1', '+919800000000', async () => { throw new Error('down'); })).toEqual({ result: 'not_checked' });
  });
  it('asks the copy with the RCL ID in capitals and the proven mobile', async () => {
    let asked;
    const r = await hrLookup('tst-1', '+919800000000', async (fn, args) => { asked = [fn, args]; return { result: 'found', name: 'A Name', designation: 'Engineer', ref: 'e1', mobile: '+919800000000', mobile_matches: true, bank: 'never' }; });
    expect(asked).toEqual(['server_hr_find', { p_company_code: 'RCL', p_rcl_id: 'TST-1', p_mobile: '+919800000000' }]);
    expect(r).toEqual({ result: 'found', name: 'A Name', designation: 'Engineer', ref: 'e1', mobile: '+919800000000', mobile_matches: true });
  });
  it('gives nothing more than the answer for "not found"', async () => {
    expect(await hrLookup('TST-2', null, async () => ({ result: 'not_found', name: 'x' }))).toEqual({ result: 'not_found' });
  });
});

describe('HR\'s list (hrList)', () => {
  beforeEach(() => { delete process.env.HR_EMPLOYEES_URL; delete process.env.HR_FALCON_SECRET; });
  it('is refused – and says why – while HR is not connected', async () => {
    await expect(hrList(async () => { throw new Error('must not be called'); })).rejects.toThrow('HR_EMPLOYEES_URL, HR_FALCON_SECRET missing in Vercel');
  });
  it('reads every page with the secret and keeps only the agreed fields', async () => {
    process.env.HR_EMPLOYEES_URL = 'https://hr.test/api/falcon-employees'; process.env.HR_FALCON_SECRET = 's'.repeat(30);
    const asked = [];
    const pages = [{ employees: [{ id: 'e1', code: 'RCL-1', name: 'A', designation: 'Driver', category: 'driver', site: 'VTR', mobile: '9800000044', status: 'active', left: '', dob: 'never', bank: 'never' }], next: 1 },
      { employees: [{ id: 'e2', code: 'RCL-2', name: 'B', site: 'B18', status: 'left', left: '2026-10-31' }], next: null }];
    const list = await hrList(async (url, opt) => { asked.push([url, opt.headers.Authorization, JSON.parse(opt.body)]); return { ok: true, status: 200, json: async () => pages[asked.length - 1] }; });
    expect(asked.map((a) => a[2])).toEqual([{ offset: 0, limit: 1000 }, { offset: 1, limit: 1000 }]);
    expect(asked[0][1]).toBe('Bearer ' + 's'.repeat(30));
    expect(list).toEqual([
      { id: 'e1', code: 'RCL-1', name: 'A', designation: 'Driver', category: 'driver', site: 'VTR', mobile: '9800000044', status: 'active', left: undefined },
      { id: 'e2', code: 'RCL-2', name: 'B', designation: undefined, category: undefined, site: 'B18', mobile: undefined, status: 'left', left: '2026-10-31' }]);
  });
  it('says plainly when HR refuses FALCON', async () => {
    process.env.HR_EMPLOYEES_URL = 'https://hr.test/api/falcon-employees'; process.env.HR_FALCON_SECRET = 'x';
    await expect(hrList(async () => ({ ok: false, status: 401, json: async () => ({}) }))).rejects.toThrow('HR refused FALCON');
  });
});

describe('the first System Admin (FALCON_FIRST_ADMIN)', () => {
  it('takes an Indian mobile in any common way, and nothing else', () => {
    expect(firstAdmin('9800000077')).toBe('+919800000077');
    expect(firstAdmin('+91 98000 00077')).toBe('+919800000077');
    expect(firstAdmin('09800000077')).toBe('+919800000077');
    expect(firstAdmin('')).toBe(null);
    expect(firstAdmin('12345')).toBe(null);
    expect(firstAdmin('+1 415 555 0100')).toBe(null);
  });
});

describe('the first screen\'s code and the limits (23-11-2026)', () => {
  it('asks the database only for a code of 2–12 letters and numbers, in capitals', async () => {
    const seen = [];
    const rpcImpl = async (name, args) => { seen.push([name, args]); return { kind: 'company', code: 'TST', company: 'TST' }; };
    expect(await doorOf(' tst ', rpcImpl)).toMatchObject({ kind: 'company' });
    expect(await doorOf('A B', rpcImpl)).toBeNull();
    expect(await doorOf('', rpcImpl)).toBeNull();
    expect(seen).toEqual([['server_door', { p_code: 'TST' }]]);
  });
  it('says plainly when the database update is not run yet', async () => {
    const rpcImpl = async () => { const e = new Error('x'); e.code = 'PGRST202'; throw e; };
    await expect(doorOf('TST', rpcImpl)).rejects.toThrow(/update of 23-11-2026/);
  });
  it('takes the company of a contractor\'s code, refuses an unknown code, and keeps this FALCON\'s own when none is named', async () => {
    expect(await companyFor('TCAT', async () => ({ kind: 'contractor', code: 'TCAT', company: 'TST' }))).toBe('TST');
    await expect(companyFor('NOPE', async () => null)).rejects.toThrow(/No company or contractor/);
    expect(await companyFor(undefined, async () => { throw new Error('not asked'); })).toBe('RCL');
  });
  it('stops a try over the limit with the time to wait', async () => {
    await expect(limit('otp', '+919800000001', async () => ({ ok: false, wait: 42 }))).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Too many codes.*42 seconds/) });
    await expect(limit('lookup', '1.2.3.4', async () => ({ ok: false, wait: 600 }))).rejects.toThrow(/Too many tries.*10 minutes/);
    expect(await limit('door', '1.2.3.4', async () => ({ ok: true }))).toEqual({ ok: true });
  });
  it('never stops the sign-in code when the database cannot count (lenient), but does stop a look-up (strict)', async () => {
    const down = async () => { const e = new Error('x'); e.code = 'PGRST202'; throw e; };
    expect(await limit('otp', '+919800000001', down, false)).toMatchObject({ ok: true, unchecked: true });
    await expect(limit('lookup', '1.2.3.4', down)).rejects.toThrow(/update of 23-11-2026/);
  });
  it('a mobile: 1 code a minute, 5 an hour, 10 a day', () => {
    expect(LIMITS.otp).toEqual([{ n: 1, secs: 60 }, { n: 5, secs: 3600 }, { n: 10, secs: 86400 }]);
  });
  it('reads the place from Vercel\'s header', () => {
    expect(clientIp({ headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' } })).toBe('1.2.3.4');
    expect(clientIp({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } })).toBe('5.6.7.8');
  });
  it('looks an employee code up in the company of the first screen', async () => {
    let asked;
    await hrLookup('rcl296', null, async (n, a) => { asked = a; return { result: 'not_found' }; }, 'TST');
    expect(asked).toMatchObject({ p_company_code: 'TST', p_rcl_id: 'RCL296' });
  });
});

// (23-11-2026) opened from HR: HR's pass, the meal on now by the server's clock
import { signPass, readPass, mealNow, hrEmail, indian, PASS_MAX_SECONDS } from './hrpass.js';
describe('HR\'s pass (opened from the HR app)', () => {
  const S = 'a-made-up-word-of-thirty-two-letters!!';
  const t = Math.floor(Date.now() / 1000);
  const claims = { c: 'rcl0123', n: 'Made Up', m: '9876543210', s: 'vtr', d: 'Site Engineer', in: '08:52', day: '2026-11-23', exp: t + 120, jti: 'ab'.repeat(16) };
  it('is taken when HR signed it, not expired: code, mobile, site as FALCON keeps them', () => {
    const p = readPass(signPass(claims, S), S, t);
    expect(p.code).toBe('RCL0123'); expect(p.mobile).toBe('+919876543210'); expect(p.site).toBe('VTR'); expect(p.in).toBe('08:52');
  });
  it('is refused when signed with another word, changed, expired, too long, without its number, mobile or code', () => {
    expect(() => readPass(signPass(claims, S), S + 'x', t)).toThrow(/did not sign/);
    const good = signPass(claims, S), parts = good.split('.');
    const other = Buffer.from(JSON.stringify({ ...claims, c: 'RCL0999' })).toString('base64url');
    expect(() => readPass(parts[0] + '.' + other + '.' + parts[2], S, t)).toThrow(/did not sign/);
    expect(() => readPass(signPass({ ...claims, exp: t - 1 }, S), S, t)).toThrow(/expired/);
    expect(() => readPass(signPass({ ...claims, exp: t + PASS_MAX_SECONDS + 60 }, S), S, t)).toThrow(/not valid/);
    expect(() => readPass(signPass({ ...claims, jti: 'x' }, S), S, t)).toThrow(/not valid/);
    expect(() => readPass(signPass({ ...claims, m: '12345' }, S), S, t)).toThrow(/no mobile/);
    expect(() => readPass(signPass({ ...claims, c: '' }, S), S, t)).toThrow(/no employee code/);
    expect(() => readPass('nonsense', S, t)).toThrow(/not a pass/);
  });
  it('is never read without the shared word set', () => {
    expect(() => readPass(signPass(claims, S), '', t)).toThrow(/HR_FALCON_SECRET/);
  });
  it('a punch-in time that is not a time is left out', () => {
    expect(readPass(signPass({ ...claims, in: '<b>' }, S), S, t).in).toBeNull();
  });
  it('one made-up address per employee, never his e-mail', () => {
    expect(hrEmail('RCL', 'rcl0123')).toBe(hrEmail('rcl', 'RCL0123'));
    expect(hrEmail('RCL', 'RCL0123')).toMatch(/^hr-[0-9a-f]{24}@falcon\.invalid$/);
    expect(indian('+91 98765 43210')).toBe('+919876543210'); expect(indian('5876543210')).toBeNull();
  });
});
describe('the meal on now (the server\'s clock)', () => {
  const W = [{ meal: 'dinner', serve_from: '19:30:00', serve_to: '22:00:00', order_by: '19:00:00' },
    { meal: 'breakfast', serve_from: '07:30:00', serve_to: '09:30:00', order_by: '07:00:00' },
    { meal: 'lunch', serve_from: '12:00:00', serve_to: '14:30:00', order_by: '11:30:00' }];
  it('morning: breakfast; noon: lunch (on now, parcels closed); evening: dinner (parcels until 19:00); night: nothing', () => {
    expect(mealNow(W, '07:00').meal).toBe('breakfast');
    expect(mealNow(W, '12:20')).toEqual({ meal: 'lunch', from: '12:00', to: '14:30', order_by: '11:30', now: true, parcel_open: false });
    expect(mealNow(W, '15:00')).toMatchObject({ meal: 'dinner', now: false, parcel_open: true });
    expect(mealNow(W, '22:30')).toBeNull();
    expect(mealNow([], '12:00')).toBeNull();
  });
});
