// The server's settings (Vercel → Environment Variables). A missing one is named – its value never.
export const env = (n) => String(process.env[n] || '').trim();
export const on = (n) => /^(on|1|true|yes)$/i.test(env(n));

export function need(...names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    const e = new Error(missing.join(', ') + ' missing in Vercel');
    e.status = 503; e.missingSettings = missing;
    throw e;
  }
}

export const supabaseUrl = () => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/, '');
export const companyCode = () => (env('FALCON_COMPANY_CODE') || 'RCL').toUpperCase();
