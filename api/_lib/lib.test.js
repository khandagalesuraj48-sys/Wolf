import crypto from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { verifyTicket } from './ticket.js';
import { verifyHook } from './webhook.js';
import { codePayload, toNumber, sendCode } from './whatsapp.js';
import { hrLookup } from './hr.js';

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

describe('the HR look-up', () => {
  beforeEach(() => { delete process.env.HR_LOOKUP_URL; delete process.env.HR_LOOKUP_SECRET; });
  it('says "not_checked" while HR is not connected – nothing is made up', async () => {
    expect(await hrLookup('TST-1', '+919800000000', async () => { throw new Error('must not be called'); })).toEqual({ result: 'not_checked' });
  });
  it('keeps only what FALCON needs from HR', async () => {
    process.env.HR_LOOKUP_URL = 'https://hr.test/lookup'; process.env.HR_LOOKUP_SECRET = 's';
    const r = await hrLookup('TST-1', '+919800000000', async () => ({ ok: true, json: async () => ({ result: 'found', name: 'A Name', designation: 'Engineer', ref: 'e1', mobile_matches: true, bank: 'never' }) }));
    expect(r).toEqual({ result: 'found', name: 'A Name', designation: 'Engineer', ref: 'e1', mobile_matches: true });
  });
  it('says "not_checked" when HR does not answer', async () => {
    process.env.HR_LOOKUP_URL = 'https://hr.test/lookup'; process.env.HR_LOOKUP_SECRET = 's';
    expect(await hrLookup('TST-1', null, async () => { throw new Error('down'); })).toEqual({ result: 'not_checked' });
  });
});
