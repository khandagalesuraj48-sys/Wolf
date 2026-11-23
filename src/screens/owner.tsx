// The mess owner's app – boards o01–o16 (an operator sees the kitchen's part). Everything through the database's checked functions.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { call, db, one, rows, settingNum, useAct, useLoad, useSettings } from '../lib/db';
import { useSession } from '../lib/session';
import { day, dayLong, inr, initials, leftText, maskMobile, mealIcon, mealName, MEALS, monthName, nowHM, time, today, type Meal } from '../lib/fmt';
import { Icon } from '../ui/Icon';
import { RoadMap } from '../ui/RoadMap';
import { GMap, pt, type Mark } from '../ui/GMap';
import { directionsUrl, distText, metres } from '../lib/geo';
import { Body, Btn, Denied, Empty, ErrorLine, Failed, Field, Foot, Input, Loading, Screen, Seg, Sheet, Tabs, Top } from '../ui/kit';

export const OWNER_TABS = [
  { to: '/owner', icon: 'house', label: 'Today', end: true }, { to: '/owner/requests', icon: 'receipt', label: 'Orders' },
  { to: '/owner/kitchen', icon: 'chef-hat', label: 'Kitchen' }, { to: '/owner/live', icon: 'truck', label: 'Deliveries' },
  { to: '/owner/billing', icon: 'wallet', label: 'Billing' },
];

interface KLine { id: string; person: string; person_id: string; role: string | null; item: string; code: string; is_meal: boolean; qty: number; state: string; delivered_qty: number | null; short_qty: number | null; confirmed: string | null }
interface KOrder { id: string; code: string; kind: 'meal' | 'parcel' | 'delivery'; meal: Meal; state: string; host_state: string; created_at: string; accepted_at: string | null; change_until: string | null;
  ready_at: string | null; is_group: boolean; guest: boolean; note: string | null; requester: string; requester_role: string | null; batch: string | null;
  section: { id: string; code: string; name?: string; km: number | null; place: string | null; lat?: number | null; lng?: number | null } | null;
  point?: { lat: number; lng: number } | null; lines: KLine[] }
// (0017, his word: "only section … section che baheun koni kel asel tr … location direction he sagle hot jail") a van order goes to a
// section or – asked from outside every section – to the person's location: the kitchen sees how far it is and Google's directions.
const where = (o: KOrder) => o.section?.code || (o.point ? 'Location' : null);
const farOf = (o: KOrder, mess: { lat: number | null; lng: number | null } | null | undefined) =>
  o.point && mess?.lat != null && mess?.lng != null ? distText(metres({ lat: Number(mess.lat), lng: Number(mess.lng) }, { lat: Number(o.point.lat), lng: Number(o.point.lng) })) : null;
function Directions({ to, label = 'Directions' }: { to: { lat: number; lng: number }; label?: string }) {
  return <a className="chip" href={directionsUrl({ lat: Number(to.lat), lng: Number(to.lng) })} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ height: 28, textDecoration: 'none' }}><Icon name="navigation" size={14} />{label}</a>;
}

export function useOwnerMess() {
  const s = useSession();
  const g = s.grants.find((x) => (x.role === 'mess_owner' || x.role === 'mess_operator') && x.mess_id);
  const mess = useLoad(() => g?.mess_id ? one<{ id: string; name: string; site_id: string; contractor_id: string | null; lat: number | null; lng: number | null; contractors: { name: string } | null }>(db().from('messes').select('id,name,site_id,contractor_id,lat,lng,contractors(name)').eq('id', g.mess_id).limit(1)) : Promise.resolve(null), [g?.mess_id]);
  return { mess: mess.data, owner: g?.role === 'mess_owner', loading: mess.loading };
}
function useKitchen(messId: string | undefined, date = today()) {
  return useLoad(() => messId ? call<KOrder[]>('kitchen_orders', { p_mess: messId, p_date: date }) : Promise.resolve([] as KOrder[]), [messId, date], ['orders', 'order_lines']);
}
function useWins(messId: string | undefined, date = today()) {
  return useLoad(() => messId ? rows<{ meal: Meal; serve_from: string; serve_to: string; order_by: string; change_minutes: number }>(db().from('meal_windows').select('meal,serve_from,serve_to,order_by,change_minutes').eq('mess_id', messId).is('removed_at', null).lte('valid_from', date).or('valid_to.is.null,valid_to.gte.' + date)) : Promise.resolve([]), [messId, date]);
}
const curMeal = (w: { meal: Meal; serve_to: string; serve_from: string }[]): Meal => w.slice().sort((a, b) => a.serve_from.localeCompare(b.serve_from)).find((x) => nowHM() <= x.serve_to.slice(0, 5))?.meal || 'lunch';
const itemsText = (o: KOrder) => {
  const m = new Map<string, number>(); o.lines.filter((l) => l.state !== 'cancelled').forEach((l) => m.set(l.item, (m.get(l.item) || 0) + l.qty));
  return [...m].map(([k, n]) => k + ' ' + n).join(' · ');
};
function NoMess() { return <Screen><Top title="My mess" /><Body><Denied text="You are not the owner or operator of a mess. The Site Admin gives this role." /></Body></Screen>; }

