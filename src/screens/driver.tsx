// The driver's app – boards d01–d11 (dark): only the batches given to him; names and box contents, never prices; his place is
// sent only while his batch is on the way.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { call, db, rows, useAct, useLoad } from '../lib/db';
import { useSession } from '../lib/session';
import { firstName, initials, mealName, time, today } from '../lib/fmt';
import { Icon } from '../ui/Icon';
import { RoadMap } from '../ui/RoadMap';
import { GMap, pt, type Mark } from '../ui/GMap';
import { directionsUrl, usePlace } from '../lib/geo';
import { Body, Btn, Empty, ErrorLine, Failed, Loading, Screen, Tabs, Top } from '../ui/kit';

interface PLine { item: string; qty: number; state: string; is_meal: boolean; failed_reason: string | null; delivered_qty: number | null }
interface Pers { person_id: string; name: string; role: string | null; order_id: string; code: string; lines: PLine[] | null; confirmed: string | null }
// (0017) a stop is a section – or one order's location outside the sections ("point": section_id is empty, order_id is that order)
interface Stop { seq: number; section_id: string | null; order_id?: string | null; point?: boolean; section: string; km: number | null; place: string | null; lat: number | null; lng: number | null; eta: string | null; reached_at: string | null; people: Pers[] | null }
interface Trip { id: string; code: string; state: string; meal: string; service_date: string; planned_km: number | null; planned_minutes: number | null; dispatched_at: string | null; completed_at: string | null;
  vehicle_check: Record<string, boolean> | null; mess: string; vehicle: { reg_no: string | null; kind: string | null; capacity: number | null }; stops: Stop[] | null }

const D_TABS = [{ to: '/driver', icon: 'house', label: 'Home', end: true }, { to: '/driver/trip', icon: 'route', label: 'Trip' }, { to: '/driver/vehicle', icon: 'truck', label: 'Vehicle' }];
const pState = (p: Pers) => {
  const l = p.lines || [];
  if (l.length && l.every((x) => x.state === 'failed')) return 'failed';
  if (l.length && l.every((x) => ['delivered', 'short', 'failed'].includes(x.state))) return 'done';
  return 'open';
};
const keyOf = (x: Stop) => x.section_id || 'p-' + x.order_id;
const nameOf = (x: Stop) => x.point ? 'Location · ' + (x.people?.[0]?.name || x.section) : x.section;
const what = (p: Pers) => (p.lines || []).map((l) => l.item.toLowerCase() + ' ' + l.qty).join(', ');

function useMyBatches() {
  const s = useSession();
  return useLoad(() => rows<{ id: string; code: string; state: string; meal: string; dispatched_at: string | null; completed_at: string | null; created_at: string }>(
    db().from('batches').select('id,code,state,meal,dispatched_at,completed_at,created_at').eq('driver_id', s.me?.id || '').eq('service_date', today()).order('created_at')), [s.me?.id], ['batches']);
}
function useTrip(id: string | undefined) {
  return useLoad(() => id ? call<Trip | null>('driver_trip', { p_batch: id }) : Promise.resolve(null), [id], ['batches', 'batch_stops', 'order_lines']);
}
// While the batch is on the way: the van's place every 20 s (and only then).
function useShareLocation(trip: Trip | null | undefined) {
  useEffect(() => {
    if (!trip || trip.state !== 'on_the_way' || !navigator.geolocation) return;
    let last = 0;
    const w = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - last < 20000) return; last = Date.now();
      void call('van_position', { p_batch: trip.id, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_speed: p.coords.speed }).catch(() => undefined);
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 10000 });
    return () => navigator.geolocation.clearWatch(w);
  }, [trip?.id, trip?.state]);
}
const current = <T extends { id: string; state: string }>(list: T[] | undefined): T | undefined => (list || []).find((b) => ['on_the_way', 'loaded', 'accepted', 'assigned'].includes(b.state));

