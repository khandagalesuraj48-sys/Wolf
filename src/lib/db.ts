import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// Every read and every action goes through here: the database's own rules decide; its message (in words for people) is shown.
export class DbError extends Error {
  code: string;
  constructor(message: string, code = 'db') { super(message); this.code = code; }
}

export function db() {
  if (!supabase) throw new DbError('FALCON is not connected to its database yet.', 'settings');
  return supabase;
}

export async function call<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!navigator.onLine) throw new DbError('No network – nothing was sent. Try again when you are online.', 'offline');
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new DbError(error.message, error.code);
  return data as T;
}

export async function rows<T = Record<string, unknown>>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new DbError(error.message, error.code);
  return (data as T[]) || [];
}

export async function one<T = Record<string, unknown>>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const r = await rows<T>(q);
  return r[0] ?? null;
}

// The server's own steps (/api/*), with the person's token when he is signed in.
export async function api<T = unknown>(path: string, payload: Record<string, unknown>, withToken = true): Promise<T> {
  if (!navigator.onLine) throw new DbError('No network – nothing was sent. Try again when you are online.', 'offline');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withToken && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = 'Bearer ' + data.session.access_token;
  }
  const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new DbError(j.error || 'The server could not do it – try again.', j.code || String(r.status));
  return j as T;
}

export interface Load<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => void }

// Load something; again when the deps change or reload() is called; again (quietly) when a watched table changes.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], watch: string[] = []): Load<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive.current && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive.current && setState((s) => ({ data: s.data, error: e.message, loading: false })));
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!supabase || watch.length === 0) return;
    const ch = supabase.channel('watch-' + watch.join('-') + '-' + Math.random().toString(36).slice(2));
    for (const t of watch) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => reload());
    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch.join(',')]);
  return { ...state, reload };
}

// An action button's state: busy while it runs, its error in words, done.
export function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}

// The company's dated settings of one day (a value starts on its date; the one before it ended the day before).
export function useSettings(keys: string[], date: string): Load<Record<string, unknown>> {
  return useLoad(async () => {
    const r = await rows<{ key: string; value: unknown }>(db().from('settings').select('key,value').is('site_id', null).in('key', keys)
      .lte('valid_from', date).or('valid_to.is.null,valid_to.gte.' + date));
    return Object.fromEntries(r.map((x) => [x.key, x.value]));
  }, [keys.join(','), date]);
}
export const settingNum = (s: Record<string, unknown> | undefined, key: string, def: number) => {
  const v = Number(s?.[key]); return Number.isFinite(v) && s?.[key] != null ? v : def;
};
