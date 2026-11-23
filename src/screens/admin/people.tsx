// The web's people and control: w16 the Site Admin's inbox of registrations (verify, link to HR, ask HR, temporary, section,
// details, reject, suspend, release) · w17 a guest's one profile and his visits · people and roles (the System Admin gives
// and takes roles; a contractor's person; group requests; vans) · settings (items, dated settings, Accounts' GST / TDS rules).
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { api, call, db, rows, useAct, useLoad } from '../../lib/db';
import { useSession, type Role } from '../../lib/session';
import { day, initials, maskMobile, mealName, MEALS, num, time, today } from '../../lib/fmt';
import { Icon } from '../../ui/Icon';
import { ErrorLine, Failed, Input, Loading } from '../../ui/kit';
import { csv, Kpi, SitePick, Tbl, Web } from '../../ui/web';
import { inUse, listed, type Dated } from '../../lib/dated';

interface Reg {
  id: string; code: string; site_id: string | null; section_id: string | null; typed_rcl_id: string | null; hr_result: string; hr_name: string | null;
  category: string | null; work_role: string | null; works_with: string | null; photo_path: string | null; info_asked: string | null; info_answer: string | null;
  asked_hr_at: string | null; decided_at: string | null; last_action: string | null; reason: string | null; created_at: string;
  p: { id: string; full_name: string; mobile: string | null; mobile_verified_at: string | null; state: string; temporary_until: string | null; rcl_id: string | null; kind: string; home_section_id: string | null } | null;
}
const WAITING = ['whatsapp_verified', 'id_found', 'id_not_found', 'new_registration', 'pending_verification'];
const STATE: Record<string, [string, string]> = {
  mobile_pending: ['Mobile not proved', 'red'], whatsapp_verified: ['Pending Site Admin', 'amber'], id_found: ['Pending Site Admin', 'amber'],
  id_not_found: ['Pending Site Admin', 'amber'], new_registration: ['Pending Site Admin', 'amber'], pending_verification: ['Pending HR', 'amber'],
  temporary: ['Temporary', 'amber'], verified: ['Verified', 'leaf'], id_assigned: ['ID from HR', 'leaf'], linked: ['Linked', 'leaf'],
  rejected: ['Rejected', 'red'], suspended: ['Suspended', 'red'] };
const HR: Record<string, [string, string]> = { found: ['Found', 'leaf'], not_found: ['Not found', 'red'], maybe: ['Maybe', 'amber'], not_checked: ['Not checked', ''] };