// ── d01 · Driver home ──
export function DriverHome() {
  const s = useSession();
  const b = useMyBatches();
  const cur = current(b.data);
  const trip = useTrip(cur?.id);
  const done = (b.data || []).filter((x) => x.state === 'completed');
  return (
    <Screen dark>
      <Top left={<div className="av navy">{initials(s.me?.full_name)}</div>} title={'Namaskar, ' + firstName(s.me?.full_name)} sub={'Mess driver · ' + (s.homeSite?.code || '')} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        {b.error && <Failed error={b.error} retry={b.reload} />}
        {cur ? (
          <Link to={cur.state === 'assigned' ? '/driver/assignments/' + cur.id : '/driver/trip'} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, textDecoration: 'none', color: 'inherit', border: '2px solid var(--gold)' }}>
            <div className="row"><span className="chip" style={{ height: 26, background: 'var(--gold)', color: '#1D1404', borderColor: 'transparent' }}>{cur.state === 'assigned' ? 'New trip' : cur.state.replace(/_/g, ' ')}</span><span className="sp" /><span className="xs">{time(cur.created_at)}</span></div>
            <div><b style={{ fontSize: 20 }}>Batch {cur.code}</b><div className="sm">{mealName(cur.meal)} · {trip.data?.stops?.reduce((n, x) => n + (x.people?.length || 0), 0) ?? '…'} parcels · {trip.data?.stops?.length ?? '…'} stops{trip.data?.planned_km ? ' · ' + trip.data.planned_km + ' km' : ''}</div></div>
            <span className="btn gold" style={{ height: 48 }}>{cur.state === 'assigned' ? 'See and accept' : 'Open the trip'}</span>
          </Link>
        ) : <Empty icon="truck" title="No trip now" text="A new batch comes here as soon as the mess gives it to you." />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          <div className="card" style={{ padding: 12 }}><span className="xs">Trips today</span><b className="num" style={{ display: 'block', fontSize: 26 }}>{(b.data || []).length}</b></div>
          <div className="card" style={{ padding: 12 }}><span className="xs">Closed</span><b className="num" style={{ display: 'block', fontSize: 26 }}>{done.length}</b></div>
        </div>
        {done.length > 0 && <span className="lbl">Earlier today</span>}
        {done.map((x) => <Link key={x.id} to={'/driver/summary/' + x.id} className="card" style={{ padding: 12, display: 'flex', gap: 12, textDecoration: 'none', color: 'inherit' }}><div className="sp"><b style={{ fontSize: 15 }}>{x.code} · {x.meal}</b><div className="xs">{time(x.dispatched_at)} – {time(x.completed_at)}</div></div><Icon name="chevron-right" size={18} /></Link>)}
      </Body>
      <Tabs tabs={D_TABS} label="Driver" />
    </Screen>
  );
}