// ── o01 · Owner dashboard ──
export function OwnerHome() {
  const { mess, loading } = useOwnerMess();
  const wins = useWins(mess?.id);
  const k = useKitchen(mess?.id);
  const serious = useLoad(() => mess ? one<{ id: string; code: string; category: string; due_at: string; people_count: number }>(db().from('complaints').select('id,code,category,due_at,people_count').eq('mess_id', mess.id).eq('serious', true).neq('state', 'closed').order('due_at').limit(1)) : Promise.resolve(null), [mess?.id], ['complaints']);
  const menu = useLoad(() => mess ? rows<{ meal: string; published_at: string }>(db().from('menus').select('meal,published_at').eq('mess_id', mess.id).eq('service_date', today())) : Promise.resolve([]), [mess?.id]);
  const yday = useLoad(() => mess ? one<{ state: string }>(db().from('day_closings').select('state').eq('mess_id', mess.id).eq('service_date', today(-1)).limit(1)) : Promise.resolve(null), [mess?.id]);
  const vans = useLoad(() => mess ? rows<{ id: string }>(db().from('batches').select('id').eq('mess_id', mess.id).eq('state', 'on_the_way')) : Promise.resolve([]), [mess?.id], ['batches']);
  if (loading) return <Screen><Body><Loading /></Body></Screen>;
  if (!mess) return <NoMess />;
  const meal = curMeal(wins.data || []), w = (wins.data || []).find((x) => x.meal === meal);
  const os = (k.data || []).filter((o) => o.meal === meal && !['cancelled', 'refused'].includes(o.state));
  const meals = (o: KOrder) => o.lines.filter((l) => l.is_meal && l.state !== 'cancelled').length;
  const count = (f: (o: KOrder) => boolean) => os.filter(f).reduce((n, o) => n + meals(o), 0);
  const tiles: [string, number, string, string][] = [
    ['New', count((o) => o.state === 'requested'), 'waiting', '/owner/requests'], ['Preparing', count((o) => ['accepted', 'preparing'].includes(o.state)), 'meals', '/owner/kitchen'],
    ['Ready', count((o) => o.state === 'ready'), 'to send', '/owner/kitchen'], ['On the road', vans.data?.length || 0, 'vans', '/owner/live'],
    ['Served', os.filter((o) => o.kind === 'meal').reduce((n, o) => n + o.lines.filter((l) => l.is_meal && l.state === 'served').length, 0), 'at the mess', '/owner/kitchen?tab=counter'],
    ['Delivered', os.reduce((n, o) => n + o.lines.filter((l) => l.is_meal && ['delivered', 'short'].includes(l.state) && l.confirmed).length, 0), 'confirmed', '/owner/follow-up'],
  ];
  const newN = tiles[0]![1];
  return (
    <Screen>
      <Top left={<div className="av sf">{initials(mess.contractors?.name || mess.name)}</div>} title={mess.contractors?.name || mess.name} sub={mess.name + ' · ' + dayLong(today())}
        right={<Link className="ib" to="/owner/requests" aria-label={newN + ' new requests'} style={{ position: 'relative' }}><Icon name="bell" />{newN > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, background: '#C2560E', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{newN}</span>}</Link>} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        <div className="hero">
          <div className="row"><span className="chip sf" style={{ height: 26 }}>{mealName(meal)}{w ? ' · ' + w.serve_from.slice(0, 5) + ' – ' + w.serve_to.slice(0, 5) : ''}</span><span className="sp" /><span className="xs">now {nowHM()}</span></div>
          <div className="row" style={{ marginTop: 14, alignItems: 'flex-end', gap: 18 }}>
            <div><span className="big" style={{ fontSize: 44 }}>{os.reduce((n, o) => n + meals(o), 0)}</span><div className="xs">{meal} requests</div></div>
            <div className="sp col" style={{ gap: 4 }}><div className="row xs"><span className="sp">At the mess</span><b style={{ color: '#fff' }}>{count((o) => o.kind === 'meal')}</b></div><div className="row xs"><span className="sp">Parcels</span><b style={{ color: '#fff' }}>{count((o) => o.kind !== 'meal')}</b></div></div>
          </div>
        </div>
        {k.error && <Failed error={k.error} retry={k.reload} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {tiles.map(([l, n, sub, to], i) => <Link key={l} className="card" to={to} style={{ padding: 12, textDecoration: 'none', color: 'inherit', ...(i === 0 && n ? { borderColor: '#E8B98A', background: '#FFFBF5' } : {}) }}><span className="xs" style={i === 0 && n ? { color: 'var(--sfD)', fontWeight: 600 } : {}}>{l}</span><b className="num" style={{ display: 'block', fontSize: 26 }}>{n}</b><span className="xs">{sub}</span></Link>)}
        </div>
        {serious.data && <Link className="card" to="/owner/complaints" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '2px solid #E8A49B', background: '#FFF8F6', textDecoration: 'none', color: 'inherit' }}>
          <div className="tile s40 red"><Icon name="siren" /></div><div className="sp"><b style={{ fontSize: 14, color: '#8B1A1A' }}>Serious complaint – {serious.data.category}</b><div className="xs">{serious.data.code} · {serious.data.people_count} people · {leftText(serious.data.due_at)}</div></div><Icon name="chevron-right" size={18} /></Link>}
        <div className="row" style={{ gap: 10 }}>
          <Link className="card" to="/owner/menu" style={{ flex: 1, padding: 12, display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}><Icon name={menu.data?.length ? 'circle-check' : 'circle-dot'} /><div><b style={{ fontSize: 14 }}>{menu.data?.length ? 'Menu out' : 'Publish the menu'}</b><div className="xs">{menu.data?.length ? menu.data.length + ' meals today' : 'not out yet'}</div></div></Link>
          <Link className="card" to="/owner/closing" style={{ flex: 1, padding: 12, display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}><Icon name="clipboard-check" /><div><b style={{ fontSize: 14 }}>Day closing</b><div className="xs">yesterday {yday.data?.state || 'not sent'}</div></div></Link>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link className="card" to="/owner/guests" style={{ flex: 1, padding: 12, display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}><Icon name="users" /><b style={{ fontSize: 14 }}>Guest meals</b></Link>
          <Link className="card" to="/owner/follow-up" style={{ flex: 1, padding: 12, display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}><Icon name="phone" /><b style={{ fontSize: 14 }}>Follow-up</b></Link>
        </div>
      </Body>
      <Tabs tabs={OWNER_TABS} label="Mess owner" />
    </Screen>
  );
}

// ── o02 · New requests ──
export function Requests() {
  const nav = useNavigate();
  const { mess } = useOwnerMess();
  const wins = useWins(mess?.id);
  const k = useKitchen(mess?.id);
  const [by, setBy] = useState<'section' | 'person' | 'order'>('section');
  const a = useAct();
  if (!mess) return <NoMess />;
  const meal = curMeal(wins.data || []), w = (wins.data || []).find((x) => x.meal === meal);
  const waiting = (k.data || []).filter((o) => o.state === 'requested');
  const ready = waiting.filter((o) => !o.change_until || new Date(o.change_until) < new Date());
  const key = (o: KOrder) => by === 'section' ? (o.section ? 'Section ' + o.section.code : o.point ? 'Outside the sections' : o.kind === 'meal' ? 'At the mess' : 'Collect at the mess') : by === 'person' ? o.requester : o.code;
  const groups = [...new Set(waiting.map(key))];
  const acceptAll = () => a.run(async () => { for (const o of ready) await call('kitchen_decide', { p_order: o.id, p_accept: true }); k.reload(); });
  return (
    <Screen>
      <Top back="/owner" title={'New requests · ' + waiting.length} sub={mealName(meal) + (w ? ' · they can still change for up to ' + w.change_minutes + ' min' : '')} />
      <Body style={{ gap: 12, paddingBottom: 12 }}>
        <Seg value={by} options={[{ v: 'section', label: 'Section' }, { v: 'person', label: 'Person' }, { v: 'order', label: 'Order' }]} onChange={setBy} />
        {k.loading && !k.data ? <Loading /> : k.error ? <Failed error={k.error} retry={k.reload} /> : waiting.length === 0 ? <Empty icon="receipt" title="No new requests" text="New ones come here as they are asked." /> :
          groups.map((g) => {
            const list = waiting.filter((o) => key(o) === g);
            return <div key={g} className="col" style={{ gap: 10 }}>
              <div className="row"><b className="sp" style={{ fontSize: 15 }}>{g}</b><span className="xs">{list.length} requests · {list.reduce((n, o) => n + o.lines.filter((l) => l.is_meal).length, 0)} meals</span></div>
              {list.map((o) => {
                const extras = o.lines.filter((l) => !l.is_meal && l.state === 'open');
                const open = o.change_until && new Date(o.change_until) > new Date();
                return <div key={o.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, ...(o.guest ? { borderColor: '#C9D7F2' } : {}) }}>
                  <Link to={'/owner/requests/' + o.id} className="row" style={{ textDecoration: 'none', color: 'inherit' }}><div className={'av ' + (o.guest ? 'plum' : '')}>{initials(o.requester)}</div>
                    <div className="sp"><b style={{ fontSize: 15 }}>{o.requester}{o.guest && <span className="tag" style={{ background: 'var(--plumS)', color: '#5B2BA0', marginLeft: 6 }}>Guest</span>}{o.is_group && <span className="tag" style={{ marginLeft: 6 }}>Group · {o.lines.filter((l) => l.is_meal).length}</span>}</b><div className="xs">{o.requester_role || ''}{o.section ? ' · ' + o.section.code + (o.section.km != null ? ' Km ' + o.section.km : '') : o.point ? ' · Location' + (farOf(o, mess) ? ', ' + farOf(o, mess) + ' from the mess' : '') : ''}</div></div>
                    <span className={'chip ' + (open ? 'amber' : '')} style={{ height: 26 }}>{open ? <><Icon name="timer" size={14} />{leftText(o.change_until!)}</> : 'Ready'}</span></Link>
                  <div className="row sm" style={{ gap: 8 }}><Icon name={o.kind === 'meal' ? 'utensils' : 'package'} size={16} /><span className="sp">{mealName(o.meal)} {o.kind === 'meal' ? 'at the mess' : 'parcel'} · {itemsText(o)}</span><span className="tag">{o.code}</span></div>
                  {extras.map((x) => <div key={x.id} className="row" style={{ gap: 8 }}><span className="sp xs">Extra: <b style={{ color: 'var(--sfD)' }}>{x.item} {x.qty}</b></span>
                    <Btn kind="ghost sm" onClick={() => a.run(async () => { await call('kitchen_extra', { p_line: x.id, p_ok: false }); k.reload(); })}>No extra</Btn></div>)}
                </div>;
              })}
            </div>;
          })}
        <ErrorLine error={a.error} />
      </Body>
      <Foot><div className="row" style={{ gap: 10 }}>
        <Btn kind="ghost" onClick={() => waiting[0] && nav('/owner/requests/' + waiting[0].id)} disabled={!waiting.length} style={{ flex: 1 }}>Open one</Btn>
        <Btn kind="leaf" onClick={acceptAll} busy={a.busy} disabled={!ready.length} style={{ flex: 1.6 }}><Icon name="lock" />Accept {ready.length} ready</Btn>
      </div></Foot>
      <Tabs tabs={OWNER_TABS} label="Mess owner" />
    </Screen>
  );
}

// ── o03 · Request – accept and lock ──
export function RequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { mess } = useOwnerMess();
  const k = useKitchen(mess?.id);
  const o = (k.data || []).find((x) => x.id === id);
  const [refuse, setRefuse] = useState(false);
  const [reason, setReason] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  if (!o) return <Screen><Top back="/owner/requests" title="Request" /><Body>{k.loading ? <Loading /> : <Empty icon="receipt" title="Not found" text="It may be for another day." />}</Body></Screen>;
  const open = o.change_until && new Date(o.change_until) > new Date();
  const decide = (ok: boolean) => a.run(async () => { await call('kitchen_decide', { p_order: o.id, p_accept: ok, p_reason: ok ? null : reason }); nav(ok ? '/owner/kitchen' : '/owner/requests'); });
  return (
    <Screen>
      <Top back="/owner/requests" title={o.code} sub={'Asked ' + time(o.created_at) + ' · ' + o.meal + ' ' + (o.kind === 'meal' ? 'at the mess' : 'parcel')} />
      <Body style={{ gap: 12 }}>
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="av lg">{initials(o.requester)}</div><div className="sp"><b style={{ fontSize: 17 }}>{o.requester}</b><div className="sm">{o.requester_role || (o.guest ? 'Guest' : 'Employee')}</div></div></div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row sm"><Icon name="circle-check" size={16} /><span className="sp">One meal a person – checked by FALCON when it was asked</span></div>
          {o.guest && <div className="row sm"><Icon name="circle-check" size={16} /><span className="sp">Guest – the host's OK is given</span></div>}
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {o.lines.map((l) => <div className="row" key={l.id}><span className="sp" style={{ fontSize: 15, ...(l.state === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}) }}>{l.item}{o.is_group ? ' · ' + l.person : ''}</span><b>{l.qty}</b></div>)}
          <div className="hr" />
          <div className="row sm"><Icon name={o.point ? 'locate-fixed' : 'map-pin'} size={16} /><span className="sp">{o.section ? o.section.code + (o.section.place ? ' ' + o.section.place : '') + ' · with the van' : o.point ? 'His location – outside the sections' + (farOf(o, mess) ? ' · ' + farOf(o, mess) + ' from the mess' : '') + ' · with the van' : o.kind === 'parcel' ? 'Collected at the mess' : 'At the mess'}</span>
            {o.point && <Directions to={o.point} />}</div>
          {o.note && <div className="row sm"><Icon name="message-circle" size={16} /><span className="sp">{o.note}</span></div>}
        </div>
        <ErrorLine error={a.error} />
      </Body>
      {o.state === 'requested' && <div className="sheet" style={{ position: 'sticky' }}>
        <div className="row" style={{ gap: 12 }}><div className="tile navy s56"><Icon name="lock" size={28} /></div><div className="sp"><b style={{ fontSize: 19 }}>Accept and lock?</b><div className="sm">{open ? 'His change window ends ' + time(o.change_until!) : 'His change window is over.'}</div></div></div>
        <div className="row sm" style={{ gap: 8 }}><Icon name="lock" size={16} /><span className="sp">Nobody can change it after this – only a change request, with who and why kept.</span></div>
        <div className="row" style={{ gap: 10 }}>
          <Btn kind="ghost" onClick={() => setRefuse(true)} style={{ flex: 1 }}>Refuse…</Btn>
          <Btn kind="leaf" onClick={() => decide(true)} busy={a.busy} style={{ flex: 2 }}><Icon name="lock" />Accept and lock</Btn>
        </div>
      </div>}
      <Sheet open={refuse} onClose={() => setRefuse(false)}>
        <b className="h2">Why refuse?</b>
        <Input value={reason} onChange={setReason} placeholder="e.g. lunch over, item not available" autoFocus />
        <Btn kind="red" onClick={() => decide(false)} busy={a.busy} disabled={reason.trim().length < 3}>Refuse with this reason</Btn>
      </Sheet>
    </Screen>
  );
}

// ── o04 · Kitchen: preparing · ready · the counter ──
export function Kitchen() {
  const [q] = useSearchParams();
  const { mess } = useOwnerMess();
  const k = useKitchen(mess?.id);
  const [tab, setTab] = useState<'preparing' | 'ready' | 'counter'>((q.get('tab') as 'counter') || 'preparing');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const a = useAct();
  if (!mess) return <NoMess />;
  const all = (k.data || []);
  const prep = all.filter((o) => ['accepted', 'preparing'].includes(o.state) && o.kind !== 'meal');
  const ready = all.filter((o) => o.state === 'ready' && o.kind !== 'meal');
  const counter = all.filter((o) => o.kind === 'meal' && ['accepted', 'preparing', 'ready', 'delivered'].includes(o.state));
  const tot = new Map<string, number>(); prep.forEach((o) => o.lines.filter((l) => l.state !== 'cancelled').forEach((l) => tot.set(l.item, (tot.get(l.item) || 0) + l.qty)));
  const bySec = new Map<string, { ready: number; all: number; km: number | null }>();
  [...prep, ...ready].forEach((o) => { const kk = where(o) || 'Collect'; const v = bySec.get(kk) || { ready: 0, all: 0, km: o.section?.km ?? null }; v.all++; if (o.state === 'ready') v.ready++; bySec.set(kk, v); });
  const chosen = prep.filter((o) => sel[o.id]);
  const markReady = () => a.run(async () => { for (const o of chosen) await call('kitchen_step', { p_order: o.id, p_state: 'ready' }); setSel({}); k.reload(); });
  return (
    <Screen>
      <Top left={<div className="tile s40 navy"><Icon name="chef-hat" /></div>} title="Kitchen" sub={mess.name} />
      <Body style={{ gap: 12, paddingBottom: 12 }}>
        <Seg value={tab} options={[{ v: 'preparing', label: 'Preparing · ' + prep.length }, { v: 'ready', label: 'Ready · ' + ready.length }, { v: 'counter', label: 'Counter · ' + counter.length }]} onChange={setTab} />
        {k.error && <Failed error={k.error} retry={k.reload} />}
        {tab === 'preparing' && <>
          <div className="hero" style={{ padding: 16 }}>
            <div className="row"><b style={{ fontSize: 15 }} className="sp">To pack</b><span className="xs">{prep.length} parcels</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 12, textAlign: 'center' }}>{[...tot].slice(0, 4).map(([n, c]) => <div key={n} style={{ background: '#172A4C', borderRadius: 12, padding: '10px 4px' }}><b style={{ fontSize: 20 }}>{c}</b><div className="xs">{n}</div></div>)}</div>
          </div>
          {bySec.size > 0 && <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[...bySec].map(([s, v]) => <div key={s}><div className="row"><b className="sp" style={{ fontSize: 15 }}>{s}{v.km != null ? ' · Km ' + v.km : ''}</b><span className={'chip ' + (v.ready === v.all ? 'leaf' : v.ready ? 'amber' : '')} style={{ height: 26 }}>{v.ready} / {v.all} ready</span></div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: Math.max(3, (100 * v.ready) / v.all) + '%', ...(v.ready === v.all ? {} : { background: 'var(--sf)' }) }} /></div></div>)}</div>}
          {prep.length === 0 ? <Empty icon="chef-hat" title="Nothing to prepare" /> : prep.map((o) => (
            <button key={o.id} className="card" onClick={() => setSel((x) => ({ ...x, [o.id]: !x[o.id] }))} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: sel[o.id] ? 'var(--leaf)' : 'transparent', border: sel[o.id] ? 0 : '1.5px solid var(--line2)', color: '#fff', display: 'grid', placeItems: 'center' }}>{sel[o.id] && <Icon name="check" size={16} />}</span>
              <div className="sp"><b style={{ fontSize: 14 }}>{o.code} · {o.requester}</b><div className="xs">{where(o) || 'collect'} · {itemsText(o)}</div></div><span className="xs">{time(o.accepted_at)}</span></button>))}
        </>}
        {tab === 'ready' && (ready.length === 0 ? <Empty icon="package-check" title="Nothing ready" /> : ready.map((o) => (
          <div key={o.id} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--leaf)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={16} /></span>
            <div className="sp"><b style={{ fontSize: 14 }}>{o.code} · {o.requester}</b><div className="xs">{where(o) || 'collect at the mess'} · {itemsText(o)}{o.batch ? ' · ' + o.batch : ''}</div></div><span className="xs">{time(o.ready_at)}</span></div>)))}
        {tab === 'counter' && (counter.length === 0 ? <Empty icon="utensils" title="Nobody at the counter" /> : counter.map((o) => o.lines.filter((l) => l.state !== 'cancelled').map((l) => (
          <div key={l.id} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="sp"><b style={{ fontSize: 14 }}>{l.person} · {l.item}{l.qty > 1 ? ' × ' + l.qty : ''}</b><div className="xs">{o.code}</div></div>
            {l.state === 'open' ? <Btn kind="leaf sm" busy={a.busy} onClick={() => a.run(async () => { await call('serve_line', { p_line: l.id }); k.reload(); })}>Served</Btn> : <span className="chip leaf" style={{ height: 26 }}>{l.confirmed ? 'confirmed' : 'served'}</span>}
          </div>))))}
        <ErrorLine error={a.error} />
      </Body>
      {tab === 'preparing' && <Foot><Btn kind="leaf" onClick={markReady} busy={a.busy} disabled={!chosen.length}><Icon name="package-check" />Mark {chosen.length} packed as ready</Btn></Foot>}
      {tab === 'ready' && <Foot><Btn kind="navy" to="/owner/parcels"><Icon name="layers" />Make a delivery batch</Btn></Foot>}
      <Tabs tabs={OWNER_TABS} label="Mess owner" />
    </Screen>
  );
}