// ── w16 · registrations ──
export function Registrations() {
  const s = useSession();
  const [site, setSite] = useState(s.sites[0]?.id || '');
  const regs = useLoad(() => site ? rows<Reg>(db().from('registrations').select('*,p:people!registrations_person_id_fkey(id,full_name,mobile,mobile_verified_at,state,temporary_until,rcl_id,kind,home_section_id)').eq('site_id', site).order('created_at', { ascending: false }).limit(300)) : Promise.resolve([]), [site], ['registrations', 'people']);
  const secs = useLoad(() => site ? rows<{ id: string; code: string } & Dated>(db().from('sections').select('id,code,active,valid_from,valid_to').eq('site_id', site).eq('active', true).order('code')).then((x) => x.filter((y) => inUse(y))) : Promise.resolve([]), [site]);
  const [sel, setSel] = useState('');
  const list = (regs.data || []).slice().sort((x, y) => Number(WAITING.includes(y.p?.state || '')) - Number(WAITING.includes(x.p?.state || '')));
  const r = list.find((x) => x.id === sel) || list[0];
  const [f, setF] = useState({ rcl: '', until: today(7), section: '', question: '', reason: '' });
  const [hr, setHr] = useState<{ result: string; name?: string; designation?: string } | null>(null);
  const a = useAct();
  const m = today().slice(0, 7);
  const act = (action: string, args: Record<string, unknown> = {}, reason?: string) => a.run(async () => {
    await call('decide_registration', { p_reg: r!.id, p_action: action, p_args: args, p_reason: reason ?? (f.reason.trim() || null) }); setF({ ...f, reason: '', question: '' }); setHr(null); regs.reload();
  });
  const look = () => a.run(async () => setHr(await api<{ result: string; name?: string; designation?: string }>('/api/lookup', { rcl_id: f.rcl })));
  const photo = async (path: string) => { const x = await supabase!.storage.from('registration-photos').createSignedUrl(path, 300); if (x.data) window.open(x.data.signedUrl, '_blank'); };
  const newest = list.find((x) => x.hr_result !== 'found' && WAITING.concat('temporary').includes(x.p?.state || ''));
  const sec = (id: string | null) => (secs.data || []).find((x) => x.id === id)?.code || '–';
  return (
    <Web title={'New and unregistered people · ' + (s.sites.find((x) => x.id === site)?.code || '')} roles={['system_admin', 'site_admin', 'management']} actions={<SitePick value={site} onChange={setSite} />}>
      {newest && <div className="row" style={{ gap: 12, background: 'var(--sfS)', border: '1px solid #F2C99A', borderRadius: 14, padding: '12px 16px' }}><Icon name="bell" size={18} /><span className="sp sm" style={{ color: 'var(--ink)' }}><b>New site user registered – HR employee record not found.</b> {newest.p?.full_name} · {sec(newest.section_id)} · {day(newest.created_at)} {time(newest.created_at)}</span><button className="wbtn" style={{ height: 34 }} onClick={() => setSel(newest.id)}>Open</button></div>}
      <div className="kpis">
        <Kpi label="Waiting for a check" value={list.filter((x) => WAITING.includes(x.p?.state || '')).length} tone="amber" note={list.filter((x) => WAITING.includes(x.p?.state || '')).length ? 'oldest ' + day(list.filter((x) => WAITING.includes(x.p?.state || '')).slice(-1)[0].created_at) : ''} />
        <Kpi label="Temporary users" value={list.filter((x) => x.p?.state === 'temporary').length} tone="amber" note={list.filter((x) => x.p?.state === 'temporary' && x.p.temporary_until && x.p.temporary_until <= today(7)).length + ' end in 7 days'} />
        <Kpi label="Linked to HR · this month" value={list.filter((x) => x.last_action === 'link' && (x.decided_at || '').slice(0, 7) === m).length} tone="leaf" note="meals moved, history kept" />
        <Kpi label="Rejected · this month" value={list.filter((x) => x.last_action === 'reject' && (x.decided_at || '').slice(0, 7) === m).length} />
      </div>
      {regs.loading && !regs.data ? <Loading /> : regs.error ? <Failed error={regs.error} retry={regs.reload} /> : <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div className="wcard" style={{ padding: '8px 8px 0' }}>
          <Tbl head={['Person', 'Typed ID', 'In HR?', 'Status']} hl={(i) => list[i]?.id === r?.id} empty="Nobody has registered on this site yet"
            rows={list.map((x) => [<button style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setSel(x.id)}><b>{x.p?.full_name}</b><div className="xs">{x.work_role || x.category || '–'} · {sec(x.section_id)} · {maskMobile(x.p?.mobile)} · {day(x.created_at)}</div></button>,
              x.typed_rcl_id || '–', <span className={'chip ' + HR[x.hr_result][1]} style={{ height: 24 }}>{x.hr_result === 'maybe' && x.hr_name ? 'Maybe · ' + x.hr_name : HR[x.hr_result][0]}</span>,
              <span className={'chip ' + (STATE[x.p?.state || '']?.[1] || '')} style={{ height: 24 }}>{STATE[x.p?.state || '']?.[0] || x.p?.state}{x.p?.state === 'temporary' ? ' · ' + day(x.p.temporary_until) : ''}</span>])} />
        </div>
        {r && <div className="wcard"><h3>{r.p?.full_name} · {r.code}</h3>
          <div className="col sm" style={{ gap: 8 }}>
            {[['WhatsApp', r.p?.mobile_verified_at ? 'verified ' + day(r.p.mobile_verified_at) + ' ' + time(r.p.mobile_verified_at) : 'not proved'], ['Typed employee code', (r.typed_rcl_id || '–') + ' · ' + HR[r.hr_result][0].toLowerCase()],
              ['Works with', r.works_with || (r.p?.kind === 'employee' ? 'RCL' : '–')], ['Site · section', (s.sites.find((x) => x.id === r.site_id)?.code || '–') + ' · ' + sec(r.section_id)],
              ['Category · work', (r.category || '–') + ' · ' + (r.work_role || '–')], ['Last step', (r.last_action || '–') + (r.reason ? ' · ' + r.reason : '')]].map(([k, v]) =>
              <div key={k} className="row"><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v}</b></div>)}
            {r.info_asked && <div className="row"><span className="sp">Asked: {r.info_asked}</span><b style={{ color: 'var(--ink)' }}>{r.info_answer || 'no answer yet'}</b></div>}
            {r.photo_path && <button className="wbtn" onClick={() => void photo(r.photo_path!)}><Icon name="eye" size={16} />His photo</button>}
          </div>
          <div className="hr" style={{ margin: '14px 0' }} />
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}><button className="wbtn pri" style={{ flex: 1 }} onClick={() => act('verify')} disabled={a.busy}><Icon name="user-check" size={16} />Verify as employee</button><button className="wbtn" style={{ flex: 1 }} onClick={() => act('ask_hr')} disabled={a.busy}><Icon name="id-card" size={16} />Ask HR to add him</button></div>
            <div className="row" style={{ gap: 8 }}><Input value={f.rcl} onChange={(v) => { setF({ ...f, rcl: v.toUpperCase() }); setHr(null); }} placeholder="Employee code from HR" /><button className="wbtn" onClick={look} disabled={!f.rcl || a.busy}>Look up</button></div>
            {hr && <div className="row sm" style={{ gap: 8 }}><span className="sp">{hr.result === 'found' ? 'HR: ' + hr.name + (hr.designation ? ' · ' + hr.designation : '') : hr.result === 'not_checked' ? 'HR is not connected yet – check the ID with HR yourself.' : 'HR does not know this ID.'}</span>
              {(hr.result === 'found' || hr.result === 'not_checked') && <button className="wbtn" onClick={() => act('link', { rcl_id: f.rcl })} disabled={a.busy}><Icon name="users" size={16} />Link to HR record</button>}</div>}
            <div className="row" style={{ gap: 8 }}><select className="winp" style={{ flex: 1 }} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} aria-label="Section"><option value="">Section</option>{(secs.data || []).map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select><button className="wbtn" onClick={() => act('section', { site, section: f.section })} disabled={!f.section || a.busy}><Icon name="map-pin" size={16} />Site and section</button></div>
            <div className="row" style={{ gap: 8 }}><input className="winp" style={{ flex: 1 }} type="date" min={today()} max={today(30)} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} aria-label="Temporary till" /><button className="wbtn" onClick={() => act('temporary', { until: f.until })} disabled={a.busy}><Icon name="clock" size={16} />Temporary till a date</button></div>
            <div className="row" style={{ gap: 8 }}><Input value={f.question} onChange={(v) => setF({ ...f, question: v })} placeholder="What to ask him" /><button className="wbtn" onClick={() => act('info', { question: f.question })} disabled={!f.question.trim() || a.busy}><Icon name="message-circle" size={16} />Ask for details</button></div>
            <Input value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder="Reason (needed to reject, suspend or release)" />
            <div className="row" style={{ gap: 8 }}><button className="wbtn" style={{ flex: 1, color: 'var(--red)' }} onClick={() => act('reject')} disabled={!f.reason.trim() || a.busy}><Icon name="x" size={16} />Reject</button>
              {r.p?.state === 'suspended' ? <button className="wbtn" style={{ flex: 1 }} onClick={() => act('release')} disabled={!f.reason.trim() || a.busy}><Icon name="rotate-ccw" size={16} />Release</button>
                : <button className="wbtn" style={{ flex: 1, color: 'var(--red)' }} onClick={() => act('suspend')} disabled={!f.reason.trim() || a.busy}><Icon name="shield-alert" size={16} />Suspend</button>}</div>
            <ErrorLine error={a.error} />
          </div>
        </div>}
      </div>}
      <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">No employee code is ever made here – it comes from HR. Linking keeps one person: his meals and history move with him.</span></div>
    </Web>
  );
}

