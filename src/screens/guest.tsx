// Boards g01–g03: a guest coming back (his one profile, today's visit with its purpose and host), his home, his visits and orders.
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { call, db, one, rows, useAct, useLoad } from '../lib/db';
import { useSession } from '../lib/session';
import { day, firstName, initials, maskMobile, mealName, time, today } from '../lib/fmt';
import { Icon } from '../ui/Icon';
import { Body, Btn, Empty, ErrorLine, Field, Input, Loading, Screen, Seg, Tabs, Top } from '../ui/kit';
import { GUEST_TABS, useGuestVisit, useMyMess, useWindows } from './employee';

interface Profile { guest_code: string; organisation: string | null; designation: string | null }
interface Visit { id: string; site_id: string; section_id: string | null; purpose: string; started_at: string; ended_at: string | null; host_role: string | null; host_id: string | null }

function useProfile() {
  const s = useSession();
  return useLoad(() => one<Profile>(db().from('guest_profiles').select('guest_code,organisation,designation').eq('person_id', s.me?.id || '').limit(1)), [s.me?.id]);
}
function useVisits() {
  const s = useSession();
  return useLoad(() => rows<Visit>(db().from('guest_visits').select('*').eq('person_id', s.me?.id || '').order('started_at', { ascending: false })), [s.me?.id], ['orders']);
}
const plum = 'linear-gradient(160deg,#3B2470,#5B2BA0)';