// ── d02 · New trip – accept ──
export function Assign() {
  const { id } = useParams();
  const nav = useNavigate();
  const t = useTrip(id);
  const [no, setNo] = useState(false); const [why, setWhy] = useState('');
  const a = useAct();
  const tr = t.data;
  if (!tr) return <Screen dark><Top back="/driver" title="New trip" /><Body>{t.loading ? <Loading /> : <Empty icon="truck" title="Not given to you" />}</Body></Screen>;
  const people = (tr.stops || []).flatMap((x) => x.people || []);
  const tot = new Map<string, number>(); people.forEach((p) => (p.lines || []).forEach((l) => tot.set(l.item, (tot.get(l.item) || 0) + l.qty)));
  const answer = (ok: boolean) => a.run(async () => { await call('driver_answer', { p_batch: tr.id, p_accept: ok, p_reason: ok ? null : why }); nav(ok ? '/driver/vehicle' : '/driver'); });
  return (
    <Screen dark>
      <Top back="/driver" title={'New trip · ' + tr.meal} sub={'Batch ' + tr.code + ' · from ' + tr.mess} />
      <Body style={{ gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          {[[people.length, 'parcels'], [(tr.stops || []).length, 'stops'], [tr.planned_km ?? '–', 'km'], [tr.planned_minutes != null ? tr.planned_minutes + ' min' : '–', 'about']].map(([v, l]) => <div key={l as string} className="card" style={{ padding: 12 }}><b className="num" style={{ display: 'block', fontSize: 26 }}>{v as string}</b><span className="xs">{l as string}</span></div>)}
        </div>
        <div className="card sm">{[...tot].map(([k, n]) => n + ' ' + k.toLowerCase()).join(' · ')}</div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">Your location is shared only during this trip.</span></div>
        {no && <><textarea className="inp" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why can't you take it?" style={{ height: 70, padding: 12, font: 'inherit' }} /><Btn kind="red" onClick={() => answer(false)} busy={a.busy} disabled={why.trim().length < 3}>Send – can't take</Btn></>}
        <ErrorLine error={a.error} />
        <span className="sp" />
        {!no && <div className="row" style={{ gap: 10, marginBottom: 24 }}><Btn kind="ghost" onClick={() => setNo(true)} style={{ flex: 1 }}>Can't take</Btn><Btn kind="gold" onClick={() => answer(true)} busy={a.busy} style={{ flex: 2 }}>Accept trip</Btn></div>}
      </Body>
    </Screen>
  );
}

// ── d03 · Vehicle – the check before the trip ──
export function Vehicle() {
  const b = useMyBatches();
  const cur = current(b.data);
  const t = useTrip(cur?.id);
  const [chk, setChk] = useState<Record<string, boolean>>({});
  const a = useAct();
  const tr = t.data;
  const items: [string, string][] = [['box_clean', 'Box cleaned'], ['hot_box', 'Hot box closed and hot'], ['water', 'Water crates in'], ['papers', 'Insurance and PUC with me'], ['fuel', 'Enough diesel for the trip']];
  const c = { ...(tr?.vehicle_check || {}), ...chk };
  return (
    <Screen dark>
      <Top title="My vehicle" sub={tr ? 'For batch ' + tr.code : 'No trip now'} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        {!tr ? <Empty icon="truck" title="No trip now" /> : <>
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="tile s56"><Icon name="truck" size={28} /></div><div className="sp"><b style={{ fontSize: 19, letterSpacing: '.04em' }}>{tr.vehicle.reg_no}</b><div className="sm">{tr.vehicle.kind}{tr.vehicle.capacity ? ' · ' + tr.vehicle.capacity + ' boxes' : ''}</div></div></div>
          <span className="lbl">Before the trip</span>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{items.map(([k, l]) => <button key={k} onClick={() => setChk((x) => ({ ...x, [k]: !c[k] }))} className="row sm" style={{ background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', padding: 0, cursor: 'pointer' }}><Icon name={c[k] ? 'circle-check' : 'circle-dot'} size={18} /><span className="sp">{l}</span></button>)}</div>
          <ErrorLine error={a.error} />
          <Btn kind="gold" busy={a.busy} disabled={!['accepted', 'loaded'].includes(tr.state)} onClick={() => a.run(async () => { await call('vehicle_ready', { p_batch: tr.id, p_check: c }); t.reload(); })}>{tr.state === 'loaded' ? 'Checked – saved again' : 'Vehicle ready'}</Btn>
          {tr.state === 'on_the_way' && <Btn kind="ghost" to="/driver/trip">Open the trip</Btn>}
        </>}
      </Body>
      <Tabs tabs={D_TABS} label="Driver" />
    </Screen>
  );
}

// ── d04 · d06 · the batch and its stops ──
export function TripStops() {
  const b = useMyBatches();
  const cur = current(b.data);
  const t = useTrip(cur?.id);
  const nav = useNavigate();
  const a = useAct();
  useShareLocation(t.data);
  const tr = t.data;
  if (!tr) return <Screen dark><Top title="Trip" /><Body>{t.loading || b.loading ? <Loading /> : <Empty icon="route" title="No trip on the way" />}</Body><Tabs tabs={D_TABS} label="Driver" /></Screen>;
  const stops = tr.stops || [];
  const people = stops.flatMap((x) => x.people || []);
  const doneN = people.filter((p) => pState(p) !== 'open').length;
  const next = stops.find((x) => (x.people || []).some((p) => pState(p) === 'open'));
  const allDone = people.length > 0 && doneN === people.length;
  return (
    <Screen dark>
      <Top title={'Stops · ' + tr.code} sub={tr.state === 'on_the_way' ? 'On the way since ' + time(tr.dispatched_at) : tr.state === 'loaded' || tr.state === 'accepted' ? 'Waiting for the mess to dispatch' : tr.state} />
      <Body style={{ gap: 12, paddingBottom: 100 }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}><span className="big">{doneN} of {people.length}</span><div className="sm">handed over so far · {people.filter((p) => pState(p) === 'failed').length} failed</div></div>
        {stops.map((x) => {
          const pp = x.people || [], d = pp.filter((p) => pState(p) !== 'open').length, isNext = x === next;
          return <Link key={x.seq} to={'/driver/stops/' + keyOf(x)} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit', ...(isNext ? { border: '2px solid var(--gold)' } : {}) }}>
            <span className="av" style={{ width: 34, height: 34, background: d === pp.length ? 'var(--leaf)' : 'var(--navy3)', color: '#fff' }}>{d === pp.length ? <Icon name="check" size={16} /> : x.seq}</span>
            <div className="sp"><b style={{ fontSize: 15 }}>{x.point && <Icon name="locate-fixed" size={14} />} {nameOf(x)}{x.km != null ? ' · Km ' + x.km : ''}</b><div className="xs">{d} of {pp.length}{x.reached_at ? ' · arrived ' + time(x.reached_at) : x.eta ? ' · about ' + time(x.eta) : ''}{x.place ? ' · ' + x.place : ''}</div></div>
            {isNext && <span className="chip" style={{ height: 26, background: 'var(--gold)', color: '#1D1404', borderColor: 'transparent' }}>Next</span>}
          </Link>;
        })}
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">What is in each box is set by the mess – it cannot be changed here.</span></div>
        <ErrorLine error={a.error} />
        {tr.state === 'on_the_way' && next && <Btn kind="gold" to={'/driver/route/' + keyOf(next)}><Icon name="navigation" />Go to {nameOf(next)}</Btn>}
        {tr.state === 'on_the_way' && allDone && <Btn kind="gold" onClick={() => nav('/driver/summary/' + tr.id)}>Trip summary</Btn>}
      </Body>
      <Tabs tabs={D_TABS} label="Driver" />
    </Screen>
  );
}

// ── d05 · Route and navigation to the next stop ──
export function RouteNext() {
  const { section } = useParams();
  const nav = useNavigate();
  const b = useMyBatches();
  const cur = current(b.data);
  const t = useTrip(cur?.id);
  const a = useAct();
  useShareLocation(t.data);
  const me = usePlace();                     // (23-11-2026, picture N4) the van on the Google map is this phone's own place
  const tr = t.data;
  const stop = (tr?.stops || []).find((x) => keyOf(x) === section);
  if (!tr || !stop) return <Screen dark><Top back="/driver/trip" title="Route" /><Body>{t.loading ? <Loading /> : <Empty icon="route" title="Not a stop of your trip" />}</Body></Screen>;
  const stops = tr.stops || [];
  const gmaps = stop.lat != null && stop.lng != null ? directionsUrl({ lat: Number(stop.lat), lng: Number(stop.lng) }) : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((stop.place || stop.section) + ' ' + (stop.km != null ? 'Km ' + stop.km : ''));
  return (
    <Screen dark>
      <div className="map" style={{ position: 'absolute', inset: '0 0 260px 0' }}>
        {(() => {
          const marks = stops.map((x) => { const q = pt(x.lat, x.lng); return q ? { ...q, kind: keyOf(x) === section ? 'mine' : x.reached_at ? 'done' : 'stop', label: String(x.seq), title: nameOf(x) } as Mark : null; }).filter(Boolean) as Mark[];
          const van = me.state === 'ok' ? { lat: me.lat, lng: me.lng } : null;
          const left = stops.filter((x) => !x.reached_at).map((x) => pt(x.lat, x.lng)).filter(Boolean) as { lat: number; lng: number }[];
          return <GMap dark marks={marks.length ? [...marks, ...(van ? [{ ...van, kind: 'van', title: 'You' } as Mark] : [])] : []} line={van ? [van, ...left] : left} height="100%" label="Map: your van and the trip's stops"
            fallback={<RoadMap dark sections={stops.filter((x) => !x.point).map((x) => ({ id: keyOf(x), code: x.section, km: x.km }))} mine={section} done={stops.filter((x) => x.reached_at).map(keyOf)} height={600} label="The trip's stops on the road" />} />;
        })()}
      </div>
      <button className="ib" aria-label="Back" onClick={() => nav('/driver/trip')} style={{ position: 'absolute', left: 20, top: 18 }}><Icon name="chevron-left" /></button>
      <div className="sheet">
        <div className="row" style={{ gap: 12 }}><span className="av" style={{ width: 40, height: 40, background: 'var(--gold)', color: '#1D1404' }}>{stop.seq}</span><div className="sp"><span className="xs">Next stop</span><b style={{ display: 'block', fontSize: 17 }}>{nameOf(stop)}{stop.km != null ? ' · Km ' + stop.km : ''}{stop.place ? ' · ' + stop.place : ''}</b></div><b>{stop.eta ? time(stop.eta) : ''}</b></div>
        <div className="row xs"><span className="sp">{stops.filter((x) => x.reached_at).length} of {stops.length} stops done · {(stop.people || []).length} parcels there</span></div>
        <ErrorLine error={a.error} />
        <div className="row" style={{ gap: 10 }}>
          <a className="btn ghost" href={gmaps} target="_blank" rel="noreferrer" style={{ flex: 1 }}><Icon name="navigation" />Open in Google Maps</a>
          <Btn kind="gold" busy={a.busy} onClick={() => a.run(async () => { await call('reach_stop', stop.point ? { p_batch: tr.id, p_order: stop.order_id } : { p_batch: tr.id, p_section: stop.section_id }); nav('/driver/stops/' + keyOf(stop)); })} style={{ flex: 1 }}>I'm here</Btn>
        </div>
      </div>
    </Screen>
  );
}

// ── d07 · Employee-wise delivery at a stop ──
export function StopPeople() {
  const { section } = useParams();
  const b = useMyBatches();
  const cur = current(b.data);
  const t = useTrip(cur?.id);
  useShareLocation(t.data);
  const stop = (t.data?.stops || []).find((x) => keyOf(x) === section);
  if (!stop) return <Screen dark><Top back="/driver/trip" title="Stop" /><Body>{t.loading ? <Loading /> : <Empty icon="map-pin" title="Not a stop of your trip" />}</Body></Screen>;
  const pp = stop.people || [];
  const open = pp.filter((p) => pState(p) === 'open'), done = pp.filter((p) => pState(p) !== 'open');
  return (
    <Screen dark>
      <Top back="/driver/trip" title={nameOf(stop) + (stop.km != null ? ' · Km ' + stop.km : '')} sub={'Stop ' + stop.seq + ' · ' + pp.length + ' parcels' + (stop.place ? ' · ' + stop.place : '')} />
      <Body style={{ gap: 10 }}>
        {stop.lat != null && stop.lng != null && <a className="btn ghost" href={directionsUrl({ lat: Number(stop.lat), lng: Number(stop.lng) })} target="_blank" rel="noreferrer"><Icon name="navigation" />Directions in Google Maps</a>}
        <div className="row xs"><span className="sp">To give · {open.length}</span><span>Given · {done.length}</span></div>
        {open.map((p) => <Link key={p.order_id + p.person_id} to={'/driver/hand/' + p.order_id + '/' + p.person_id} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <div className="av navy">{initials(p.name)}</div><div className="sp"><b style={{ fontSize: 15 }}>{p.name}</b><div className="xs">{p.role || ''} · {p.code} · {what(p)}</div></div><Icon name="chevron-right" size={18} /></Link>)}
        {done.map((p) => <div key={p.order_id + p.person_id} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', opacity: 0.6 }}>
          <div className="av" style={{ background: pState(p) === 'failed' ? 'var(--redS)' : 'var(--leafS)' }}><Icon name={pState(p) === 'failed' ? 'x' : 'check'} size={16} /></div><div className="sp"><b style={{ fontSize: 15 }}>{p.name}</b><div className="xs">{pState(p) === 'failed' ? 'not delivered' : (p.confirmed === 'beneficiary_otp' ? 'code OK' : 'given – not confirmed')} · {what(p)}</div></div></div>)}
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">You see names and box contents only – no prices.</span></div>
      </Body>
    </Screen>
  );
}

// ── d08 · d09 · d10 · handing over: the person's code, done, or not delivered ──
export function HandOver() {
  const { order, person } = useParams();
  const nav = useNavigate();
  const b = useMyBatches();
  const cur = current(b.data);
  const t = useTrip(cur?.id);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'code' | 'nocode' | 'fail' | 'done'>('code');
  const [note, setNote] = useState('');
  const [why, setWhy] = useState('Not at site');
  const a = useAct();
  const stop = (t.data?.stops || []).find((x) => (x.people || []).some((p) => p.order_id === order && p.person_id === person));
  const p = stop?.people?.find((x) => x.order_id === order && x.person_id === person);
  if (!t.data || !p || !stop) return <Screen dark><Top back="/driver/trip" title="Hand over" /><Body>{t.loading ? <Loading /> : <Empty icon="package" title="Not in your trip" />}</Body></Screen>;
  const tr = t.data;
  const send = (c: string) => a.run(async () => {
    const r = await call<{ ok: boolean; tries_left?: number }>('deliver_with_code', { p_batch: tr.id, p_order: order, p_person: person, p_code: c });
    if (!r.ok) { setCode(''); throw new Error('Wrong code – ' + r.tries_left + ' tries left.'); }
    setMode('done'); t.reload();
  });
  const nextP = (stop.people || []).find((x) => pState(x) === 'open' && !(x.order_id === order && x.person_id === person));
  if (mode === 'done') return (
    <Screen dark><Body style={{ gap: 16, paddingTop: 70, alignItems: 'center', textAlign: 'center' }}>
      <div style={{ width: 120, height: 120, borderRadius: '50%', background: 'var(--leaf)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={32} /></div>
      <p className="h1">Delivered</p><p className="sm">{p.name} · {what(p)}</p>
      <span className="sp" />
      {nextP ? <Btn kind="gold" to={'/driver/hand/' + nextP.order_id + '/' + nextP.person_id}>Next: {nextP.name}</Btn> : <Btn kind="gold" to="/driver/trip">Back to the stops</Btn>}
    </Body></Screen>);
  return (
    <Screen dark>
      <Top back={'/driver/stops/' + keyOf(stop)} title={p.name} sub={p.code + ' · ' + what(p)} />
      <Body style={{ gap: 14 }}>
        {mode === 'code' && <>
          <div className="card" style={{ textAlign: 'center' }}><b style={{ fontSize: 17 }}>Ask for his code</b><div className="sm">It is on his phone, in FALCON</div></div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>{[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 60, height: 72, borderRadius: 16, background: 'var(--navy3)', display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 700, color: '#F2C14E' }}>{code[i] || '·'}</span>)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k === '' ? <span key="x" /> : <button key={k} className="card" disabled={a.busy} onClick={() => { const v = k === '⌫' ? code.slice(0, -1) : (code + k).slice(0, 4); setCode(v); if (v.length === 4 && k !== '⌫') void send(v); }} style={{ height: 56, fontSize: 22, fontWeight: 700, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>{k}</button>)}</div>
          <ErrorLine error={a.error} />
          <div className="row" style={{ gap: 10 }}><Btn kind="ghost sm" onClick={() => setMode('nocode')} style={{ flex: 1 }}>No code with him</Btn><Btn kind="ghost sm" onClick={() => setMode('fail')} style={{ flex: 1 }}>Could not deliver</Btn></div>
        </>}
        {mode === 'nocode' && <>
          <div className="card sm">Given without his code: it waits for his own confirmation, or the mess calls him. Write to whom you gave it.</div>
          <textarea className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. given to the site supervisor" style={{ height: 70, padding: 12, font: 'inherit' }} />
          <ErrorLine error={a.error} />
          <Btn kind="gold" busy={a.busy} disabled={note.trim().length < 3} onClick={() => a.run(async () => { await call('deliver_without_code', { p_batch: tr.id, p_order: order, p_person: person, p_note: note }); setMode('done'); t.reload(); })}>Mark given</Btn>
          <Btn kind="ghost" onClick={() => setMode('code')}>Back to the code</Btn>
        </>}
        {mode === 'fail' && <>
          <b className="h2">Why?</b>
          <div className="row wrap" style={{ gap: 8 }}>{['Not at site', 'No answer', 'Refused', 'Wrong place', 'Road blocked', 'Other'].map((w) => <button key={w} className={'chip' + (why === w ? ' on' : '')} onClick={() => setWhy(w)}>{w}</button>)}</div>
          <textarea className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="More (optional)" style={{ height: 60, padding: 12, font: 'inherit' }} />
          <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">{firstName(p.name)} and the mess are told. A failed parcel is not billed.</span></div>
          <ErrorLine error={a.error} />
          <Btn kind="red" busy={a.busy} onClick={() => a.run(async () => { await call('fail_delivery', { p_batch: tr.id, p_order: order, p_person: person, p_reason: why + (note ? ' – ' + note : '') }); nav('/driver/stops/' + keyOf(stop)); })}>Mark not delivered</Btn>
          <Btn kind="ghost" onClick={() => setMode('code')}>Back</Btn>
        </>}
      </Body>
    </Screen>
  );
}

// ── d11 · Trip summary ──
export function TripSummary() {
  const { id } = useParams();
  const nav = useNavigate();
  const t = useTrip(id);
  const a = useAct();
  const tr = t.data;
  if (!tr) return <Screen dark><Top back="/driver" title="Trip" /><Body>{t.loading ? <Loading /> : <Empty icon="route" title="Not your trip" />}</Body></Screen>;
  const stops = tr.stops || [], people = stops.flatMap((x) => x.people || []);
  const failed = people.filter((p) => pState(p) === 'failed'), given = people.filter((p) => pState(p) === 'done');
  const short = people.flatMap((p) => (p.lines || []).filter((l) => l.state === 'short'));
  return (
    <Screen dark>
      <Top back="/driver" title={'Trip ' + tr.code + (tr.state === 'completed' ? ' done' : '')} sub={time(tr.dispatched_at) + ' – ' + (tr.completed_at ? time(tr.completed_at) : 'now')} />
      <Body style={{ gap: 12 }}>
        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}><span className="big">{given.length} / {people.length}</span><div className="sm">delivered</div></div>
        <div className="row" style={{ gap: 10 }}><div className="card" style={{ flex: 1, padding: 12 }}><b style={{ fontSize: 20 }}>{failed.length}</b><div className="xs">not delivered</div></div><div className="card" style={{ flex: 1, padding: 12 }}><b style={{ fontSize: 20 }}>{short.length}</b><div className="xs">short</div></div></div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{stops.map((x) => { const pp = x.people || []; return <div key={x.seq} className="row sm"><span className="sp">{nameOf(x)} · {pp.filter((p) => pState(p) === 'done').length} of {pp.length}{pp.some((p) => pState(p) === 'failed') ? ' · ' + pp.filter((p) => pState(p) === 'failed').map((p) => firstName(p.name)).join(', ') + ' not delivered' : ''}</span><span className="xs">{time(x.reached_at)}</span></div>; })}</div>
        {failed.length > 0 && <div className="card sm"><b>Give {failed.length} parcel{failed.length > 1 ? 's' : ''} back</b> at the mess counter.</div>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">Your location stops being shared when you close the trip.</span></div>
        <ErrorLine error={a.error} />
        {tr.state === 'on_the_way' && <Btn kind="gold" busy={a.busy} onClick={() => a.run(async () => { await call('complete_batch', { p_batch: tr.id }); nav('/driver'); })} style={{ marginBottom: 24 }}>Close the trip</Btn>}
      </Body>
    </Screen>
  );
}