// ── w17 · guests ──
interface Guest { id: string; full_name: string; mobile: string | null; mobile_verified_at: string | null; state: string; created_at: string; guest_profiles: { guest_code: string; organisation: string | null; designation: string | null } | null }
export function Guests() {
  const list = useLoad(() => rows<Guest>(db().from('people').select('id,full_name,mobile,mobile_verified_at,state,created_at,guest_profiles(guest_code,organisation,designation)').eq('kind', 'guest').order('full_name')), []);
  const [sel, setSel] = useState('');
  const [find, setFind] = useState('');
  const shown = (list.data || []).filter((g) => !find || (g.full_name + ' ' + (g.guest_profiles?.guest_code || '') + ' ' + (g.mobile || '')).toLowerCase().includes(find.toLowerCase()));
  const g = shown.find((x) => x.id === sel) || shown[0];
  const visits = useLoad(() => g ? rows<{ id: string; purpose: string; host_role: string | null; started_at: string; ended_at: string | null; sites: { code: string } | null; sections: { code: string } | null; host: { full_name: string } | null }>(db().from('guest_visits').select('id,purpose,host_role,started_at,ended_at,sites(code),sections(code),host:people!guest_visits_host_id_fkey(full_name)').eq('person_id', g.id).order('started_at', { ascending: false })) : Promise.resolve([]), [g?.id]);
  const orders = useLoad(() => g ? rows<{ id: string; guest_visit_id: string | null; kind: string; state: string; order_lines: { meal: string | null; is_meal: boolean; qty: number; state: string }[] }>(db().from('orders').select('id,guest_visit_id,kind,state,order_lines(meal,is_meal,qty,state)').eq('requested_by', g.id)) : Promise.resolve([]), [g?.id]);
  const reg = useLoad(() => g ? rows<{ id: string; site_id: string | null }>(db().from('registrations').select('id,site_id').eq('person_id', g.id).order('created_at', { ascending: false }).limit(1)) : Promise.resolve([]), [g?.id]);
  const [reason, setReason] = useState('');
  const a = useAct();
  const ofVisit = (v: string) => (orders.data || []).filter((o) => o.guest_visit_id === v);
  const meals = (orders.data || []).reduce((t, o) => t + o.order_lines.filter((l) => l.is_meal && l.state !== 'cancelled').length, 0);
  const parcels = (orders.data || []).filter((o) => o.kind !== 'meal').length;
  const vs = visits.data || [];
  const suspend = (release: boolean) => a.run(async () => { await call('decide_registration', { p_reg: reg.data![0].id, p_action: release ? 'release' : 'suspend', p_reason: reason }); setReason(''); list.reload(); });
  const excel = () => csv('FALCON guest ' + (g?.guest_profiles?.guest_code || ''), ['Visit', 'Date', 'Site', 'Section', 'Purpose', 'Host', 'Orders', 'Meals'],
    vs.map((v, i) => [vs.length - i, day(v.started_at), v.sites?.code, v.sections?.code, v.purpose, v.host?.full_name || v.host_role, ofVisit(v.id).length, ofVisit(v.id).reduce((t, o) => t + o.order_lines.filter((l) => l.is_meal).length, 0)]));
  return (
    <Web title={g ? 'Guest · ' + g.full_name : 'Guests'} roles={['system_admin', 'site_admin', 'management', 'accounts']}
      actions={<><Input value={find} onChange={setFind} placeholder="Find a guest" />{g?.guest_profiles && <span className="chip plum" style={{ height: 30 }}>{g.guest_profiles.guest_code}</span>}<button className="wbtn" onClick={excel} disabled={!g}><Icon name="download" size={16} />Visits in Excel</button></>}>
      {list.loading && !list.data ? <Loading /> : list.error ? <Failed error={list.error} retry={list.reload} /> : !g ? <div className="wcard sm">No guest yet. A guest registers himself with his WhatsApp code; his host approves his meals.</div> : <>
        <div className="row wrap" style={{ gap: 6 }}>{shown.slice(0, 30).map((x) => <button key={x.id} className={'chip' + (x.id === g.id ? ' plum' : '')} onClick={() => setSel(x.id)}>{x.full_name}</button>)}</div>
        <div className="g2" style={{ gridTemplateColumns: 'minmax(0,.9fr) minmax(0,2fr)' }}>
          <div className="wcard">
            <div className="row" style={{ gap: 14 }}><div className="av lg plum">{initials(g.full_name)}</div><div className="sp"><b style={{ fontSize: 18 }}>{g.full_name}</b><div className="xs">{[g.guest_profiles?.designation, g.guest_profiles?.organisation].filter(Boolean).join(' · ') || '–'}</div></div></div>
            <div className="col sm" style={{ gap: 8, marginTop: 16 }}>
              {[['Mobile', maskMobile(g.mobile)], ['WhatsApp code', g.mobile_verified_at ? day(g.mobile_verified_at) + ' ' + time(g.mobile_verified_at) : 'not proved'], ['Guest since', day(g.created_at)],
                ['Visits · meals · parcels', vs.length + ' · ' + meals + ' · ' + parcels], ['Who pays', 'the host\'s site · guest rate'], ['Status', STATE[g.state]?.[0] || g.state]].map(([k, v]) =>
                <div key={k} className="row"><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v}</b></div>)}
            </div>
            <div className="hr" style={{ margin: '14px 0' }} />
            {reg.data?.[0] ? <div className="col" style={{ gap: 8 }}><Input value={reason} onChange={setReason} placeholder="Reason" />
              <button className="wbtn" style={{ color: g.state === 'suspended' ? undefined : 'var(--red)' }} onClick={() => suspend(g.state === 'suspended')} disabled={!reason.trim() || a.busy}><Icon name={g.state === 'suspended' ? 'rotate-ccw' : 'shield-alert'} size={16} />{g.state === 'suspended' ? 'Release' : 'Suspend'}</button></div>
              : <div className="xs">No registration of his is open to you.</div>}
            <ErrorLine error={a.error} />
          </div>
          <div className="wcard" style={{ padding: '8px 8px 0' }}>
            <Tbl head={['Visit', 'Site · place', 'Purpose · host', 'Orders']} hl={(i) => !vs[i]?.ended_at} empty="No visit yet"
              rows={vs.map((v, i) => [<><b>{vs.length - i}</b><div className="xs">{day(v.started_at)}</div></>, (v.sites?.code || '') + ' · ' + (v.sections?.code || '–'), v.purpose + ' · ' + (v.host?.full_name || v.host_role || '–'),
                ofVisit(v.id).length ? ofVisit(v.id).map((o) => o.order_lines.filter((l) => l.is_meal).map((l) => mealName(l.meal || '')).join(', ') + (o.kind !== 'meal' ? ' · parcel' : '') + (o.state === 'cancelled' ? ' · cancelled' : '')).join(' / ') : '–'])} />
          </div>
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">One profile for every visit – the same mobile cannot make a second one. A known phone only suggests the profile; a WhatsApp code is asked on a new phone or after 30 days. The guest sees only his own visits and orders.</span></div>
      </>}
    </Web>
  );
}