// ── o05 · o06 · Ready parcels by section → a delivery batch ── (0017: sections, and each location outside the sections a stop of its own)
export function Parcels() {
  const nav = useNavigate();
  const { mess } = useOwnerMess();
  const k = useKitchen(mess?.id);
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const a = useAct();
  if (!mess) return <NoMess />;
  const ready = (k.data || []).filter((o) => o.kind === 'delivery' && ['accepted', 'preparing', 'ready'].includes(o.state) && !o.batch);
  const stopOf = (o: KOrder) => o.section?.id || 'p-' + o.id;
  const take = ready.filter((o) => !left[stopOf(o)]);
  const stops = [...new Set(take.map(stopOf))];
  const meal = take[0]?.meal;
  const make = () => a.run(async () => {
    const one = take.filter((o) => o.meal === meal);
    const id = await call<string>('make_batch', { p_mess: mess.id, p_date: today(), p_meal: meal, p_orders: one.map((o) => o.id) });
    nav('/owner/batches/' + id + '/driver');
  });
  const secs = [...new Map(ready.filter((o) => o.section).map((o) => [o.section!.id, o.section!])).values()].sort((x, y) => (x.km ?? 0) - (y.km ?? 0) || x.code.localeCompare(y.code, undefined, { numeric: true }));
  const pts = ready.filter((o) => !o.section && o.point);
  const row = (key: string, i: number, n: number, body: ReactNode, count: ReactNode) =>
    <div key={key} role="button" tabIndex={0} onClick={() => setLeft((x) => ({ ...x, [key]: !x[key] }))} onKeyDown={(e) => e.key === 'Enter' && setLeft((x) => ({ ...x, [key]: !x[key] }))} className="row sm"
      style={{ padding: '10px 16px', borderBottom: i < n - 1 ? '1px solid var(--line)' : 0, cursor: 'pointer', opacity: left[key] ? 0.45 : 1, gap: 8 }}>{body}{count}</div>;
  return (
    <Screen>
      <Top back="/owner/kitchen" title={'Parcels for the van · ' + ready.length} sub="By section – and the locations outside the sections" />
      <Body style={{ gap: 12, paddingBottom: 12 }}>
        {k.loading && !k.data ? <Loading /> : ready.length === 0 ? <Empty icon="package" title="No parcels waiting for a van" /> : <>
          {secs.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="row" style={{ padding: '14px 16px', background: 'var(--leafS)' }}><span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--leaf)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="map-pin" size={14} /></span><b className="sp">Sections</b><b>{ready.filter((o) => o.section).length}</b></div>
            {secs.map((x, i) => row(x.id, i, secs.length, <span className="sp">{x.code}{x.name && x.name !== x.code ? ' – ' + x.name : ''}{x.km != null ? ' · Km ' + x.km : ''}{x.place ? ' · ' + x.place : ''}{left[x.id] ? ' · next van' : ''}</span>,
              <b style={{ color: 'var(--ink)' }}>{ready.filter((o) => o.section?.id === x.id).length}</b>))}
          </div>}
          {pts.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="row" style={{ padding: '14px 16px', background: 'var(--blueS)' }}><span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="locate-fixed" size={14} /></span><b className="sp">Outside the sections · their locations</b><b>{pts.length}</b></div>
            {pts.map((o, i) => row('p-' + o.id, i, pts.length, <span className="sp">{o.requester}{farOf(o, mess) ? ' · ' + farOf(o, mess) + ' from the mess' : ''} · {o.code}{left['p-' + o.id] ? ' · next van' : ''}</span>,
              <Directions to={o.point!} />))}
          </div>}
        </>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Tap a section or a location to leave it for the next van. The stops go nearest to the mess first – you can change the order on the route.</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot>
        <div className="row sm"><span className="sp">{stops.length} stops</span><b style={{ color: 'var(--ink)' }}>{take.length} parcels</b></div>
        <Btn kind="navy" onClick={make} busy={a.busy} disabled={!take.length}><Icon name="layers" />Make a delivery batch</Btn>
      </Foot>
    </Screen>
  );
}

