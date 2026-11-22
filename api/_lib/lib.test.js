import crypto from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { verifyTicket } from './ticket.js';
import { verifyHook } from './webhook.js';
import { codePayload, toNumber, sendCode } from './whatsapp.js';
import { hrList, hrLookup } from './hr.js';
import { firstAdmin } from '../welcome.js';

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
