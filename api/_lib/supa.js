import { createClient } from '@supabase/supabase-js';
import { env, supabaseUrl } from './env.js';
import { Fail } from './http.js';

// The service client: only here, on the server; never in the browser. It is made per request (no shared session).
export function service() {
  const url = supabaseUrl(), key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Fail(503, 'FALCON is not connected to its database yet (Vercel settings).', 'settings');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Who is calling: his Supabase session token checked by Supabase itself.
export async function caller(token) {
  const { data, error } = await service().auth.getUser(token);
  if (error || !data || !data.user) throw new Fail(401, 'Your sign-in has ended – sign in again.', 'signin');
  return data.user;
}

// A database function, run as the server. Its own message (in words for people) is passed on.
export async function rpc(name, args) {
  const { data, error } = await service().rpc(name, args);
  if (error) throw new Fail(error.code === '42501' ? 403 : 400, error.message, error.code || 'db');
  return data;
}

// A client that acts AS the caller (his own token): the database's own rules decide what he may do.
export function asCaller(token) {
  const url = supabaseUrl(), key = env('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new Fail(503, 'FALCON is not connected to its database yet (Vercel settings).', 'settings');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer ' + token } } });
}