// a stop of a batch: a section, or (0017) one order's location outside the sections
interface Stop { id: string; seq: number; section_id: string | null; order_id: string | null; eta: string | null; reached_at: string | null;
  sections: { code: string; km: number | null; place: string | null; lat: number | null; lng: number | null } | null; orders: { code: string; to_lat: number | null; to_lng: number | null } | null }
const stopKey = (x: { section_id: string | null; order_id: string | null }) => x.section_id || 'p-' + x.order_id;
const stopName = (x: Stop) => x.sections ? x.sections.code : 'Location · ' + (x.orders?.code || '');
const stopAt = (x: Stop) => x.sections ? pt(x.sections.lat, x.sections.lng) : x.orders ? pt(x.orders.to_lat, x.orders.to_lng) : null;
interface Batch { id: string; code: string; state: string; meal: Meal; service_date: string; driver_id: string | null; vehicle_id: string | null; planned_km: number | null; planned_minutes: number | null; dispatched_at: string | null; completed_at: string | null; vehicle_check: Record<string, unknown> | null; refused_reason: string | null }
function useBatch(id: string | undefined) {
  return useLoad(async () => {
    const b = await one<Batch>(db().from('batches').select('*').eq('id', id!).limit(1));
    if (!b) return null;
    const [stops, orders] = await Promise.all([
      rows<Stop>(db().from('batch_stops').select('id,seq,section_id,order_id,eta,reached_at,sections(code,km,place,lat,lng),orders(code,to_lat,to_lng)').eq('batch_id', b.id).order('seq')),
      rows<{ order_id: string; orders: { to_section_id: string | null; code: string } }>(db().from('batch_orders').select('order_id,orders(to_section_id,code)').eq('batch_id', b.id).is('removed_at', null)),
    ]);
    const [driver, vehicle] = await Promise.all([
      b.driver_id ? call<{ person_id: string; full_name: string; mobile: string | null }[]>('batch_driver', { p_batch: b.id }).catch(() => []) : Promise.resolve([]),
      b.vehicle_id ? one<{ reg_no: string; kind: string }>(db().from('vehicles').select('reg_no,kind').eq('id', b.vehicle_id).limit(1)) : Promise.resolve(null),
    ]);
    return { b, stops, orders, driver: driver[0] || null, vehicle };
  }, [id], ['batches', 'batch_stops']);
}

// ── o07 · Driver and vehicle ──
export function BatchDriver() {
  const { id } = useParams();
  const nav = useNavigate();
  const { mess } = useOwnerMess();
  const bt = useBatch(id);
  const drivers = useLoad(() => mess ? call<{ person_id: string; full_name: string; busy: string | null }[]>('site_drivers', { p_mess: mess.id }) : Promise.resolve([]), [mess?.id]);
  const vehicles = useLoad(() => rows<{ id: string; reg_no: string; kind: string; capacity: number | null }>(db().from('vehicles').select('id,reg_no,kind,capacity').eq('active', true).order('reg_no')), []);
  const [d, setD] = useState(''); const [v, setV] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  const b = bt.data?.b;
  const go = () => a.run(async () => { await call('assign_batch', { p_batch: id, p_driver: d || b?.driver_id, p_vehicle: v || b?.vehicle_id }); nav('/owner/batches/' + id + '/route'); });
  return (
    <Screen>
      <Top back="/owner/parcels" title="Driver and vehicle" sub={b ? 'Batch ' + b.code + ' · ' + (bt.data?.orders.length || 0) + ' parcels · ' + (bt.data?.stops.length || 0) + ' stops' : ''} />
      <Body style={{ gap: 10, paddingBottom: 12 }}>
        {b?.refused_reason && <Failed error={'The driver said no: ' + b.refused_reason} />}
        <span className="lbl">Driver · on duty today</span>
        {(drivers.data || []).length === 0 ? <Empty icon="user" title="No driver at this site" text="The System Admin gives the driver role." /> : (drivers.data || []).map((x) => {
          const on = (d || b?.driver_id) === x.person_id;
          return <button key={x.person_id} className="card" onClick={() => setD(x.person_id)} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', font: 'inherit', textAlign: 'left', cursor: 'pointer', ...(on ? { border: '2px solid var(--leaf)' } : {}) }}>
            <div className="av navy">{initials(x.full_name)}</div><div className="sp"><b style={{ fontSize: 15 }}>{x.full_name}</b><div className="xs">{x.busy ? 'On ' + x.busy : 'Free'}</div></div>{on && <Icon name="circle-check" />}</button>;
        })}
        <span className="lbl" style={{ marginTop: 6 }}>Vehicle</span>
        {(vehicles.data || []).map((x) => {
          const on = (v || b?.vehicle_id) === x.id;
          return <button key={x.id} className="card" onClick={() => setV(x.id)} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', font: 'inherit', textAlign: 'left', cursor: 'pointer', ...(on ? { border: '2px solid var(--leaf)' } : {}) }}>
            <div className={'tile s40 ' + (on ? 'navy' : 'cream')}><Icon name="truck" /></div><div className="sp"><b style={{ fontSize: 15, letterSpacing: '.03em' }}>{x.reg_no}</b><div className="xs">{x.kind}{x.capacity ? ' · ' + x.capacity + ' boxes' : ''}</div></div>{on && <Icon name="circle-check" />}</button>;
        })}
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="navy" onClick={go} busy={a.busy} disabled={!(d || b?.driver_id) || !(v || b?.vehicle_id)}>See the route<Icon name="arrow-right" /></Btn></Foot>
    </Screen>
  );
}

