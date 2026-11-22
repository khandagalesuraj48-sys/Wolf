import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ready, settings } from './env';

// FALCON's one database client – only when its settings are there and safe (src/lib/env.ts).
export const supabase: SupabaseClient | null = ready(settings)
  ? createClient(settings.supabaseUrl, settings.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
