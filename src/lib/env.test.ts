import { describe, expect, it } from 'vitest';
import { readSettings, ready } from './env';

const jwt = (role: string) => 'x.' + btoa(JSON.stringify({ role })).replace(/=+$/, '') + '.y';

describe('the browser settings', () => {
  it('names what is missing', () => {
    const s = readSettings({});
    expect(s.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
    expect(ready(s)).toBe(false);
  });
  it('takes a Supabase address and a publishable key', () => {
    const s = readSettings({ VITE_SUPABASE_URL: 'https://abcd1234.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xyz' });
    expect(s.supabaseUrl).toBe('https://abcd1234.supabase.co');
    expect(ready(s)).toBe(true);
  });
  it('accepts the old anon key', () => {
    expect(ready(readSettings({ VITE_SUPABASE_URL: 'https://abcd1234.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }))).toBe(true);
  });
  it('refuses a secret key in the browser – new or old', () => {
    for (const key of ['sb_secret_abc', jwt('service_role')]) {
      const s = readSettings({ VITE_SUPABASE_URL: 'https://abcd1234.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key });
      expect(s.wrong).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY']);
      expect(ready(s)).toBe(false);
    }
  });
  it('refuses an address that is not Supabase', () => {
    expect(readSettings({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).wrong).toEqual(['VITE_SUPABASE_URL']);
  });
});