// ── o08 · Route (by chainage; times suggested from the dated settings "van speed" and "minutes a stop" – the owner may change the order) ──
export function BatchRoute() {
  const { id } = useParams();
  const nav = useNavigate();
  const bt = useBatch(id);
  const { mess } = useOwnerMess();
  const [order, setOrder] = useState<string[] | null>(null);
  const a = useAct();
  const stops = bt.data?.stops || [];
  const seq = order || stops.map(stopKey);
  const list = seq.map((sid) => stops.find((s) => stopKey(s) === sid)!).filter(Boolean);
  const set = useSettings(['delivery.speed_kmh', 'delivery.stop_minutes'], today());
  const speed = Math.max(5, settingNum(set.data, 'delivery.speed_kmh', 30)), stopMin = Math.max(0, settingNum(set.data, 'delivery.stop_minutes', 4));   // only to suggest ETAs; the van's real times are kept
  // (0017) every stop has its place and so has the mess: the km in straight lines from the mess, stop to stop; else by chainage as before
  const messPt = mess ? pt(mess.lat, mess.lng) : null;
  const byPlace = !!messPt && list.length > 0 && list.every((s) => stopAt(s));
  let km = 0, prev = 0, at = messPt; const start = Date.now();
  const plan = list.map((s, i) => {
    if (byPlace) { const q = stopAt(s)!; km += metres(at!, q) / 1000; at = q; } else { const k2 = s.sections?.km ?? prev; km += Math.abs(k2 - prev); prev = k2; }
    return { s, eta: new Date(start + ((km / speed) * 60 + i * stopMin) * 60000) };
  });
  const mins = Math.round((km / speed) * 60 + list.length * stopMin);
  const move = (i: number, d: number) => { const x = [...seq]; const j = i + d; if (j < 0 || j >= x.length) return; [x[i], x[j]] = [x[j]!, x[i]!]; setOrder(x); };
  const save = () => a.run(async () => { await call('set_route', { p_batch: id, p_stops: plan.map((p) => (p.s.section_id ? { section: p.s.section_id, eta: p.eta.toISOString() } : { order: p.s.order_id, eta: p.eta.toISOString() })), p_km: Math.round(km * 10) / 10, p_minutes: mins }); nav('/owner/batches/' + id + '/dispatch'); });
  return (
    <Screen>
      <div className="map" style={{ position: 'absolute', inset: '0 0 380px 0' }}>
        {(() => {
          // (23-11-2026) the Google map when the sections have their places; the drawn road otherwise
          const marks = list.map((p, i) => { const q = stopAt(p); return q ? { ...q, kind: 'stop', label: String(i + 1), title: stopName(p) } as Mark : null; }).filter(Boolean) as Mark[];
          return <GMap marks={marks} line={marks.map((m) => ({ lat: m.lat, lng: m.lng }))} height="100%" label="The stops of the batch on the map"
            fallback={<RoadMap sections={list.filter((p) => p.sections).map((p) => ({ id: stopKey(p), code: p.sections!.code, km: p.sections!.km }))} height={500} label="The stops of the batch on the road" />} />;
        })()}
      </div>
      <button className="ib" aria-label="Back" onClick={() => nav(-1)} style={{ position: 'absolute', left: 20, top: 18 }}><Icon name="chevron-left" /></button>
      <span className="chip" style={{ position: 'absolute', left: 76, top: 25, height: 32 }}><Icon name="route" size={14} />Nearest first</span>
      <div className="sheet">
        <div className="row" style={{ gap: 10 }}><div className="sp"><span className="big" style={{ fontSize: 28 }}>{mins} min</span><div className="xs">{Math.round(km * 10) / 10} km {byPlace ? 'in straight lines' : 'by chainage'} · estimated at {speed} km/h, {stopMin} min a stop</div></div></div>
        <div className="col" style={{ gap: 0 }}>{plan.map((p, i) => <div key={stopKey(p.s)} className="row" style={{ padding: '7px 0', borderBottom: i < plan.length - 1 ? '1px solid var(--line)' : 0 }}>
          <span className="av navy" style={{ width: 26, height: 26, fontSize: 12 }}>{i + 1}</span><span className="sp" style={{ fontSize: 14 }}>{stopName(p.s)}{p.s.sections?.km != null ? ' · Km ' + p.s.sections.km : ''} · {p.s.section_id ? (bt.data?.orders || []).filter((o) => o.orders.to_section_id === p.s.section_id).length : 1} parcels</span>
          {!p.s.sections && stopAt(p.s) && <Directions to={stopAt(p.s)!} label="Map" />}
          <b className="xs">{time(p.eta.toISOString())}</b>
          <button className="chip" aria-label="Earlier" onClick={() => move(i, -1)} style={{ height: 26, padding: '0 6px' }}><Icon name="chevron-down" size={14} /></button></div>)}</div>
        <ErrorLine error={a.error} />
        <div className="row" style={{ gap: 10 }}><Btn kind="ghost" onClick={() => setOrder(null)} style={{ flex: 1 }}><Icon name="refresh-cw" />Reset</Btn><Btn kind="navy" onClick={save} busy={a.busy} disabled={!list.length} style={{ flex: 1.4 }}>Next: dispatch</Btn></div>
      </div>
    </Screen>
  );
}