// ── g01 · Welcome back, guest ──
export function GuestWelcome() {
  const s = useSession();
  const nav = useNavigate();
  const prof = useProfile();
  const visits = useVisits();
  const [site, setSite] = useState(s.sites[0]?.id || '');
  const hosts = useLoad(() => site ? call<{ person_id: string; full_name: string; role: string }[]>('visit_hosts', { p_site: site }) : Promise.resolve([]), [site]);
  const [host, setHost] = useState('');
  const [purpose, setPurpose] = useState('');
  const a = useAct();
  const last = (visits.data || [])[0];
  const lastSite = s.sites.find((x) => x.id === last?.site_id);
  const start = () => a.run(async () => {
    if (purpose.trim().length < 2) throw new Error('Write the purpose of today\'s visit.');
    const h = (hosts.data || []).find((x) => x.person_id === host);
    await call('start_visit', { p_site: site, p_purpose: purpose.trim(), p_section: null, p_host: h?.person_id || null, p_host_role: h?.role || null });
    nav('/guest');
  });
  return (
    <Screen>
      <div style={{ background: plum, color: '#fff', padding: '40px 24px 30px', borderRadius: '0 0 32px 32px' }}>
        <div className="row" style={{ gap: 14 }}><div className="av lg" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}>{initials(s.me?.full_name)}</div>
          <div><span style={{ fontSize: 14, color: '#E1D4F7' }}>Guest</span><p style={{ margin: '2px 0 0', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>{visits.data?.length ? 'Welcome back, ' : 'Welcome, '}{firstName(s.me?.full_name)}</p></div></div>
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <span className="chip" style={{ height: 28, background: 'rgba(255,255,255,.14)', borderColor: 'transparent', color: '#fff' }}>Visit {(visits.data?.length || 0) + 1}</span>
          {last && <span className="chip" style={{ height: 28, background: 'rgba(255,255,255,.14)', borderColor: 'transparent', color: '#fff' }}>Last: {day(last.started_at)}{lastSite ? ' · ' + lastSite.code : ''}</span>}
        </div>
      </div>
      <Body style={{ gap: 14, paddingTop: 20 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b className="h2">Is this you?</b>
          <div className="row sm"><Icon name="user" size={16} /><span className="sp" style={{ color: 'var(--ink)' }}>{s.me?.full_name}{prof.data?.designation ? ' · ' + prof.data.designation : ''}</span></div>
          {prof.data?.organisation && <div className="row sm"><Icon name="building-2" size={16} /><span className="sp" style={{ color: 'var(--ink)' }}>{prof.data.organisation}</span></div>}
          <div className="row sm"><Icon name="phone" size={16} /><span className="sp" style={{ color: 'var(--ink)' }}>{maskMobile(s.me?.mobile)} · verified</span></div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Site"><select className="inp" value={site} onChange={(e) => { setSite(e.target.value); setHost(''); }} style={{ height: 46, font: 'inherit' }}>{s.sites.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field></div>
          <div style={{ flex: 1 }}><Field label="Host"><select className="inp" value={host} onChange={(e) => setHost(e.target.value)} style={{ height: 46, font: 'inherit' }}><option value="">No host</option>{(hosts.data || []).map((x) => <option key={x.person_id} value={x.person_id}>{x.full_name} · {x.role}</option>)}</select></Field></div>
        </div>
        <Field label="Today's visit – purpose"><Input value={purpose} onChange={setPurpose} placeholder="e.g. quality audit at B2" maxLength={200} /></Field>
        <div className="row sm" style={{ gap: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' }}><Icon name="shield-check" size={18} /><span className="sp">This phone only suggests your profile. A WhatsApp code is asked on a new phone or after 30 days.</span></div>
        <ErrorLine error={a.error} />
        <span className="sp" />
        <Btn style={{ background: '#5B2BA0' }} onClick={start} busy={a.busy}>Yes, it's me – start today's visit</Btn>
        <Btn kind="ghost" onClick={() => void s.signOut()} style={{ marginBottom: 26 }}>Not me</Btn>
      </Body>
    </Screen>
  );
}

// ── g02 · Guest home ──
export function GuestHome() {
  const s = useSession();
  const visit = useGuestVisit();
  const visits = useVisits();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const menu = useLoad(() => mess ? rows<{ meal: string; dishes: string[] }>(db().from('menus').select('meal,dishes').eq('mess_id', mess.id).eq('service_date', today())) : Promise.resolve([]), [mess?.id]);
  const orders = useLoad(() => visit.data ? rows<{ id: string; code: string; meal: string; kind: string; state: string; host_state: string; created_at: string }>(db().from('orders').select('id,code,meal,kind,state,host_state,created_at').eq('guest_visit_id', visit.data.id).order('created_at', { ascending: false })) : Promise.resolve([]), [visit.data?.id], ['orders']);
  if (visit.loading) return <Screen><Body><Loading /></Body></Screen>;
  if (!visit.data) return <Navigate to="/guest/welcome" replace />;
  const v = visit.data;
  const now = (wins.data || []).slice().sort((a, b) => a.serve_from.localeCompare(b.serve_from)).find((w) => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) <= w.serve_to.slice(0, 5));
  const site = s.sites.find((x) => x.id === v.site_id);
  return (
    <Screen>
      <Top left={<div className="av plum">{initials(s.me?.full_name)}</div>} title={s.me?.full_name || ''} sub={'Guest · visit ' + (visits.data?.length || 1) + ' · ' + (site?.code || '') + ' · today'}
        right={<Link className="ib" to="/guest/history" aria-label="My visits"><Icon name="history" /></Link>} />
      <Body style={{ gap: 14, paddingBottom: 100 }}>
        <div className="hero" style={{ background: plum }}>
          <div className="row"><span className="chip" style={{ height: 26, background: 'rgba(255,255,255,.16)', borderColor: 'transparent', color: '#fff' }}>{now ? mealName(now.meal) + ' · till ' + now.serve_to.slice(0, 5) : 'No meal open now'}</span></div>
          <p style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700 }}>What would you like?</p>
          <div className="xs" style={{ color: '#E1D4F7' }}>{(menu.data || []).find((x) => x.meal === now?.meal)?.dishes.join(', ') || 'The menu is shown when the mess publishes it'}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {[['/app/meal', 'utensils', 'leaf', 'At the mess'], ['/app/parcel', 'package', '', 'Parcel'], ['/app/section', 'truck', 'blue', 'Deliver to me']].map(([to, ic, cl, l]) => (
            <Link key={to} className="card" to={to!} style={{ padding: '14px 10px', textAlign: 'center', textDecoration: 'none', color: 'inherit' }}><div className={'tile ' + cl} style={{ margin: '0 auto' }}><Icon name={ic!} /></div><b style={{ display: 'block', fontSize: 14, marginTop: 8 }}>{l}</b></Link>))}
        </div>
        {(orders.data || []).map((o) => (
          <Link key={o.id} to={'/app/orders/' + o.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
            <div className="tile s40 cream"><Icon name="clock" /></div>
            <div className="sp"><b style={{ fontSize: 15 }}>{mealName(o.meal)} · {o.kind === 'meal' ? 'at the mess' : o.kind}</b><div className="xs">Asked {time(o.created_at)}{o.host_state === 'waiting' ? ' · waiting for the host\'s OK' : ''}</div></div>
            <span className={'chip ' + (o.host_state === 'waiting' || o.state === 'requested' ? 'amber' : o.state === 'delivered' ? 'leaf' : '')} style={{ height: 26 }}>{o.host_state === 'waiting' ? 'Waiting' : o.state}</span>
          </Link>))}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row"><b className="sp" style={{ fontSize: 15 }}>Today's visit</b><span className="xs">started {time(v.started_at)}</span></div>
          <div className="row sm"><Icon name="map-pin" size={16} /><span className="sp">{site ? site.code + ' · ' + site.name : ''} · {v.purpose}</span></div>
          <div className="row sm"><Icon name="user-check" size={16} /><span className="sp">{v.host_id ? 'Host: ' + (v.host_role || 'office') : 'No host – your orders go straight to the mess'}</span></div>
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">You see only your own visits and orders.</span></div>
      </Body>
      <Tabs tabs={GUEST_TABS} label="Guest" />
    </Screen>
  );
}

// ── g03 · My visits and orders ──
export function GuestHistory() {
  const s = useSession();
  const prof = useProfile();
  const visits = useVisits();
  const [tab, setTab] = useState<'visits' | 'orders' | 'complaints'>('visits');
  const orders = useLoad(() => rows<{ id: string; code: string; meal: string; kind: string; state: string; service_date: string; guest_visit_id: string | null }>(db().from('orders').select('id,code,meal,kind,state,service_date,guest_visit_id').order('created_at', { ascending: false }).limit(100)), [s.me?.id], ['orders']);
  const complaints = useLoad(() => rows<{ id: string; code: string; category: string; state: string; created_at: string }>(db().from('complaints').select('id,code,category,state,created_at').order('created_at', { ascending: false })), [s.me?.id]);
  const meals = (orders.data || []).filter((o) => o.state === 'delivered').length;
  const parcels = (orders.data || []).filter((o) => o.state === 'delivered' && o.kind !== 'meal').length;
  return (
    <Screen>
      <Top back="/guest" title="My visits" sub={'Guest ID ' + (prof.data?.guest_code || '–') + (visits.data?.length ? ' · since ' + day(visits.data[visits.data.length - 1]!.started_at) : '')} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {[['Visits', visits.data?.length || 0], ['Meals', meals], ['Parcels', parcels]].map(([l, n]) => <div key={l} className="card" style={{ padding: 12 }}><span className="xs">{l}</span><b className="num" style={{ display: 'block', fontSize: 24 }}>{n}</b></div>)}
        </div>
        <Seg value={tab} options={[{ v: 'visits', label: 'Visits' }, { v: 'orders', label: 'Orders' }, { v: 'complaints', label: 'Complaints' }]} onChange={setTab} />
        {tab === 'visits' && ((visits.data || []).length === 0 ? <Empty icon="history" title="No visits yet" /> : (visits.data || []).map((v, i, all) => {
          const site = s.sites.find((x) => x.id === v.site_id), mine = (orders.data || []).filter((o) => o.guest_visit_id === v.id);
          return <div key={v.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, ...(v.ended_at ? {} : { border: '2px solid #C9B4EF' }) }}>
            <div className="row"><b className="sp" style={{ fontSize: 15 }}>Visit {all.length - i} · {v.ended_at ? day(v.started_at) : 'today'}</b>{v.ended_at ? <span className="xs">{site?.code}</span> : <span className="chip plum" style={{ height: 24 }}>Open</span>}</div>
            <div className="row xs" style={{ gap: 6, flexWrap: 'wrap' }}><span className="sp">{site?.code} · {v.purpose}</span>{mine.map((o) => <span key={o.id} className="tag">{mealName(o.meal)}{o.kind !== 'meal' ? ' · ' + o.kind : ''}</span>)}</div>
          </div>;
        }))}
        {tab === 'orders' && ((orders.data || []).length === 0 ? <Empty icon="receipt" title="No orders yet" /> : (orders.data || []).map((o) => <Link key={o.id} to={'/app/orders/' + o.id} className="card" style={{ padding: 12, display: 'flex', gap: 10, textDecoration: 'none', color: 'inherit' }}><b className="sp" style={{ fontSize: 14 }}>{o.code} · {mealName(o.meal)}</b><span className="xs">{day(o.service_date)} · {o.state}</span></Link>))}
        {tab === 'complaints' && ((complaints.data || []).length === 0 ? <Empty icon="message-square-warning" title="No complaints" /> : (complaints.data || []).map((c) => <Link key={c.id} to={'/app/complaints/' + c.id} className="card" style={{ padding: 12, display: 'flex', gap: 10, textDecoration: 'none', color: 'inherit' }}><b className="sp" style={{ fontSize: 14 }}>{c.code} · {c.category}</b><span className="xs">{day(c.created_at)} · {c.state}</span></Link>))}
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">One guest profile for every visit – never a second one.</span></div>
      </Body>
      <Tabs tabs={GUEST_TABS} label="Guest" />
    </Screen>
  );
}