// ── people and roles ──
const ROLES: { role: Role; label: string }[] = [
  { role: 'employee', label: 'Employee' }, { role: 'mess_owner', label: 'Mess owner' }, { role: 'mess_operator', label: 'Mess operator' },
  { role: 'mess_supervisor', label: 'Mess supervisor' }, { role: 'driver', label: 'Driver' }, { role: 'site_admin', label: 'Site Admin' },
  { role: 'accounts', label: 'Accounts' }, { role: 'management', label: 'Management' }, { role: 'system_admin', label: 'System Admin' }];
interface Person { id: string; full_name: string; mobile: string | null; kind: string; state: string; rcl_id: string | null; work_role: string | null; may_group: boolean }
interface Grant { id: string; person_id: string; role: Role; site_id: string | null; mess_id: string | null; valid_from: string; valid_to: string | null; revoked_at: string | null }
export function PeopleRoles() {
  const s = useSession();
  const [site, setSite] = useState(s.sites[0]?.id || '');
  const [find, setFind] = useState('');
  const people = useLoad(() => site ? rows<Person>(db().from('people').select('id,full_name,mobile,kind,state,rcl_id,work_role,may_group').eq('home_site_id', site).order('full_name').limit(1000)) : Promise.resolve([]), [site]);
  const grants = useLoad(() => rows<Grant>(db().from('role_grants').select('id,person_id,role,site_id,mess_id,valid_from,valid_to,revoked_at').is('revoked_at', null)), [site]);
  const messes = useLoad(() => rows<{ id: string; name: string; site_id: string } & Dated>(db().from('messes').select('id,name,site_id,active,valid_from,valid_to,removed_at')), []);
  const vans = useLoad(() => rows<{ id: string; reg_no: string; kind: string; capacity: number | null; site_id: string | null; active: boolean }>(db().from('vehicles').select('*').order('reg_no')), []);
  const [sel, setSel] = useState('');
  const shown = (people.data || []).filter((p) => !find || (p.full_name + ' ' + (p.mobile || '') + ' ' + (p.rcl_id || '')).toLowerCase().includes(find.toLowerCase()));
  const p = shown.find((x) => x.id === sel) || shown[0];
  const [g, setG] = useState({ role: 'employee' as Role, every: false, mess: '', from: today(), to: '' });
  const [why, setWhy] = useState('');
  const [np, setNp] = useState({ name: '', mobile: '', work: '' });
  const [nv, setNv] = useState({ reg: '', kind: 'Van', cap: '' });
  const a = useAct();
  const sysadm = s.has('system_admin');
  const his = (grants.data || []).filter((x) => x.person_id === p?.id);
  const give = () => a.run(async () => { await call('grant_role', { p_person: p!.id, p_role: g.role, p_site: g.every ? null : site, p_mess: ['mess_owner', 'mess_operator'].includes(g.role) ? g.mess : null, p_from: g.from, p_to: g.to || null }); grants.reload(); });
  const take = (id: string) => a.run(async () => { if (!why.trim()) throw new Error('Write the reason first.'); await call('revoke_role', { p_grant: id, p_reason: why }); setWhy(''); grants.reload(); });
  const group = () => a.run(async () => { await call('allow_group', { p_person: p!.id, p_allow: !p!.may_group }); people.reload(); });
  // (23-11-2026, his picture: "duplicate key value violates unique constraint people_company_id_mobile_key") a mobile that is already a
  // person of FALCON is never added twice: he is found and opened – on his own site – and the page says who he is; the role is given there
  const addP = () => a.run(async () => {
    const mobile = '+91' + np.mobile.replace(/\D/g, '').slice(-10);
    const { data: have } = await db().from('people').select('id,full_name,kind,home_site_id,state').eq('mobile', mobile).limit(1);
    const h = (have || [])[0] as { id: string; full_name: string; kind: string; home_site_id: string | null; state: string } | undefined;
    if (h) {
      const at = s.sites.find((x) => x.id === h.home_site_id);
      if (at) { setSite(at.id); setFind(''); setSel(h.id); }
      throw new Error('This mobile is already in FALCON: ' + h.full_name + ' (' + h.kind.replace(/_/g, ' ') + (at ? ', ' + at.code : '') + ', ' + h.state + ')' +
        (at ? ' – opened on the right: give him his role there.' : ' – he is not on a site you see; the System Admin gives his role.'));
    }
    try {
      const id = await call<string>('add_contractor_person', { p_full_name: np.name, p_mobile: mobile, p_site: site, p_work_role: np.work || null });
      setNp({ name: '', mobile: '', work: '' }); people.reload(); setSel(id);
    } catch (e) {
      if (/people_company_id_mobile_key/.test(String((e as Error)?.message || e))) throw new Error('This mobile is already with another person in FALCON (one you do not see) – the System Admin finds him in People and gives the role.');
      throw e;
    }
  });
  const addV = () => a.run(async () => { const { error } = await db().from('vehicles').insert({ company_id: s.me!.company_id, site_id: site, reg_no: nv.reg.toUpperCase(), kind: nv.kind, capacity: nv.cap ? Number(nv.cap) : null }); if (error) throw new Error(error.message); setNv({ reg: '', kind: 'Van', cap: '' }); vans.reload(); });
  const siteCode = (id: string | null) => (id ? s.sites.find((x) => x.id === id)?.code : 'every site');
  return (
    <Web title="People and roles" roles={['system_admin', 'site_admin']} actions={<><SitePick value={site} onChange={setSite} /><Input value={find} onChange={setFind} placeholder="Name, mobile or employee code" /></>}>
      {people.loading && !people.data ? <Loading /> : people.error ? <Failed error={people.error} retry={people.reload} /> : <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="wcard" style={{ padding: '8px 8px 0' }}>
          <Tbl head={['Person', 'Kind', 'Status', 'Roles']} hl={(i) => shown[i]?.id === p?.id} empty="Nobody on this site yet"
            rows={shown.slice(0, 300).map((x) => [<button style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setSel(x.id)}><b>{x.full_name}</b><div className="xs">{x.rcl_id || maskMobile(x.mobile)}{x.work_role ? ' · ' + x.work_role : ''}</div></button>,
              x.kind.replace('_', ' '), <span className={'chip ' + (STATE[x.state]?.[1] || '')} style={{ height: 24 }}>{STATE[x.state]?.[0] || x.state}</span>,
              (grants.data || []).filter((y) => y.person_id === x.id).map((y) => ROLES.find((r) => r.role === y.role)?.label).join(', ') || '–'])} />
        </div>
        {p && <div className="wcard"><h3>{p.full_name}</h3>
          <div className="col sm" style={{ gap: 6 }}>{his.length === 0 && <span className="xs">No role yet.</span>}
            {his.map((x) => <div key={x.id} className="row" style={{ gap: 8 }}><span className="sp"><b style={{ color: 'var(--ink)' }}>{ROLES.find((r) => r.role === x.role)?.label}</b> · {siteCode(x.site_id)}{x.mess_id ? ' · ' + (messes.data || []).find((m) => m.id === x.mess_id)?.name : ''} · from {day(x.valid_from)}{x.valid_to ? ' to ' + day(x.valid_to) : ''}</span>
              {sysadm && x.person_id !== s.me?.id && <button className="chip" onClick={() => take(x.id)}>Take away</button>}</div>)}
            {sysadm && his.length > 0 && <Input value={why} onChange={setWhy} placeholder="Reason to take a role away" />}
          </div>
          {sysadm && p.id !== s.me?.id && <><div className="hr" style={{ margin: '12px 0' }} /><h3>Give a role</h3><div className="col" style={{ gap: 8 }}>
            <select className="winp" value={g.role} onChange={(e) => setG({ ...g, role: e.target.value as Role })} aria-label="Role">{ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select>
            {['mess_owner', 'mess_operator'].includes(g.role) ? <select className="winp" value={g.mess} onChange={(e) => setG({ ...g, mess: e.target.value })} aria-label="Mess"><option value="">Mess</option>{(messes.data || []).filter((m) => m.site_id === site && listed(m)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              : <label className="row sm" style={{ gap: 8 }}><input type="checkbox" checked={g.every} onChange={(e) => setG({ ...g, every: e.target.checked })} />Every site (not only {siteCode(site)})</label>}
            <div className="row" style={{ gap: 8 }}><input className="winp" type="date" value={g.from} onChange={(e) => setG({ ...g, from: e.target.value })} aria-label="From" /><input className="winp" type="date" value={g.to} onChange={(e) => setG({ ...g, to: e.target.value })} aria-label="Till (empty: no end)" /></div>
            <button className="wbtn pri" onClick={give} disabled={a.busy || (['mess_owner', 'mess_operator'].includes(g.role) && !g.mess)}><Icon name="plus" size={16} />Give the role</button></div></>}
          {p.kind === 'employee' && <><div className="hr" style={{ margin: '12px 0' }} /><div className="row sm"><span className="sp">Asks meals for others (group request)</span><button className="wbtn" onClick={group} disabled={a.busy}>{p.may_group ? 'Allowed · take back' : 'Allow'}</button></div></>}
          <ErrorLine error={a.error} />
        </div>}
      </div>}
      <div className="g2">
        <div className="wcard"><h3>Add a contractor's person</h3><div className="row wrap" style={{ gap: 8 }}><Input value={np.name} onChange={(v) => setNp({ ...np, name: v })} placeholder="Full name" /><Input value={np.mobile} onChange={(v) => setNp({ ...np, mobile: v })} placeholder="WhatsApp mobile" inputMode="tel" /><Input value={np.work} onChange={(v) => setNp({ ...np, work: v })} placeholder="Work (cook, driver …)" />
          <button className="wbtn pri" onClick={addP} disabled={!np.name || np.mobile.replace(/\D/g, '').length < 10 || a.busy}><Icon name="plus" size={16} />Add</button></div>
          <div className="xs" style={{ marginTop: 8 }}>He signs in with the WhatsApp code of this mobile; then give him his role (mess owner, operator, driver).</div></div>
        <div className="wcard"><h3>Vans</h3>
          <Tbl head={['Number', 'Kind', 'Boxes', 'Site']} rows={(vans.data || []).map((v) => [<b>{v.reg_no}</b>, v.kind, num(v.capacity), siteCode(v.site_id)])} empty="No van yet" />
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}><Input value={nv.reg} onChange={(v) => setNv({ ...nv, reg: v })} placeholder="MH 09 AB 1234" /><Input value={nv.kind} onChange={(v) => setNv({ ...nv, kind: v })} placeholder="Kind" /><Input value={nv.cap} onChange={(v) => setNv({ ...nv, cap: v })} placeholder="Hot boxes" inputMode="numeric" />
            <button className="wbtn" onClick={addV} disabled={!nv.reg || a.busy}><Icon name="plus" size={16} />Add van</button></div></div>
      </div>
    </Web>
  );
}

// ── settings ──
// A complaint's answer time is one setting with two values: {"serious": minutes, "normal": minutes} (0005 reply_minutes).
const REPLY = 'complaint.reply_minutes';
const KEYS: { key: string; label: string; unit: string; def: number | string }[] = [
  { key: REPLY, label: 'A complaint is answered within (serious / other)', unit: 'minutes', def: '60 / 360' },
  { key: 'delivery.late_minutes', label: 'A van is late after its time by more than', unit: 'minutes', def: 30 },
  { key: 'delivery.speed_kmh', label: 'Van speed for the suggested route times', unit: 'km/h', def: 30 },
  { key: 'delivery.stop_minutes', label: 'Minutes a stop for the suggested route times', unit: 'minutes', def: 4 },
  { key: 'scorecard.w_rating', label: 'Scorecard weight · ratings', unit: 'points', def: 25 },
  { key: 'scorecard.w_time', label: 'Scorecard weight · on time', unit: 'points', def: 25 },
  { key: 'scorecard.w_complaints', label: 'Scorecard weight · complaints found true', unit: 'points', def: 20 },
  { key: 'scorecard.w_billing', label: 'Scorecard weight · billing accuracy', unit: 'points', def: 15 },
  { key: 'scorecard.w_papers', label: 'Scorecard weight · documents valid', unit: 'points', def: 15 }];
export function Settings() {
  const s = useSession();
  const items = useLoad(() => rows<{ id: string; code: string; name: string; kind: string; meal: string | null; unit: string; active: boolean }>(db().from('items').select('*').order('kind').order('code')), []);
  const sets = useLoad(() => rows<{ id: string; key: string; value: unknown; valid_from: string; valid_to: string | null; note: string | null }>(db().from('settings').select('id,key,value,valid_from,valid_to,note').is('site_id', null).order('key').order('valid_from', { ascending: false })), []);
  const taxes = useLoad(() => s.has(['accounts', 'system_admin', 'management', 'site_admin']) ? rows<{ id: string; tax: string; applies_to: string; section: string | null; rate: number; valid_from: string; valid_to: string | null; checked_by_ca: boolean; ca_note: string | null }>(db().from('tax_rules').select('*').order('tax').order('valid_from', { ascending: false })) : Promise.resolve([]), []);
  const [it, setIt] = useState({ code: '', name: '', kind: 'extra', meal: 'lunch', unit: 'each' });
  const [st, setSt] = useState({ key: KEYS[0]!.key, value: '', other: '', from: today(1), note: '' });
  const [tx, setTx] = useState({ tax: 'gst', applies: 'mess_services', section: '', rate: '', from: '', ca: false, note: '' });
  const a = useAct();
  const sysadm = s.has('system_admin');
  const acc = s.has('accounts');
  const addItem = () => a.run(async () => { const { error } = await db().from('items').insert({ company_id: s.me!.company_id, code: it.code, name: it.name, kind: it.kind, meal: it.kind === 'meal' ? it.meal : null, unit: it.unit }); if (error) throw new Error(error.message); setIt({ ...it, code: '', name: '' }); items.reload(); });
  const flip = (id: string, active: boolean) => a.run(async () => { const { error } = await db().from('items').update({ active: !active }).eq('id', id); if (error) throw new Error(error.message); items.reload(); });
  const setOne = () => a.run(async () => {
    const n = Number(st.value), o = Number(st.other);
    if (!Number.isFinite(n) || n < 0 || (st.key === REPLY && (!Number.isFinite(o) || o < 0))) throw new Error('Write a number.');
    await call('set_setting', { p_key: st.key, p_value: st.key === REPLY ? { serious: n, normal: o } : n, p_from: st.from, p_note: st.note || null });
    setSt({ ...st, value: '', other: '', note: '' }); sets.reload();
  });
  const shown = (key: string, v: unknown) => (v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => (k === 'normal' ? 'other' : k) + ' ' + x).join(' · ') : String(v)) + ' ' + (KEYS.find((k) => k.key === key)?.unit || '');
  const addTax = () => a.run(async () => {
    const cur = (taxes.data || []).find((x) => x.tax === tx.tax && x.applies_to === tx.applies && !x.valid_to);
    if (cur && cur.valid_from >= tx.from) throw new Error('The new rule must start after ' + day(cur.valid_from) + '.');
    if (cur) { const prev = new Date(tx.from + 'T12:00:00+05:30'); prev.setDate(prev.getDate() - 1); const { error } = await db().from('tax_rules').update({ valid_to: prev.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }).eq('id', cur.id); if (error) throw new Error(error.message); }
    const { error } = await db().from('tax_rules').insert({ company_id: s.me!.company_id, tax: tx.tax, applies_to: tx.applies, section: tx.section || null, rate: Number(tx.rate), valid_from: tx.from, checked_by_ca: tx.ca, ca_note: tx.note || null, set_by: s.me!.id });
    if (error) throw new Error(error.message); taxes.reload();
  });
  return (
    <Web title="Settings" roles={['system_admin', 'accounts']}>
      <ErrorLine error={a.error} />
      <div className="g2">
        <div className="wcard"><h3>Dated settings</h3>
          <Tbl head={['Setting', 'Value', 'From', 'Till']} rows={(sets.data || []).map((x) => [KEYS.find((k) => k.key === x.key)?.label || x.key, shown(x.key, x.value), day(x.valid_from), x.valid_to ? day(x.valid_to) : '–'])}
            empty="Nothing set yet – the values below are used until one is set" />
          <div className="xs" style={{ marginTop: 6 }}>Until set: {KEYS.map((k) => k.label.toLowerCase() + ' ' + k.def + ' ' + k.unit).join(' · ')}.</div>
          {sysadm && <div className="row wrap" style={{ gap: 8, marginTop: 10 }}><select className="winp" value={st.key} onChange={(e) => setSt({ ...st, key: e.target.value })} aria-label="Setting">{KEYS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
            <Input value={st.value} onChange={(v) => setSt({ ...st, value: v })} placeholder={st.key === REPLY ? 'Serious · minutes' : KEYS.find((k) => k.key === st.key)?.unit || 'Value'} inputMode="numeric" />
            {st.key === REPLY && <Input value={st.other} onChange={(v) => setSt({ ...st, other: v })} placeholder="Other · minutes" inputMode="numeric" />}<input className="winp" type="date" min={today()} value={st.from} onChange={(e) => setSt({ ...st, from: e.target.value })} aria-label="From" /><Input value={st.note} onChange={(v) => setSt({ ...st, note: v })} placeholder="Note" />
            <button className="wbtn pri" onClick={setOne} disabled={!st.value || (st.key === REPLY && !st.other) || a.busy}>New value from this date</button></div>}
        </div>
        <div className="wcard"><h3>GST and TDS – Accounts' rules with dates</h3>
          <Tbl head={['Tax', 'For', 'Section', 'Rate', 'From', 'Till', 'CA']} right={[3]} rows={(taxes.data || []).map((x) => [x.tax.toUpperCase(), x.applies_to.replace('_', ' '), x.section || '–', x.rate + '%', day(x.valid_from), x.valid_to ? day(x.valid_to) : '–', x.checked_by_ca ? <span className="chip leaf" style={{ height: 24 }}>checked</span> : <span className="chip amber" style={{ height: 24 }}>not yet</span>])} empty="No rule yet – a bill cannot be made without the GST rule and the TDS rule of the contractor's kind" />
          {acc && <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <select className="winp" value={tx.tax} onChange={(e) => setTx({ ...tx, tax: e.target.value, applies: e.target.value === 'gst' ? 'mess_services' : 'proprietor' })} aria-label="Tax"><option value="gst">GST</option><option value="tds">TDS</option></select>
            <select className="winp" value={tx.applies} onChange={(e) => setTx({ ...tx, applies: e.target.value })} aria-label="For">{(tx.tax === 'gst' ? ['mess_services'] : ['proprietor', 'partnership', 'llp', 'company', 'other']).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select>
            <Input value={tx.section} onChange={(v) => setTx({ ...tx, section: v })} placeholder="Section (194C)" /><Input value={tx.rate} onChange={(v) => setTx({ ...tx, rate: v })} placeholder="Rate %" inputMode="numeric" />
            <input className="winp" type="date" value={tx.from} onChange={(e) => setTx({ ...tx, from: e.target.value })} aria-label="From" />
            <label className="row sm" style={{ gap: 6 }}><input type="checkbox" checked={tx.ca} onChange={(e) => setTx({ ...tx, ca: e.target.checked })} />Checked by the CA</label><Input value={tx.note} onChange={(v) => setTx({ ...tx, note: v })} placeholder="CA's note" />
            <button className="wbtn pri" onClick={addTax} disabled={!tx.rate || !tx.from || a.busy}>Add the rule</button></div>}
          <div className="xs" style={{ marginTop: 8 }}>No rate is written in the program. A rule ends the day before the next one starts; the old ones stay.</div>
        </div>
      </div>
      <div className="wcard"><h3>What a mess sells – the lines of a bill</h3>
        {items.loading && !items.data ? <Loading /> : <Tbl head={['Code', 'Name', 'Kind', 'Meal', 'Unit', '']} rows={(items.data || []).map((x) => [<b>{x.code}</b>, x.name, x.kind, x.meal ? mealName(x.meal) : '–', x.unit,
          sysadm ? <button className="chip" onClick={() => flip(x.id, x.active)}>{x.active ? 'In use · stop' : 'Stopped · use again'}</button> : x.active ? 'in use' : 'stopped'])} />}
        {sysadm && <div className="row wrap" style={{ gap: 8, marginTop: 10 }}><Input value={it.code} onChange={(v) => setIt({ ...it, code: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="code (water_1l)" /><Input value={it.name} onChange={(v) => setIt({ ...it, name: v })} placeholder="Name" />
          <select className="winp" value={it.kind} onChange={(e) => setIt({ ...it, kind: e.target.value })} aria-label="Kind"><option value="meal">meal</option><option value="extra">extra</option><option value="service">service</option></select>
          {it.kind === 'meal' && <select className="winp" value={it.meal} onChange={(e) => setIt({ ...it, meal: e.target.value })} aria-label="Meal">{MEALS.map((m) => <option key={m} value={m}>{mealName(m)}</option>)}</select>}
          <Input value={it.unit} onChange={(v) => setIt({ ...it, unit: v })} placeholder="Unit" />
          <button className="wbtn pri" onClick={addItem} disabled={!it.code || !it.name || a.busy}><Icon name="plus" size={16} />Add item</button></div>}
        <div className="xs" style={{ marginTop: 8 }}>A meal's code is its meal (breakfast, lunch, snacks, dinner); "guest_meal" and "parcel_packing" must be there before the first bill.</div>
      </div>
    </Web>
  );
}

// ── (23-11-2026) Employees from HR – every site; copied every hour; the System Admin may bring it now ──
interface HrRow { rcl_id: string | null; full_name: string; designation: string | null; category: string | null; site_code: string | null; mobile: string | null; status: string; left_on: string | null; gone: boolean; in_falcon: string | null }
interface HrStatus { last: { at: string; ok: boolean; how: string; total: number; added: number; changed: number; gone: number; stopped: number; released: number; new_sites: string[]; message: string | null } | null; last_ok: string | null;
  sites: { site: string | null; active: number; left: number; other: number; in_falcon: number }[] }
export function HrPeople() {
  const s = useSession();
  const [site, setSite] = useState('');
  const [find, setFind] = useState('');
  const st = useLoad(() => call<HrStatus | null>('office_hr_status'), []);
  const list = useLoad(() => call<HrRow[]>('office_hr_people', { p_site: site || null, p_find: find.trim() || null, p_limit: 500 }), [site, find]);
  const a = useAct();
  const now = () => a.run(async () => { await api('/api/hr-sync', {}); st.reload(); list.reload(); });
  const l = st.data?.last;
  const sites = st.data?.sites || [];
  const tone = (x: HrRow) => (x.gone || x.status === 'left' ? 'red' : x.status === 'active' || x.status === 'pending' ? 'leaf' : 'amber');
  return (
    <Web title="Employees from HR" roles={['system_admin', 'site_admin', 'management']}
      actions={<><select className="wbtn" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site"><option value="">All sites</option>{sites.map((x) => <option key={x.site || '-'} value={x.site || ''}>{x.site || '(no site)'}</option>)}</select>
        <Input value={find} onChange={setFind} placeholder="Name or employee code" />
        {s.has('system_admin') && <button className="wbtn pri" onClick={now} disabled={a.busy}><Icon name="refresh-cw" size={16} />Bring from HR now</button>}</>}>
      <ErrorLine error={a.error} />
      {st.error ? <Failed error={st.error} retry={st.reload} /> : <div className="kpis">
        <Kpi label="In HR · not left" value={numOf(sites.reduce((t, x) => t + x.active, 0))} note={sites.length + ' sites · ' + numOf(sites.reduce((t, x) => t + x.other, 0)) + ' not yet activated in HR'} tone="leaf" />
        <Kpi label="Already in FALCON" value={numOf(sites.reduce((t, x) => t + x.in_falcon, 0))} note="they sign in with their mobile" />
        <Kpi label="Left in HR" value={numOf(sites.reduce((t, x) => t + x.left, 0))} note="stopped in FALCON" tone="red" />
        <Kpi label="Last copy" value={st.data?.last_ok ? day(st.data.last_ok) + ' ' + time(st.data.last_ok) : 'not yet'} tone={l && !l.ok ? 'red' : 'muted'}
          note={l ? (l.ok ? '+' + l.added + ' new · ' + l.changed + ' changed' + (l.new_sites.length ? ' · new sites ' + l.new_sites.join(', ') : '') : 'last try failed: ' + (l.message || '')) : 'every hour, by itself'} />
      </div>}
      <div className="wcard" style={{ padding: '8px 8px 0' }}>
        {list.loading && !list.data ? <Loading /> : list.error ? <Failed error={list.error} retry={list.reload} /> :
          <Tbl head={['Employee code', 'Name', 'Designation', 'Site', 'Mobile', 'In HR', 'In FALCON']} empty={st.data?.last_ok ? 'Nobody matches' : 'HR\'s list has not come yet – it comes every hour once HR is connected (docs/DEPLOYMENT.md)'}
            rows={(list.data || []).map((x) => [<b>{x.rcl_id || '–'}</b>, x.full_name, x.designation || x.category || '–', x.site_code || '–', x.mobile || '–',
              <span className={'chip ' + tone(x)} style={{ height: 24 }}>{x.gone ? 'not in HR now' : x.status === 'left' ? 'Relieved ' + day(x.left_on) : HR_WORD[x.status] || x.status}</span>,
              x.in_falcon ? <span className={'chip ' + (x.in_falcon === 'suspended' ? 'red' : 'leaf')} style={{ height: 24 }}>{x.in_falcon}</span> : <span className="xs">signs in with his mobile</span>])} />}
      </div>
      <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">HR stays the master – nothing here changes HR. Only the employee code, name, designation, category, site, mobile and status come from HR; never birth date, e-mail, KYC, bank, pay or photo. Everybody in HR's list who has not left can sign in with his mobile – HR's "Incomplete" / "Complete" (not yet activated) is only shown. A new site of HR comes by itself; who left in HR cannot order meals.</span></div>
    </Web>
  );
}
const numOf = (n: number) => n.toLocaleString('en-IN');
// HR's own words for its statuses (rcl-hr public/hr.js STATUS) – FALCON shows what HR's pages show, never HR's inner names.
const HR_WORD: Record<string, string> = { incomplete: 'Incomplete', pending: 'Complete', active: 'Active', left: 'Relieved' };
