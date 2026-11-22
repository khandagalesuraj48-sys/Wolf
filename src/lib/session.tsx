import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api, call, db, one, rows } from './db';

export type Role = 'employee' | 'guest' | 'mess_owner' | 'mess_operator' | 'mess_supervisor' | 'driver' | 'site_admin' | 'accounts' | 'management' | 'system_admin';

export interface Person {
  id: string; company_id: string; kind: 'employee' | 'guest' | 'contractor_staff'; full_name: string; mobile: string | null;
  rcl_id: string | null; state: string; state_reason: string | null; temporary_until: string | null; home_site_id: string | null;
  home_section_id: string | null; may_group: boolean; portal_user: string | null; work_role: string | null;
}
export interface Grant { id: string; role: Role; site_id: string | null; mess_id: string | null; valid_from: string; valid_to: string | null }
export interface Site { id: string; code: string; name: string }

type Status = 'loading' | 'off' | 'signedout' | 'noperson' | 'ready' | 'stopped';

interface Ctx {
  status: Status; session: Session | null; me: Person | null; grants: Grant[]; sites: Site[]; companyCode: string;
  roles: Set<Role>; has: (r: Role | Role[], site?: string | null) => boolean; homeSite: Site | null;
  refresh: () => Promise<void>; signOut: () => Promise<void>; ssoError: string | null; needsCode: boolean;
}
const C = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(C);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
};

const STAFF: Role[] = ['mess_owner', 'mess_operator', 'mess_supervisor', 'driver', 'site_admin', 'accounts', 'management', 'system_admin'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// This phone's own random token (only its fingerprint leaves the phone) – it only SUGGESTS who is there.
async function deviceHash(): Promise<string> {
  let t = '';
  try { t = localStorage.getItem('falcon.device') || ''; } catch { /* private window */ }
  if (!t) {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    t = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('falcon.device', t); } catch { /* kept for this visit only */ }
  }
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(supabase ? 'loading' : 'off');
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [companyCode, setCompanyCode] = useState('');
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setMe(null); setGrants([]); setStatus('signedout'); return; }
    const p = await one<Person>(db().from('people').select('*').eq('auth_user_id', s.user.id).limit(1));
    if (!p) {
      const st = await call<{ state: string; reason: string | null; until: string | null; name: string } | null>('my_standing');
      if (st) { setMe({ full_name: st.name, state: st.state, state_reason: st.reason, temporary_until: st.until } as Person); setStatus('stopped'); return; }
      setMe(null); setStatus('noperson'); return;
    }
    if (['rejected', 'suspended'].includes(p.state) || (p.state === 'temporary' && p.temporary_until && p.temporary_until < today())) {
      setMe(p); setStatus('stopped'); return;
    }
    const [g, st, co] = await Promise.all([
      rows<Grant>(db().from('role_grants').select('id,role,site_id,mess_id,valid_from,valid_to').eq('person_id', p.id).is('revoked_at', null)),
      rows<Site>(db().from('sites').select('id,code,name').eq('active', true).order('code')),
      one<{ code: string }>(db().from('companies').select('code').limit(1)),
    ]);
    const t = today();
    setGrants(g.filter((x) => x.valid_from <= t && (!x.valid_to || x.valid_to >= t)));
    setSites(st); setCompanyCode(co?.code || ''); setMe(p); setStatus('ready');
    if (!p.portal_user) {
      try { const d = await api<{ code_needed: boolean }>('/api/device', { device_hash: await deviceHash() }); setNeedsCode(d.code_needed); }
      catch { setNeedsCode(false); }
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let gone = false;
    (async () => {
      // coming from LION with the one sign-in: #sso=<ticket>
      const m = location.hash.match(/sso=([^&]+)/);
      if (m) {
        history.replaceState(null, '', location.pathname + location.search);
        try {
          const r = await api<{ token_hash: string }>('/api/portal-signin', { ticket: decodeURIComponent(m[1]!) }, false);
          const { error } = await supabase!.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
          if (error) throw error;
        } catch (e) { setSsoError((e as Error).message); }
      }
      const { data } = await supabase!.auth.getSession();
      if (!gone) await load(data.session).catch(() => setStatus('signedout'));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') void load(s).catch(() => setStatus('signedout'));
      else setSession(s);
    });
    return () => { gone = true; sub.subscription.unsubscribe(); };
  }, [load]);

  const value = useMemo<Ctx>(() => {
    const roles = new Set<Role>(grants.map((g) => g.role));
    if (me?.kind === 'employee') roles.add('employee');
    if (me?.kind === 'guest') roles.add('guest');
    const has = (r: Role | Role[], site?: string | null) => {
      const want = Array.isArray(r) ? r : [r];
      return want.some((w) => (w === 'employee' || w === 'guest') ? roles.has(w)
        : grants.some((g) => g.role === w && (site == null || g.site_id == null || g.site_id === site)));
    };
    return {
      status, session, me, grants, sites, companyCode, roles, has, ssoError, needsCode,
      homeSite: sites.find((s) => s.id === me?.home_site_id) || null,
      refresh: async () => { const { data } = await db().auth.getSession(); await load(data.session); },
      signOut: async () => { await db().auth.signOut(); },
    };
  }, [status, session, me, grants, sites, companyCode, ssoError, needsCode, load]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

// Where a person starts: his own part of FALCON by his roles (more than one → he chooses).
export function homes(roles: Set<Role>): { path: string; label: string; icon: string }[] {
  const out: { path: string; label: string; icon: string }[] = [];
  if (['system_admin', 'management', 'accounts', 'site_admin', 'mess_supervisor'].some((r) => roles.has(r as Role)))
    out.push({ path: '/admin', label: 'Office (web)', icon: 'layout-grid' });
  if (roles.has('mess_owner') || roles.has('mess_operator')) out.push({ path: '/owner', label: 'My mess', icon: 'chef-hat' });
  if (roles.has('driver')) out.push({ path: '/driver', label: 'My deliveries', icon: 'truck' });
  if (roles.has('employee')) out.push({ path: '/app', label: 'My meals', icon: 'utensils' });
  if (roles.has('guest')) out.push({ path: '/guest', label: 'Guest', icon: 'users' });
  return out;
}
export const isStaff = (roles: Set<Role>) => STAFF.some((r) => roles.has(r));