// ── o09 · Dispatch ──
export function BatchDispatch() {
  const { id } = useParams();
  const nav = useNavigate();
  const bt = useBatch(id);
  const [slide, setSlide] = useState(0);
  const a = useAct();
  const b = bt.data?.b;
  if (!b) return <Screen><Top back={true} title="Dispatch" /><Body>{bt.loading ? <Loading /> : <Denied />}</Body></Screen>;
  const accepted = ['accepted', 'loaded'].includes(b.state);
  const last = bt.data!.stops.slice(-1)[0];
  const go = () => a.run(async () => { await call('dispatch_batch', { p_batch: b.id }); nav('/owner/live'); });
  return (
    <Screen>
      <Top back={true} title={'Dispatch ' + b.code} sub={time(new Date().toISOString())} />
      <Body style={{ gap: 12 }}>
        <div className="hero" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row"><div className="av navy" style={{ background: '#22385F' }}>{initials(bt.data!.driver?.full_name)}</div><div className="sp"><b style={{ fontSize: 16 }}>{bt.data!.driver?.full_name || 'No driver'}</b><div className="xs">{bt.data!.vehicle ? bt.data!.vehicle.reg_no + ' · ' + bt.data!.vehicle.kind : 'No vehicle'}</div></div></div>
          <div className="row" style={{ gap: 8, textAlign: 'center' }}>
            {[[bt.data!.orders.length, 'parcels'], [b.planned_km ?? '–', 'km'], [last?.eta ? time(last.eta) : '–', 'last stop']].map(([v, l]) => <div key={l as string} style={{ flex: 1, background: '#172A4C', borderRadius: 12, padding: '10px 4px' }}><b style={{ fontSize: 20 }}>{v as string}</b><div className="xs">{l as string}</div></div>)}
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <b className="h2">Before it leaves</b>
          <div className="row sm"><Icon name={accepted ? 'circle-check' : 'clock'} size={18} /><span className="sp">The driver accepts on his phone</span><span className="xs">{accepted ? 'accepted' : 'waiting'}</span></div>
          <div className="row sm"><Icon name={b.state === 'loaded' ? 'circle-check' : 'clock'} size={18} /><span className="sp">The driver checked the vehicle</span><span className="xs">{b.state === 'loaded' ? 'done' : 'waiting'}</span></div>
          <div className="row sm"><Icon name={b.planned_minutes != null ? 'circle-check' : 'clock'} size={18} /><span className="sp">Route and times set</span></div>
        </div>
        <div className="row sm" style={{ gap: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' }}><Icon name="bell" size={18} /><span className="sp">The people of these orders are told the van is coming.</span></div>
        <ErrorLine error={a.error} />
        <span className="sp" />
        <label style={{ height: 62, borderRadius: 31, background: accepted ? 'var(--navy)' : '#8C9AB3', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 650, marginBottom: 24 }}>
          <span style={{ position: 'absolute', left: 6 + (slide / 100) * 220, top: 6, width: 50, height: 50, borderRadius: '50%', background: 'var(--gold)', color: '#1D1404', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><Icon name="truck" size={22} /></span>
          {accepted ? 'Slide to dispatch' : 'Waiting for the driver'}<Icon name="chevron-right" size={18} />
          <input type="range" min={0} max={100} value={slide} disabled={!accepted || a.busy} aria-label="Slide to dispatch" onChange={(e) => setSlide(Number(e.target.value))} onPointerUp={() => (slide > 90 ? go() : setSlide(0))} onKeyUp={() => slide > 90 && go()}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
      </Body>
    </Screen>
  );
}

// ── o10 · Live deliveries ──
export function Live() {
  const { mess } = useOwnerMess();
  const batches = useLoad(() => mess ? rows<Batch & { batch_stops: { seq: number; reached_at: string | null; sections: { code: string; lat: number | null; lng: number | null } | null; orders: { code: string; to_lat: number | null; to_lng: number | null } | null }[] }>(db().from('batches').select('*,batch_stops(seq,reached_at,sections(code,lat,lng),orders(code,to_lat,to_lng))').eq('mess_id', mess.id).eq('service_date', today()).neq('state', 'cancelled').order('code')) : Promise.resolve([]), [mess?.id], ['batches', 'batch_stops']);
  const k = useKitchen(mess?.id);
  // (23-11-2026, picture N5) the Google map: each van on the road where its driver's phone last said, its stops left, the mess
  const roadIds = (batches.data || []).filter((b) => b.state === 'on_the_way').map((b) => b.id);
  const vans = useLoad(() => roadIds.length ? rows<{ batch_id: string; lat: number; lng: number; at: string }>(db().from('track_points').select('batch_id,lat,lng,at')
    .in('batch_id', roadIds).order('at', { ascending: false }).limit(200)) : Promise.resolve([]), [roadIds.join()], ['track_points']);
  if (!mess) return <NoMess />;
  const onRoad = (batches.data || []).filter((b) => b.state === 'on_the_way');

  const short = (k.data || []).flatMap((o) => o.lines.filter((l) => l.state === 'short').map((l) => ({ o, l })));
  return (
    <Screen>
      <div className="map" style={{ position: 'absolute', inset: '0 0 430px 0', background: 'var(--navy)' }}>
        {(() => {
          const messPt = pt(mess.lat, mess.lng);
          const marks: Mark[] = [];
          onRoad.forEach((b) => {
            const last = (vans.data || []).find((x) => x.batch_id === b.id);
            (b.batch_stops || []).filter((x) => !x.reached_at).forEach((x) => { const q = x.sections ? pt(x.sections.lat, x.sections.lng) : x.orders ? pt(x.orders.to_lat, x.orders.to_lng) : null; const nm = x.sections?.code || 'Location'; if (q) marks.push({ ...q, kind: 'stop', label: nm, title: b.code + ' · ' + nm }); });
            if (last) marks.push({ lat: Number(last.lat), lng: Number(last.lng), kind: 'van', label: b.code.slice(-3), title: b.code });
          });
          return <GMap marks={marks.length ? [...(messPt ? [{ ...messPt, kind: 'mess', title: mess.name } as Mark] : []), ...marks] : []} height="100%" label="Map: the vans on the road" fallback={null} />;
        })()}
      </div>
      <div className="row" style={{ position: 'absolute', left: 20, right: 20, top: 18 }}><span className="chip" style={{ height: 34 }}><span className="dot sf" />{onRoad.length} vans on the road</span></div>
      <div className="sheet" style={{ gap: 12, top: 120, overflowY: 'auto', paddingBottom: 100 }}>
        <div className="row"><b className="h2 sp">Live · today</b><Link className="chip" to="/owner/parcels">New batch</Link></div>
        {(batches.data || []).length === 0 ? <Empty icon="truck" title="No batches today" /> : (batches.data || []).map((b) => {
          const st = (b.batch_stops || []).sort((x, y) => x.seq - y.seq), done = st.filter((x) => x.reached_at).length;
          const to = b.state === 'draft' ? '/owner/batches/' + b.id + '/driver' : ['assigned', 'accepted', 'loaded'].includes(b.state) ? '/owner/batches/' + b.id + '/dispatch' : '#';
          return <Link key={b.id} to={to} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, textDecoration: 'none', color: 'inherit', ...(b.state === 'on_the_way' ? { borderColor: '#E8B98A' } : {}) }}>
            <div className="row"><span className={'tile s40 ' + (b.state === 'on_the_way' ? '' : 'cream')} style={b.state === 'on_the_way' ? { background: '#C2560E', color: '#fff' } : {}}><Icon name={b.state === 'on_the_way' ? 'truck' : 'layers'} /></span>
              <div className="sp"><b style={{ fontSize: 15 }}>{b.code} · {mealName(b.meal)}</b><div className="xs">{b.state.replace(/_/g, ' ')}{b.state === 'on_the_way' ? ' · stop ' + done + ' of ' + st.length : ''}{b.dispatched_at ? ' · left ' + time(b.dispatched_at) : ''}</div></div></div>
            {st.length > 0 && <div className="row" style={{ gap: 4 }}>{st.map((x) => <i key={x.seq} style={{ flex: 1, height: 6, borderRadius: 3, background: x.reached_at ? 'var(--leaf)' : '#E7E1D3' }} />)}</div>}
          </Link>;
        })}
        {short.map(({ o, l }) => <div key={l.id} className="row sm" style={{ background: 'var(--redS)', color: '#8B1A1A', borderRadius: 14, padding: '10px 12px', gap: 8 }}><Icon name="package-x" size={16} /><span className="sp">{where(o)} · {o.code}: {l.person} got {l.short_qty} {l.item.toLowerCase()} less</span></div>)}
      </div>
      <Tabs tabs={OWNER_TABS} label="Mess owner" />
    </Screen>
  );
}

// ── o11 · Publish the menu ──
export function MenuPublish() {
  const s = useSession();
  const { mess } = useOwnerMess();
  const [d, setD] = useState(today(1));
  const [meal, setMeal] = useState<Meal>('lunch');
  const wins = useWins(mess?.id, d);
  const cur = useLoad(() => mess ? one<{ dishes: string[]; note: string | null; published_at: string }>(db().from('menus').select('dishes,note,published_at').eq('mess_id', mess.id).eq('service_date', d).eq('meal', meal).limit(1)) : Promise.resolve(null), [mess?.id, d, meal]);
  const [dishes, setDishes] = useState<string[] | null>(null);
  const [add, setAdd] = useState(''); const [note, setNote] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  const list = dishes ?? cur.data?.dishes ?? [];
  const w = (wins.data || []).find((x) => x.meal === meal);
  const copy = () => a.run(async () => { const p = await one<{ dishes: string[] }>(db().from('menus').select('dishes').eq('mess_id', mess.id).eq('meal', meal).lt('service_date', d).order('service_date', { ascending: false }).limit(1)); if (!p) throw new Error('No earlier ' + meal + ' menu to copy.'); setDishes(p.dishes); });
  const publish = () => a.run(async () => {
    if (!list.length) throw new Error('Add at least one dish.');
    const { error } = await db().from('menus').upsert({ mess_id: mess.id, service_date: d, meal, dishes: list, note: note || cur.data?.note || null, published_by: s.me!.id, published_at: new Date().toISOString() }, { onConflict: 'mess_id,service_date,meal' });
    if (error) throw new Error(error.message);
    setDishes(null); cur.reload();
  });
  return (
    <Screen>
      <Top back="/owner" title={d === today(1) ? "Tomorrow's menu" : d === today() ? "Today's menu" : 'Menu'} sub={dayLong(d) + ' · ' + mess.name} />
      <Body style={{ gap: 12, paddingBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>{[0, 1, 2].map((i) => <button key={i} className={'chip' + (today(i) === d ? ' on' : '')} onClick={() => { setD(today(i)); setDishes(null); }}>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day(today(i))}</button>)}</div>
        <Seg value={meal} options={MEALS.map((x) => ({ v: x, label: mealName(x) }))} onChange={(v) => { setMeal(v); setDishes(null); }} />
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row"><b className="h2 sp">{mealName(meal)}{w ? ' · ' + w.serve_from.slice(0, 5) + ' – ' + w.serve_to.slice(0, 5) : ''}</b><button className="chip" onClick={copy}>Copy the last one</button></div>
          {list.map((x, i) => <div key={i} className="row"><span className="sp" style={{ fontSize: 15 }}>{x}</span><button className="chip" aria-label={'Remove ' + x} onClick={() => setDishes(list.filter((_, j) => j !== i))} style={{ height: 26 }}><Icon name="x" size={14} /></button></div>)}
          <div className="row" style={{ gap: 8 }}><div className="sp"><Input value={add} onChange={setAdd} placeholder="Add a dish" /></div><Btn kind="ghost sm" onClick={() => { if (add.trim()) { setDishes([...list, add.trim()]); setAdd(''); } }}>Add</Btn></div>
        </div>
        <Field label="Note"><Input value={note} onChange={setNote} placeholder={cur.data?.note || 'e.g. sweet on Friday'} maxLength={300} /></Field>
        {cur.data && <div className="row xs" style={{ gap: 8 }}><Icon name="history" size={14} /><span className="sp">Published {time(cur.data.published_at)} – publishing again shows it as changed; the audit log keeps the old one.</span></div>}
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="leaf" onClick={publish} busy={a.busy} disabled={!list.length}>Publish {meal} menu</Btn></Foot>
    </Screen>
  );
}

// ── o12 · Guest meals ──
export function GuestMeals() {
  const { mess } = useOwnerMess();
  const k = useKitchen(mess?.id);
  const month = useLoad(() => mess ? rows<{ id: string }>(db().from('orders').select('id').eq('mess_id', mess.id).not('guest_visit_id', 'is', null).gte('service_date', today().slice(0, 8) + '01').eq('state', 'delivered')) : Promise.resolve([]), [mess?.id]);
  if (!mess) return <NoMess />;
  const g = (k.data || []).filter((o) => o.guest);
  return (
    <Screen>
      <Top back="/owner" title="Guest meals" sub="Today · their own ticket and bill line" />
      <Body style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="card" style={{ flex: 1, padding: 12 }}><span className="xs">Today</span><b className="num" style={{ display: 'block', fontSize: 24 }}>{g.length}</b><span className="xs">guest orders</span></div>
          <div className="card" style={{ flex: 1, padding: 12 }}><span className="xs">This month</span><b className="num" style={{ display: 'block', fontSize: 24 }}>{month.data?.length || 0}</b><span className="xs">served</span></div>
        </div>
        {g.length === 0 ? <Empty icon="users" title="No guest orders today" /> : g.map((o) => <Link key={o.id} to={'/owner/requests/' + o.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit' }}>
          <div className="row"><div className="av plum">{initials(o.lines[0]?.person)}</div><div className="sp"><b style={{ fontSize: 15 }}>{o.lines[0]?.person}</b><div className="xs">asked by {o.requester}</div></div><span className="tag">{o.code}</span></div>
          <div className="row sm" style={{ gap: 8 }}><Icon name={o.kind === 'meal' ? 'utensils' : 'package'} size={16} /><span className="sp">{mealName(o.meal)} {o.kind === 'meal' ? 'at the mess' : 'parcel'}{where(o) ? ' · ' + where(o) : ''}</span><span className={'chip ' + (o.state === 'delivered' ? 'leaf' : 'amber')} style={{ height: 24 }}>{o.state}</span></div>
        </Link>)}
      </Body>
    </Screen>
  );
}

// ── o13 · Daily closing ──
export function Closing() {
  const { mess, owner } = useOwnerMess();
  const [d, setD] = useState(today());
  const counts = useLoad(() => mess ? call<Record<string, unknown> | null>('day_counts', { p_mess: mess.id, p_date: d }) : Promise.resolve(null), [mess?.id, d], ['orders', 'order_lines']);
  const dc = useLoad(() => mess ? one<{ state: string; present_count: number | null; owner_remarks: string | null; submitted_at: string | null }>(db().from('day_closings').select('state,present_count,owner_remarks,submitted_at').eq('mess_id', mess.id).eq('service_date', d).limit(1)) : Promise.resolve(null), [mess?.id, d], ['day_closings']);
  const [remarks, setRemarks] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  const c = (counts.data || {}) as Record<string, number> & { by_meal?: Record<string, number>; by_kind?: Record<string, number> };
  const row = (l: string, v: string | number, warn?: boolean) => <div className="row sm" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span className="sp">{l}</span><b style={{ color: warn ? 'var(--amber)' : 'var(--ink)' }}>{v}</b></div>;
  return (
    <Screen>
      <Top back="/owner" title="Close the day" sub={dayLong(d) + ' · ' + mess.name} />
      <Body style={{ gap: 12, paddingBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>{[0, -1, -2].map((i) => <button key={i} className={'chip' + (today(i) === d ? ' on' : '')} onClick={() => setD(today(i))}>{i === 0 ? 'Today' : i === -1 ? 'Yesterday' : day(today(i))}</button>)}</div>
        {counts.loading && !counts.data ? <Loading /> : counts.error ? <Failed error={counts.error} retry={counts.reload} /> : <>
          <div className="hero"><span className="sm">Meals served or delivered</span><div className="big" style={{ marginTop: 6 }}>{c.delivered ?? 0}</div>
            <div className="row xs" style={{ marginTop: 10, gap: 12 }}>{MEALS.map((m) => <span key={m}><Icon name={mealIcon[m]!} size={14} /> {(c.by_meal || {})[m] || 0}</span>)}<span>Guests {c.guests ?? 0}</span></div></div>
          <div className="card" style={{ padding: '4px 16px' }}>
            {row('Requested', c.requested ?? 0)}{row('Accepted', c.accepted ?? 0)}{row('Parcels delivered', c.parcels ?? 0)}
            {row('Confirmed', c.confirmed ?? 0)}{row('Not confirmed yet', c.not_confirmed ?? 0, (c.not_confirmed ?? 0) > 0)}
            {row('Failed · cancelled', (c.failed ?? 0) + ' · ' + (c.cancelled ?? 0))}{row('Short given', c.short ?? 0, (c.short ?? 0) > 0)}{row('Complaints', c.complaints ?? 0)}
            {row('Present (HR)', dc.data?.present_count ?? 'not in yet')}
          </div>
          {dc.data?.state && dc.data.state !== 'open' && <div className="chip leaf" style={{ height: 30 }}>{dc.data.state === 'locked' ? 'Locked by the supervisor' : 'Sent ' + time(dc.data.submitted_at)}</div>}
          <Field label="Remarks for the site supervisor"><textarea className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={dc.data?.owner_remarks || 'optional'} maxLength={1000} style={{ height: 72, padding: 12, font: 'inherit', resize: 'none' }} /></Field>
          <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">After the supervisor's review the day is locked; a correction keeps the original.</span></div>
        </>}
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="leaf" onClick={() => a.run(async () => { await call('submit_day', { p_mess: mess.id, p_date: d, p_remarks: remarks || null }); dc.reload(); })} busy={a.busy} disabled={!owner || dc.data?.state === 'locked'}>Send for review</Btn></Foot>
    </Screen>
  );
}

// ── o14 · Complaints ──
export function OwnerComplaints() {
  const { mess } = useOwnerMess();
  const [tab, setTab] = useState<'open' | 'answered' | 'closed'>('open');
  const list = useLoad(() => mess ? rows<{ id: string; code: string; category: string; serious: boolean; text: string | null; heard_text: string | null; state: string; due_at: string; people_count: number; owner_reply: string | null; created_at: string; photo_paths: string[]; voice_path: string | null }>(db().from('complaints').select('*').eq('mess_id', mess.id).order('due_at')) : Promise.resolve([]), [mess?.id], ['complaints']);
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState(''); const [action, setAction] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  const show = (list.data || []).filter((c) => tab === 'open' ? c.state === 'open' : tab === 'answered' ? ['answered', 'person_confirmed'].includes(c.state) : c.state === 'closed');
  const media = async (p: string) => { const r = await supabase!.storage.from('complaint-media').createSignedUrl(p, 300); if (r.data) window.open(r.data.signedUrl, '_blank'); };
  return (
    <Screen>
      <Top back="/owner" title="Complaints" sub="Answer within the time shown" />
      <Body style={{ gap: 12 }}>
        <Seg value={tab} options={[{ v: 'open', label: 'Open · ' + (list.data || []).filter((c) => c.state === 'open').length }, { v: 'answered', label: 'Waiting' }, { v: 'closed', label: 'Closed' }]} onChange={setTab} />
        {show.length === 0 ? <Empty icon="message-square-warning" title="Nothing here" /> : show.map((c) => (
          <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, ...(c.serious && c.state === 'open' ? { border: '2px solid #E8A49B' } : {}) }}>
            <div className="row">{c.serious && <span className="chip red" style={{ height: 26 }}><Icon name="siren" size={14} />Serious</span>}<span className="sp" />{c.state === 'open' && <span className="chip amber" style={{ height: 26 }}><Icon name="timer" size={14} />{leftText(c.due_at)}</span>}</div>
            <div><b style={{ fontSize: 16 }}>{c.text || c.heard_text || c.category}</b><div className="sm">{c.code} · {c.category} · {c.people_count} {c.people_count > 1 ? 'people' : 'person'} · {time(c.created_at)}</div></div>
            {(c.photo_paths.length > 0 || c.voice_path) && <div className="row" style={{ gap: 8 }}>{c.photo_paths.map((p, i) => <button key={p} className="chip" onClick={() => void media(p)}><Icon name="image" size={14} />Photo {i + 1}</button>)}{c.voice_path && <button className="chip" onClick={() => void media(c.voice_path!)}><Icon name="play" size={14} />Voice</button>}</div>}
            {c.owner_reply && <div className="sm">Your reply: {c.owner_reply}</div>}
            {c.state === 'open' && (open === c.id ? <>
              <Input value={reply} onChange={setReply} placeholder="Your reply" /><Input value={action} onChange={setAction} placeholder="What you did (optional)" />
              <Btn kind="navy" busy={a.busy} onClick={() => a.run(async () => { await call('reply_complaint', { p_id: c.id, p_reply: reply, p_action: action || null }); setOpen(null); setReply(''); setAction(''); list.reload(); })}>Send reply</Btn>
            </> : <Btn kind="navy sm" onClick={() => setOpen(c.id)}>Reply and action</Btn>)}
          </div>))}
        <ErrorLine error={a.error} />
        <div className="row xs" style={{ gap: 8, padding: '0 4px' }}><Icon name="info" size={14} /><span className="sp">Closed only after the person confirms it is solved.</span></div>
      </Body>
    </Screen>
  );
}

// ── o15 · Contractor billing ──
export function OwnerBilling() {
  const s = useSession();
  const { mess, owner } = useOwnerMess();
  const bills = useLoad(() => mess ? rows<{ id: string; code: string; month: string; state: string; taxable: number; net_payable: number; invoice_number: string | null; recon: { lines: { item: string; why: string; difference: number }[] } | null; not_billable: Record<string, number> }>(db().from('monthly_bills').select('*').eq('mess_id', mess.id).order('month', { ascending: false })) : Promise.resolve([]), [mess?.id], ['monthly_bills']);
  const days = useLoad(() => mess ? rows<{ service_date: string; state: string; counts: { delivered?: number } | null }>(db().from('day_closings').select('service_date,state,counts').eq('mess_id', mess.id).gte('service_date', today().slice(0, 8) + '01')) : Promise.resolve([]), [mess?.id]);
  const [up, setUp] = useState<string | null>(null);
  const [inv, setInv] = useState({ number: '', amount: '' });
  const [lines, setLines] = useState<{ item: string; qty: string; rate: string }[]>([{ item: '', qty: '', rate: '' }]);
  const [file, setFile] = useState<File | null>(null);
  const a = useAct();
  if (!mess) return <NoMess />;
  const locked = (days.data || []).filter((d) => d.state === 'locked');
  const chain = ['invoice_uploaded', 'checked', 'site_admin_ok', 'accounts_ok', 'management_ok', 'posted', 'paid'];
  const upload = (id: string) => a.run(async () => {
    let path: string | null = null;
    if (file) { path = s.me!.company_id + '/' + id + '/' + Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_'); const r = await supabase!.storage.from('invoices').upload(path, file, { contentType: file.type }); if (r.error) throw new Error('The file could not be sent.'); }
    await call('upload_invoice', { p_bill: id, p_number: inv.number, p_path: path, p_amount: Number(inv.amount), p_lines: lines.filter((l) => l.item).map((l) => ({ item: l.item, qty: Number(l.qty), rate: Number(l.rate) })) });
    setUp(null); bills.reload();
  });
  return (
    <Screen>
      <Top back="/owner" title="Billing" sub={mess.name} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        <div className="hero"><div className="row"><span className="chip sf" style={{ height: 26 }}>{monthName(today().slice(0, 8) + '01')} · verified only</span><span className="sp" /><span className="xs">{locked.length} days closed</span></div>
          <div className="big" style={{ marginTop: 12 }}>{locked.reduce((n, d) => n + (d.counts?.delivered || 0), 0)}</div><div className="xs">meals in closed days – the bill is made from them after the month</div></div>
        {bills.loading && !bills.data ? <Loading /> : (bills.data || []).length === 0 ? <Empty icon="receipt" title="No bills yet" text="Accounts makes the bill after the month is over and every day is locked." /> : (bills.data || []).map((b) => {
          const at = chain.indexOf(b.state), diffs = (b.recon?.lines || []).filter((x) => x.why !== 'matches');
          return <div key={b.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row"><b className="sp" style={{ fontSize: 15 }}>{monthName(b.month)} · {b.code}</b><b>{inr(b.net_payable)}</b></div>
            <div className="xs">{b.invoice_number ? 'Invoice ' + b.invoice_number : 'No invoice yet'} · taxable {inr(b.taxable)}</div>
            <div className="row" style={{ gap: 4 }}>{['Uploaded', 'Checked', 'Site', 'Accounts', 'Approval', 'Posted', 'Paid'].map((l, i) => <span key={l} className={'tag'} style={i <= at ? { background: 'var(--leafS)', color: 'var(--leafD)' } : {}}>{l}</span>)}</div>
            {b.state === 'sent_back' && <span className="chip red" style={{ height: 26 }}>Sent back</span>}
            {diffs.length > 0 && <div className="sm" style={{ color: '#8B1A1A' }}>{diffs.length} differences: {diffs.map((x) => x.item + ' – ' + x.why).join('; ')}</div>}
            {owner && ['draft', 'invoice_uploaded', 'checked'].includes(b.state) && (up === b.id ? <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}><div className="sp"><Input value={inv.number} onChange={(v) => setInv((x) => ({ ...x, number: v }))} placeholder="Invoice number" /></div><div className="sp"><Input value={inv.amount} onChange={(v) => setInv((x) => ({ ...x, amount: v }))} placeholder="Amount before GST" inputMode="numeric" /></div></div>
              {lines.map((l, i) => <div key={i} className="row" style={{ gap: 6 }}><div style={{ flex: 2 }}><Input value={l.item} onChange={(v) => setLines((x) => x.map((y, j) => j === i ? { ...y, item: v } : y))} placeholder="item code" /></div><div style={{ flex: 1 }}><Input value={l.qty} onChange={(v) => setLines((x) => x.map((y, j) => j === i ? { ...y, qty: v } : y))} placeholder="qty" inputMode="numeric" /></div><div style={{ flex: 1 }}><Input value={l.rate} onChange={(v) => setLines((x) => x.map((y, j) => j === i ? { ...y, rate: v } : y))} placeholder="rate" inputMode="numeric" /></div></div>)}
              <button className="chip" onClick={() => setLines((x) => [...x, { item: '', qty: '', rate: '' }])}><Icon name="plus" size={14} />Line</button>
              <label className="chip" style={{ cursor: 'pointer' }}><Icon name="upload" size={14} />{file ? file.name : 'Invoice PDF / photo'}<input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
              <Btn kind="navy" onClick={() => upload(b.id)} busy={a.busy} disabled={!inv.number || !inv.amount}>Upload the invoice</Btn>
            </div> : <Btn kind="ghost sm" onClick={() => setUp(b.id)}><Icon name="upload" />Upload the invoice</Btn>)}
          </div>;
        })}
        <ErrorLine error={a.error} />
      </Body>
      <Tabs tabs={OWNER_TABS} label="Mess owner" />
    </Screen>
  );
}

// ── o16 · Confirmation follow-up ──
export function FollowUp() {
  const { mess } = useOwnerMess();
  const list = useLoad(() => mess ? call<{ order_line_id: string; order_code: string; service_date: string; meal: string; person_id: string; full_name: string; mobile: string | null; state: string; delivered_qty: number | null }[]>('followups', { p_mess: mess.id, p_from: today(-7), p_to: today() }) : Promise.resolve([]), [mess?.id], ['confirmations', 'order_lines']);
  const [open, setOpen] = useState<string | null>(null);
  const [out, setOut] = useState('got_all'); const [qty, setQty] = useState(''); const [note, setNote] = useState('');
  const a = useAct();
  if (!mess) return <NoMess />;
  const save = (line: string) => a.run(async () => { await call('follow_up', { p_line: line, p_outcome: out, p_qty: out === 'got_less' ? Number(qty) : null, p_note: note || null }); setOpen(null); setNote(''); setQty(''); list.reload(); });
  return (
    <Screen>
      <Top back="/owner" title={'Not confirmed yet · ' + (list.data?.length || 0)} sub="Handed over, the person has not checked it" />
      <Body style={{ gap: 12 }}>
        {list.loading && !list.data ? <Loading /> : list.error ? <Failed error={list.error} retry={list.reload} /> : (list.data || []).length === 0 ? <Empty icon="circle-check" title="Everything is confirmed" /> : (list.data || []).map((x) => (
          <div key={x.order_line_id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row"><div className="av">{initials(x.full_name)}</div><div className="sp"><b style={{ fontSize: 15 }}>{x.full_name}</b><div className="xs">{x.order_code} · {x.meal} · {day(x.service_date)} · {maskMobile(x.mobile)}</div></div></div>
            <div className="row" style={{ gap: 8 }}>
              {x.mobile ? <a className="btn leaf sm" href={'tel:' + x.mobile} style={{ flex: 1 }}><Icon name="phone" />Call</a> : null}
              <Btn kind="ghost sm" busy={a.busy} onClick={() => a.run(async () => { await call('follow_up', { p_line: x.order_line_id, p_outcome: 'reminder' }); })} style={{ flex: 1 }}>Send reminder</Btn>
            </div>
            {open === x.order_line_id ? <>
              <span className="lbl">After the call he says</span>
              <div className="row wrap" style={{ gap: 6 }}>{[['got_all', 'Got all'], ['got_less', 'Got less'], ['did_not_get', 'Did not get'], ['no_answer', 'No answer']].map(([v, l]) => <button key={v} className={'chip' + (out === v ? ' on' : '')} onClick={() => setOut(v!)}>{l}</button>)}</div>
              {out === 'got_less' && <Input value={qty} onChange={setQty} placeholder={'How many of ' + (x.delivered_qty ?? 1)} inputMode="numeric" />}
              <Input value={note} onChange={setNote} placeholder="Note – e.g. said dal was cold" />
              <Btn kind="navy" onClick={() => save(x.order_line_id)} busy={a.busy}>Save the follow-up</Btn>
            </> : <Btn kind="ghost sm" onClick={() => { setOpen(x.order_line_id); setOut('got_all'); }}>Record the call</Btn>}
          </div>))}
        <ErrorLine error={a.error} />
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Every call and answer is kept with who and when. A phone answer is never written as the person's code.</span></div>
      </Body>
    </Screen>
  );
}
