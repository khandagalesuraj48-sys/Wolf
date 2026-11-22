// The settings the browser needs (Vercel → Environment Variables). "VITE_" values are public by design; nothing secret is here.
export type Env = Record<string, string | undefined>;

export const BROWSER_SETTINGS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;

export interface Settings {
  supabaseUrl: string;
  publishableKey: string;
  missing: string[];
  wrong: string[];
}

export function readSettings(env: Env): Settings {
  const url = (env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const missing = BROWSER_SETTINGS.filter((n) => !(env[n] || '').trim());
  const wrong: string[] = [];
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) wrong.push('VITE_SUPABASE_URL');
  // A secret key must never reach the browser: Supabase's secret keys start "sb_secret_", the old service key says "service_role".
  if (key && (key.startsWith('sb_secret_') || roleOf(key) === 'service_role')) wrong.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  return { supabaseUrl: url, publishableKey: key, missing: [...missing], wrong };
}

export function ready(s: Settings): boolean {
  return s.missing.length === 0 && s.wrong.length === 0;
}

// The "role" written inside an old-style Supabase key (a JWT), or '' – read only to refuse a secret key in the browser.
function roleOf(key: string): string {
  const part = key.split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(globalThis.atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.role === 'string' ? json.role : '';
  } catch {
    return '';
  }
}

export const settings = readSettings(import.meta.env as unknown as Env);
