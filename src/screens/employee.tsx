// The employee's app – boards Main and e02–e16, against the database. A guest uses the same meal, parcel, section, menu, order,
// tracking, confirmation, review and complaint screens (his own data only – the database decides).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, call, db, one, rows, useAct, useLoad } from '../lib/db';
import { useSession } from '../lib/session';
import { day, dayLong, firstName, greeting, initials, mealIcon, mealName, MEALS, nowHM, time, today, type Meal } from '../lib/fmt';
import { Icon } from '../ui/Icon';
import { RoadMap, type MapSection } from '../ui/RoadMap';
import { GMap, pt, type Mark } from '../ui/GMap';
import { atMess, directionsUrl, distText, isExact, metres, placeMode, sectionAt, usePlace } from '../lib/geo';
import { roadLabel, RoadText, useRoad } from '../lib/road';
import { readHr } from '../lib/hrinfo';
import { Body, Btn, Denied, Empty, ErrorLine, Failed, Field, Foot, Input, Loading, Screen, Seg, Stepper, Tabs, Top, CodeBoxes } from '../ui/kit';
import { inUse, type Dated } from '../lib/dated';

// ── shared data ──
interface Mess { id: string; name: string; site_id: string; contractor_id: string | null; counters: number | null; lat: number | null; lng: number | null; radius_m: number | null }
interface Win { meal: Meal; serve_from: string; serve_to: string; order_by: string; change_minutes: number }
interface Item { id: string; code: string; name: string; kind: string; meal: string | null }
interface Sec { id: string; code: string; name: string; km: number | null; place: string | null; lat: number | null; lng: number | null; radius_m: number | null }
interface Order { id: string; code: string; kind: 'meal' | 'parcel' | 'delivery'; meal: Meal; service_date: string; state: string; created_at: string; accepted_at: string | null;
  change_until: string | null; ready_at: string | null; to_section_id: string | null; to_lat: number | null; to_lng: number | null; guest_visit_id: string | null; host_state: string; refused_reason: string | null; mess_id: string; requested_by: string; is_group: boolean; note: string | null }
interface Line { id: string; order_id: string; person_id: string; item_id: string; is_meal: boolean; qty: number; state: string; delivered_qty: number | null; short_qty: number | null; items?: { name: string; code: string } }

export const EMP_TABS = [
  { to: '/app', icon: 'house', label: 'Home', end: true }, { to: '/app/orders', icon: 'receipt', label: 'Orders' },
  { to: '/app/scan', icon: 'scan-line', label: 'Scan mess QR', plus: true }, { to: '/app/menu', icon: 'utensils', label: 'Menu' },
  { to: '/app/me', icon: 'user', label: 'Me' },
];
export const GUEST_TABS = [
  { to: '/guest', icon: 'house', label: 'Home', end: true }, { to: '/guest/history', icon: 'receipt', label: 'My orders' },
  { to: '/app/menu', icon: 'utensils', label: 'Menu' }, { to: '/app/me', icon: 'user', label: 'Me' },
];

const chosenMess = () => { try { return sessionStorage.getItem('falcon.mess') || ''; } catch { return ''; } };
export function useMyMess() {
  const s = useSession();
  const [pick, setPick] = useState(chosenMess());
  const site = s.me?.home_site_id;
  // (23-11-2026) only the messes in use today (From / Till – a removed one leaves the list)
  const list = useLoad(() => rows<Mess & Dated>(db().from('messes').select('id,name,site_id,contractor_id,counters,lat,lng,radius_m,active,valid_from,valid_to').eq('active', true).order('name')).then((x) => x.filter((m) => inUse(m))), [s.me?.id]);
  const mess = list.data?.find((m) => m.id === pick) || list.data?.find((m) => m.site_id === site) || list.data?.[0] || null;
  const choose = (id: string) => { try { sessionStorage.setItem('falcon.mess', id); } catch { /* */ } setPick(id); };
  return { mess, list, choose };
}
export function useWindows(messId: string | undefined, date: string) {
  return useLoad(() => messId ? rows<Win>(db().from('meal_windows').select('meal,serve_from,serve_to,order_by,change_minutes').eq('mess_id', messId).is('removed_at', null)
    .lte('valid_from', date).or('valid_to.is.null,valid_to.gte.' + date)) : Promise.resolve([] as Win[]), [messId, date]);
}
const hm = (t: string) => t.slice(0, 5);
function winState(w: Win | undefined, date: string, kind: 'meal' | 'parcel') {
  if (!w) return { open: false, label: 'Not served' };
  if (date > today()) return { open: true, label: 'from ' + hm(w.serve_from) };
  const now = nowHM(), end = kind === 'meal' ? hm(w.serve_to) : hm(w.order_by);
  if (now > end) return { open: false, label: 'Closed' };
  return { open: true, label: now >= hm(w.serve_from) ? 'till ' + end : hm(w.serve_from) };
}
const currentMeal = (wins: Win[]): Meal => {
  const now = nowHM();
  return (wins.slice().sort((a, b) => a.serve_from.localeCompare(b.serve_from)).find((w) => now <= hm(w.serve_to))?.meal) || 'lunch';
};
function useItems() {
  return useLoad(() => rows<Item>(db().from('items').select('id,code,name,kind,meal').eq('active', true).order('name')), []);
}
function useSections(siteId: string | null | undefined) {
  // (0017) only sections – no circle; each with its area (place + metres)
  return useLoad(() => siteId ? rows<Sec & Dated>(db().from('sections').select('id,code,name,km,place,lat,lng,radius_m,active,valid_from,valid_to').eq('site_id', siteId).eq('active', true).order('km').order('code'))
    .then((x) => x.filter((y) => inUse(y))) : Promise.resolve([] as Sec[]), [siteId]);
}
const toMap = (secs: Sec[]) => ({ sections: secs.map((s) => ({ id: s.id, code: s.code, km: s.km })) as MapSection[] });
const pickedSection = () => { try { return sessionStorage.getItem('falcon.section') || ''; } catch { return ''; } };

// ── Main · Mess home ──
export function Home() {
  const s = useSession();
  const nav = useNavigate();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const menus = useLoad(() => mess ? rows<{ meal: Meal; dishes: string[] }>(db().from('menus').select('meal,dishes').eq('mess_id', mess.id).eq('service_date', today())) : Promise.resolve([]), [mess?.id]);
  const active = useLoad(() => one<Order>(db().from('orders').select('*').gte('service_date', today()).not('state', 'in', '(cancelled,refused,failed)')
    .order('created_at', { ascending: false }).limit(1)), [s.me?.id], ['orders']);
  const month = useLoad(() => call<{ meals: number; parcels: number }>('my_month'), [s.me?.id]);
  const unread = useLoad(() => rows(db().from('notifications').select('id').is('read_at', null).limit(20)), [s.me?.id], ['notifications']);
  // (23-11-2026, his word: "app swata check krel user kuthe aahe … mess location madhe asel tr mess ch auto yeil … lamb asel tr mess che
  // direction kiti lamb te dakhwel ani auto parcel") where he is: at the mess → "At the mess"; away → how far, the way, "Parcel"
  const messPt = mess ? pt(mess.lat, mess.lng) : null;
  const place = usePlace(Boolean(messPt));
  const [pick, setPick] = useState<'mess' | 'parcel' | null>(null);
  const [hr] = useState(readHr);
  // (25-11-2026, his word: FALCON said 5.9 km, Google Maps 12 km – "fake imformation") how far BY ROAD (lib/road.tsx)
  const youPt = place.state === 'ok' && isExact(place) ? { lat: place.lat, lng: place.lng } : null;
  const road = useRoad(youPt, messPt);
  if (!s.me) return null;
  // (25-11-2026, "20 km lamb hoto but app sangat hote 5 km … ekdm perfect") only an exact reading (± 100 m) tells how far / at the mess
  const exact = place.state === 'ok' && isExact(place), rough = place.state === 'ok' && !isExact(place);
  const here = exact && messPt && mess ? atMess(place, mess) : null;
  const away = exact && messPt ? metres(place, messPt) : null;
  // (25-11-2026, "outside … at the mess option band … parcel") outside the mess area: Parcel only
  const mode = placeMode(pick, here);
  const hrToday = hr && hr.day === today() ? hr : null;
  const meal = currentMeal(wins.data || []);
  const w = (wins.data || []).find((x) => x.meal === meal);
  const st = winState(w, today(), 'meal');
  const o = active.data;
  const dishes = (m: Meal) => (menus.data || []).find((x) => x.meal === m)?.dishes.slice(0, 2).join(', ');
  const progress: Record<string, number> = { requested: 15, accepted: 35, preparing: 50, ready: 60, dispatched: 80, delivered: 100 };
  return (
    <Screen>
      <Top left={<div className="av">{initials(s.me.full_name)}</div>} title={greeting() + ', ' + firstName(s.me.full_name)}
        sub={(s.homeSite ? s.homeSite.code + ' · ' + s.homeSite.name : '') + (mess ? ' · ' + mess.name : '')}
        right={<Link className="ib" to="/app/notifications" aria-label="Notifications" style={{ position: 'relative' }}><Icon name="bell" />{(unread.data?.length || 0) > 0 && <span className="dot sf" style={{ position: 'absolute', top: 9, right: 9 }} />}</Link>} />
      <Body style={{ paddingBottom: 100 }}>
        {s.me.state === 'temporary' && <Link to="/start/temporary" className="row sm" style={{ background: 'var(--amberS)', color: 'var(--amber)', borderRadius: 14, padding: '10px 12px', gap: 8, textDecoration: 'none' }}><Icon name="clock-alert" size={16} /><span className="sp">Temporary access – waiting for the Site Admin</span><Icon name="chevron-right" size={16} /></Link>}
        {/* (25-11-2026, his word: "signed in through RCL HR as yete te nko yeyla comes from HR by itself he nko yeyla") the two cards of HR are no more */}
        <div className="hero">
          <div className="row">
            {here === true && mess ? <span className="chip leaf" style={{ height: 26 }}><Icon name="map-pin" size={14} />You are at {mess.name}</span>
              : here === false && mess && away != null ? <span className="chip sf" style={{ height: 26 }}><Icon name="route" size={14} />{road ? distText(road.metres) + ' by road' : distText(away) + ' in a straight line'} from {mess.name}</span>
              : <span className="chip sf" style={{ height: 26 }}>{mealName(meal)} · {st.open ? 'open ' + st.label : st.label}</span>}
            <span className="sp" /><span className="xs">{mode ? nowHM() : dayLong(today())}</span>
          </div>
          <p style={{ margin: '14px 0 4px', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>
            {!mess ? 'Your site has no mess yet' : !st.open ? 'No meal open right now' : mode === 'mess' ? mealName(meal) + ' at the mess'
              : mode === 'parcel' ? mealName(meal) + ' parcel to your section' : 'Your ' + meal + ' is ready to order'}</p>
          {w && (mode
            ? <div className="row sm"><Icon name={meal === 'dinner' ? 'moon' : 'sun'} size={16} />{mealName(meal)} by the server's time · {mode === 'parcel' ? 'ask by ' + hm(w.order_by) : 'open till ' + hm(w.serve_to)}</div>
            : <div className="row sm"><Icon name="clock" size={16} />Parcels asked by {hm(w.order_by)} · served {hm(w.serve_from)}–{hm(w.serve_to)}</div>)}
          {hrToday?.in && <div className="row sm"><span style={{ color: '#7FD39A', display: 'inline-flex' }}><Icon name="user-check" size={16} /></span>Present since {hrToday.in} · from HR attendance</div>}
          {mode ? <>
            <div className="seg" role="tablist" aria-label="How" style={{ marginTop: 14, background: '#1F3354' }}>
              {(['mess', 'parcel'] as const).map((m) => {
                const no = m === 'mess' && here === false;
                return <span key={m} role="tab" tabIndex={no ? -1 : 0} aria-selected={mode === m} aria-disabled={no || undefined} className={mode === m ? 'on' : ''}
                  style={{ cursor: no ? 'default' : 'pointer', ...(mode === m ? {} : { color: '#B8C3D6' }), opacity: no ? 0.4 : 1 }} onClick={() => !no && setPick(m)} onKeyDown={(e) => !no && e.key === 'Enter' && setPick(m)}>{m === 'mess' ? 'At the mess' : 'Parcel'}</span>;
              })}
            </div>
            {mode === 'mess'
              ? <Btn kind="gold" to="/app/scan" style={{ marginTop: 12, height: 50, fontSize: 15 }}><Icon name="scan-line" />Scan the counter QR</Btn>
              : <Btn kind="gold" to="/app/parcel" style={{ marginTop: 12, height: 50, fontSize: 15 }}><Icon name="package" />Ask {meal} parcel</Btn>}
          </> : (
            <div className="row" style={{ marginTop: 16, gap: 10 }}>
              <Btn kind="gold" to="/app/scan" style={{ height: 48, fontSize: 15 }}><Icon name="scan-line" />Scan QR</Btn>
              <Btn kind="ghost" to="/app/parcel" style={{ height: 48, fontSize: 15, background: 'transparent', color: '#fff', borderColor: '#33496F' }}><Icon name="package" />Parcel</Btn>
            </div>
          )}
        </div>
        {messPt && mess && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <GMap height={here === true ? 118 : 200} label={'Map: you and ' + mess.name} fallback={null}
              marks={[{ ...messPt, kind: 'mess', title: mess.name } as Mark, ...(exact ? [{ lat: place.lat, lng: place.lng, kind: 'you', title: 'You' } as Mark] : [])]}
              ring={{ center: messPt, metres: mess.radius_m || 100 }} />
            <div className="row" style={{ padding: '12px 14px' }}>
              {exact && away != null ? (here
                ? <><span className="tile s40 leaf"><Icon name="circle-check" /></span><div className="sp"><b style={{ fontSize: 15 }}>Inside the mess area</b><div className="xs">{distText(away)} from the mess · by your phone's location</div></div></>
                : <><div className="sp"><b style={{ fontSize: 15 }}>{roadLabel(road, away)}</b><div className="xs">Going to the mess? Meal at the mess comes by itself there.</div></div>
                  <a className="btn sm ghost" href={directionsUrl(messPt)} target="_blank" rel="noopener noreferrer"><Icon name="navigation" size={16} />Directions</a></>)
                : place.state === 'asking' || rough ? <div className="sp xs">{rough ? 'Finding your exact place… (± ' + distText(place.acc) + ' – go into the open)' : 'Finding where you are…'}</div>
                : <><div className="sp"><b style={{ fontSize: 15 }}>Location is off</b><div className="xs">Turn it on – the app then chooses "At the mess" or "Parcel" by itself.</div></div>
                  <Btn kind="ghost sm" onClick={place.ask}>Try again</Btn></>}
            </div>
          </div>
        )}
        {o && (
          <Link className="card lift" to={'/app/orders/' + o.id} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row"><div className="tile"><Icon name={o.state === 'dispatched' ? 'truck' : o.kind === 'meal' ? 'utensils' : 'package'} size={22} /></div>
              <div className="sp"><b style={{ fontSize: 15 }}>{mealName(o.meal)} {o.kind === 'meal' ? 'at the mess' : 'parcel'} · {stateWord(o.state)}</b><div className="sm">{o.code}{o.service_date !== today() ? ' · ' + day(o.service_date) : ''}</div></div></div>
            <div className="bar"><i style={{ width: (progress[o.state] || 10) + '%', background: '#C2560E' }} /></div>
            <div className="row xs"><span>{o.accepted_at ? 'Accepted ' + time(o.accepted_at) : 'Asked ' + time(o.created_at)}</span><span className="sp" /><span>Open</span></div>
          </Link>
        )}
        <div className="row"><b className="h2 sp">Today at {mess?.name || 'the mess'}</b><Link className="sm" to="/app/menu" style={{ color: 'var(--leafD)', fontWeight: 600, textDecoration: 'none' }}>Full menu</Link></div>
        <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
          {(['breakfast', 'lunch', 'dinner'] as Meal[]).map((m) => {
            const x = (wins.data || []).find((y) => y.meal === m), cur = m === meal && st.open;
            const t = x ? winState(x, today(), 'meal') : null;
            return (
              <div key={m} className="card" style={{ flex: 1, padding: 12, ...(cur ? { borderColor: '#E8B98A', background: '#FFFBF5' } : {}) }}>
                <div className={'tile s40 ' + (m === 'breakfast' ? 'cream' : m === 'dinner' ? 'blue' : '')}><Icon name={mealIcon[m]!} /></div>
                <b style={{ display: 'block', marginTop: 10, fontSize: 14 }}>{mealName(m)}</b>
                <div className="xs">{dishes(m) || 'Menu not out yet'}</div>
                <span className="tag" style={{ marginTop: 8, ...(cur ? { background: 'var(--sfS)', color: 'var(--sfD)' } : {}) }}>{!x ? 'Not served' : cur ? 'Now' : t!.label === 'Closed' ? 'Over' : hm(x.serve_from)}</span>
              </div>
            );
          })}
        </div>
        <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6, padding: 12 }}>
          {[['/app/orders', 'history', 'leaf', 'History'], ['/app/menu/poster', 'sparkles', 'plum', 'Poster'], ['/app/complaints/new', 'message-square-warning', 'red', 'Complaint'], ['/app/guest', 'user-plus', 'blue', 'Guest']].map(([to, ic, cl, l]) => (
            <Link key={to} to={to!} className="col" style={{ alignItems: 'center', textDecoration: 'none', color: 'inherit', gap: 6 }}><div className={'tile s40 ' + cl}><Icon name={ic!} /></div><span className="xs" style={{ color: 'var(--ink)' }}>{l}</span></Link>
          ))}
        </div>
        {s.me.may_group && <Link to="/app/group" className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: 12 }}><div className="tile s40 leaf"><Icon name="users" /></div><b className="sp" style={{ fontSize: 15 }}>Meals for my team</b><Icon name="chevron-right" size={18} /></Link>}
        <div className="row sm" style={{ padding: '0 4px' }} onClick={() => nav('/app/orders')}><Icon name="utensils" size={16} /><span className="sp">{month.data ? month.data.meals + ' meals and ' + month.data.parcels + ' parcels this month' : ' '}</span><Icon name="chevron-right" size={16} /></div>
      </Body>
      <Tabs tabs={EMP_TABS} label="Mess" />
    </Screen>
  );
}
const stateWord = (s: string) => ({ requested: 'asked', accepted: 'accepted', preparing: 'being made', ready: 'ready', dispatched: 'on the way', delivered: 'delivered', refused: 'refused', cancelled: 'cancelled', failed: 'not delivered' } as Record<string, string>)[s] || s;

// ── e02 · Scan the mess QR ──
export function Scan() {
  const nav = useNavigate();
  const { list, choose } = useMyMess();
  const video = useRef<HTMLVideoElement>(null);
  const [found, setFound] = useState<{ mess: Mess; counter: string } | null>(null);
  const [msg, setMsg] = useState('Reading… hold the phone steady');
  const wins = useWindows(found?.mess.id, today());
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    const Det = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Det || !navigator.mediaDevices) { setMsg('This phone cannot read a QR here – choose the mess below.'); return; }
    const det = new Det({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s; if (!video.current) return; video.current.srcObject = s; await video.current.play();
      const tick = async () => {
        if (stop || !video.current) return;
        try {
          const r = await det.detect(video.current);
          const m = r[0]?.rawValue.match(/\/m\/([0-9a-f-]{36})(?:\?c=(\d+))?/i);
          const mess = m && list.data?.find((x) => x.id === m[1]);
          if (mess) { setFound({ mess, counter: m![2] || '1' }); choose(mess.id); return; }
          if (r[0]) setMsg('This is not a FALCON mess QR.');
        } catch { /* keep trying */ }
        setTimeout(tick, 400);
      };
      void tick();
    }).catch(() => setMsg('The camera is not allowed – choose the mess below.'));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [list.data, choose]);
  const meal = currentMeal(wins.data || []);
  const w = (wins.data || []).find((x) => x.meal === meal);
  return (
    <Screen style={{ color: '#fff', background: 'radial-gradient(120% 70% at 50% 30%,#3A3F44 0%,#1A1D21 55%,#0B0D10 100%)' }}>
      <div className="top">
        <Link className="ib" to="/app" aria-label="Back" style={{ background: 'rgba(255,255,255,.12)', borderColor: 'transparent', color: '#fff' }}><Icon name="chevron-left" /></Link>
        <div className="t"><b>Scan the mess QR</b><small style={{ color: '#C9D1DA' }}>On the counter or the mess door</small></div>
      </div>
      <div style={{ position: 'relative', margin: '28px auto 0', width: 260, height: 260, borderRadius: 28, overflow: 'hidden' }}>
        <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {['left:0;top:0', 'right:0;top:0', 'left:0;bottom:0', 'right:0;bottom:0'].map((p, i) => {
          const st: Record<string, string | number> = { position: 'absolute', width: 54, height: 54 };
          p.split(';').forEach((kv) => { const [k, v] = kv.split(':'); st[k!] = v!; });
          const side = (i % 2 ? 'Right' : 'Left'), vert = (i < 2 ? 'Top' : 'Bottom');
          return <div key={i} style={{ ...st, ['border' + side]: '5px solid #F2A54A', ['border' + vert]: '5px solid #F2A54A', borderRadius: i === 0 ? '28px 0 0 0' : i === 1 ? '0 28px 0 0' : i === 2 ? '0 0 0 28px' : '0 0 28px 0' } as React.CSSProperties} />;
        })}
      </div>
      <p style={{ textAlign: 'center', margin: '22px 0 0', fontSize: 14, color: '#D6DCE4' }}>{found ? 'Read' : msg}</p>
      <div className="sheet" style={{ background: '#fff', color: 'var(--ink)' }}>
        {found ? <>
          <div className="row"><div className="tile leaf"><Icon name="badge-check" size={24} /></div><div className="sp"><b style={{ fontSize: 17 }}>{found.mess.name} · Counter {found.counter}</b><div className="sm">{w ? mealName(meal) + ' till ' + hm(w.serve_to) : 'No meal open now'}</div></div></div>
          <div className="row sm" style={{ background: 'var(--cream)', borderRadius: 14, padding: '10px 12px', gap: 8 }}><Icon name="info" size={16} /><span>A scan only asks for your meal. It counts when the mess marks it served.</span></div>
          <Btn kind="leaf" onClick={() => nav('/app/meal?counter=' + found.counter)}><Icon name="utensils" />Eat at the mess</Btn>
          <Btn kind="ghost" to="/app/parcel"><Icon name="package" />Take a parcel</Btn>
        </> : <>
          <b className="h2">Or choose the mess</b>
          {list.loading ? <Loading /> : list.error ? <Failed error={list.error} retry={list.reload} /> :
            (list.data || []).map((m) => <button key={m.id} className="card" onClick={() => { choose(m.id); setFound({ mess: m, counter: '1' }); }} style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}><div className="tile s40 leaf"><Icon name="store" /></div><b className="sp">{m.name}</b><Icon name="chevron-right" size={18} /></button>)}
        </>}
      </div>
    </Screen>
  );
}

// ── e03 · Meal at the mess ──
export function MealAtMess() {
  const s = useSession();
  const nav = useNavigate();
  const [q] = useSearchParams();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const items = useItems();
  const [meal, setMeal] = useState<Meal | null>(null);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const mine = useLoad(() => rows<{ meal: Meal; order_id: string }>(db().from('order_lines').select('meal,order_id').eq('person_id', s.me?.id || '').eq('service_date', today()).eq('is_meal', true).neq('state', 'cancelled')), [s.me?.id]);
  const a = useAct();
  const m: Meal = meal || currentMeal(wins.data || []);
  const w = (wins.data || []).find((x) => x.meal === m);
  const st = winState(w, today(), 'meal');
  const had = (mine.data || []).find((x) => x.meal === m);
  const meals = (items.data || []).find((i) => i.kind === 'meal' && i.meal === m);
  const extras = (items.data || []).filter((i) => i.kind === 'extra');
  const visit = useGuestVisit();
  const ask = () => a.run(async () => {
    const lines = [{ item: meals!.code }, ...Object.entries(extra).filter(([, n]) => n > 0).map(([code, n]) => ({ item: code, qty: n }))];
    const r = await call<{ order_id: string | null; existing: { order_id: string }[] }>('request_order', { p_mess: mess!.id, p_date: today(), p_meal: m, p_kind: 'meal', p_lines: lines, p_note: q.get('counter') ? 'Counter ' + q.get('counter') : null, p_visit: visit.data?.id || null });
    nav('/app/orders/' + (r.order_id || r.existing[0]?.order_id));
  });
  return (
    <Screen>
      <Top back={true} title="Meal at the mess" sub={(mess?.name || '') + (q.get('counter') ? ' · Counter ' + q.get('counter') : '')} />
      <Body style={{ paddingBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
          {MEALS.map((x) => {
            const ww = (wins.data || []).find((y) => y.meal === x), t = winState(ww, today(), 'meal'), on = x === m;
            return <button key={x} className="card" onClick={() => setMeal(x)} style={{ padding: '10px 6px', textAlign: 'center', font: 'inherit', cursor: 'pointer', ...(on ? { background: 'var(--ink)', borderColor: 'var(--ink)', color: '#fff' } : t.open ? {} : { opacity: 0.55 }) }}>
              <Icon name={mealIcon[x]!} /><b style={{ display: 'block', fontSize: 13, marginTop: 4 }}>{mealName(x)}</b><span className="xs" style={on ? { color: '#C9D2C9' } : {}}>{t.label}</span></button>;
          })}
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row"><b className="h2 sp">{had ? 'You have ' + m + ' already' : st.open ? 'You can take ' + m : mealName(m) + ' is closed'}</b>
            <span className={'chip ' + (had || !st.open ? 'amber' : 'leaf')} style={{ height: 26 }}><Icon name="shield-check" size={14} />Checked</span></div>
          <div className="row sm"><Icon name={had ? 'circle-x' : 'circle-check'} size={18} /><span className="sp">{had ? 'One ' + m + ' a day – yours is in your orders' : 'No ' + m + ' taken yet today'}</span><span className="xs">Mess</span></div>
          <div className="row sm"><Icon name="info" size={18} /><span className="sp">Attendance and leave come from HR when it is connected</span><span className="xs">HR</span></div>
        </div>
        {meals && <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><div className="tile s40"><Icon name={mealIcon[m]!} /></div><div className="sp"><b style={{ fontSize: 15 }}>{meals.name}</b><div className="xs">One a person</div></div><span className="chip" style={{ height: 28 }}>1</span></div>
          {extras.length > 0 && <div className="hr" />}
          {extras.map((e) => <div className="row" key={e.id}><div className="sp"><b style={{ fontSize: 15 }}>{e.name}</b><div className="xs">Extra items need the mess's OK</div></div><Stepper value={extra[e.code] || 0} onChange={(n) => setExtra((x) => ({ ...x, [e.code]: n }))} max={10} /></div>)}
        </div>}
        {m !== 'dinner' && <button className="row sm" onClick={() => setMeal('dinner')} style={{ background: 'none', border: 0, color: 'var(--leafD)', fontWeight: 600, padding: '0 4px', font: 'inherit', textAlign: 'left' }}><Icon name="clock-alert" size={16} /><span className="sp">Working late? Ask for dinner</span><Icon name="chevron-right" size={16} /></button>}
        <ErrorLine error={a.error} />
      </Body>
      <Foot>
        <div className="row xs"><Icon name="timer" size={14} /><span className="sp">Change or cancel for {w?.change_minutes ?? 0} min – until the mess accepts</span></div>
        <Btn kind="leaf" onClick={ask} busy={a.busy} disabled={!st.open || !!had || !meals || !mess}>Ask for {m}<span style={{ opacity: 0.7, fontWeight: 500 }}>· 1 {meals?.name.toLowerCase() || 'meal'}{Object.values(extra).some((n) => n > 0) ? ', ' + Object.values(extra).reduce((a2, b) => a2 + b, 0) + ' extra' : ''}</span></Btn>
      </Foot>
    </Screen>
  );
}

// A guest's open visit (the same screens serve him).
export function useGuestVisit() {
  const s = useSession();
  return useLoad(() => s.me?.kind === 'guest' ? one<{ id: string; site_id: string; section_id: string | null; purpose: string; started_at: string; host_role: string | null; host_id: string | null }>(
    db().from('guest_visits').select('id,site_id,section_id,purpose,started_at,host_role,host_id').eq('person_id', s.me.id).is('ended_at', null).limit(1)) : Promise.resolve(null), [s.me?.id]);
}

// ── e04 · Parcel ──
// (0017, his word of 23-11-2026: "only section … section che baheun koni kel asel tr … location direction he sagle hot jail") the van
// goes where he is: a section chosen by hand first; else the phone's location – the section whose area holds it, or, outside every
// section, the point itself (the kitchen and the driver get it with the directions); no location: his work place, or he chooses.
type To = { sec: Sec | null; point: boolean; why: string; asking?: boolean };
export function Parcel() {
  const s = useSession();
  const nav = useNavigate();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const items = useItems();
  const secs = useSections(mess?.site_id);
  const visit = useGuestVisit();
  const [meal, setMeal] = useState<Meal | null>(null);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [how, setHow] = useState<'delivery' | 'parcel'>('delivery');
  const [note, setNote] = useState('');
  const here = usePlace(how === 'delivery' && !pickedSection());
  const a = useAct();
  const m: Meal = meal || currentMeal(wins.data || []);
  const w = (wins.data || []).find((x) => x.meal === m);
  const st = winState(w, today(), 'parcel');
  const list = secs.data || [];
  const byHand = list.find((x) => x.id === pickedSection()) || null;
  const usual = list.find((x) => x.id === (visit.data?.section_id || s.me?.home_section_id)) || null;
  // (25-11-2026) only an exact reading finds his section or is sent as the van's place (a rough one can be kilometres off)
  const exact = here.state === 'ok' && isExact(here);
  const found = exact ? sectionAt(here, list) : null;
  const to: To = byHand ? { sec: byHand, point: false, why: 'chosen by you' }
    : exact ? (found ? { sec: found, point: false, why: 'found by your location' } : { sec: null, point: true, why: 'outside the sections' })
    : here.state === 'asking' || here.state === 'ok' ? { sec: null, point: false, why: '', asking: true }
    : usual ? { sec: usual, point: false, why: 'your work place' } : { sec: null, point: false, why: '' };
  const away = to.point && exact && mess?.lat != null && mess?.lng != null ? metres(here, { lat: Number(mess.lat), lng: Number(mess.lng) }) : null;
  // outside the mess area (an exact reading): "At the mess" cannot be chosen
  const outside = exact && mess ? atMess(here, mess) === false : false;
  const meals = (items.data || []).find((i) => i.kind === 'meal' && i.meal === m);
  const extras = (items.data || []).filter((i) => i.kind === 'extra');
  const n = Object.values(extra).reduce((x, y) => x + y, 0);
  const ask = () => a.run(async () => {
    if (how === 'delivery' && !to.sec && !to.point) throw new Error('Choose where to deliver.');
    const lines = [{ item: meals!.code }, ...Object.entries(extra).filter(([, k]) => k > 0).map(([code, k]) => ({ item: code, qty: k }))];
    // the location decides on the server (the same rule): his point is sent; a section by hand / his work place: the section
    const byPoint = how === 'delivery' && !byHand && exact;
    const r = await call<{ order_id: string | null; existing: { order_id: string }[] }>('request_order', { p_mess: mess!.id, p_date: today(), p_meal: m, p_kind: how, p_lines: lines,
      p_section: how === 'delivery' && !byPoint ? to.sec!.id : null, p_note: note || null, p_visit: visit.data?.id || null,
      p_lat: byPoint ? Number(here.lat.toFixed(6)) : null, p_lng: byPoint ? Number(here.lng.toFixed(6)) : null });
    nav('/app/orders/' + (r.order_id || r.existing[0]?.order_id));
  });
  if (s.me?.state === 'temporary') return <Screen><Top back={true} title="Parcel" /><Body><Denied text="Your temporary access is for meals at your own site's mess only." /></Body></Screen>;
  return (
    <Screen>
      <Top back={true} title={mealName(m) + ' parcel'} sub={w ? 'Order by ' + hm(w.order_by) : 'No parcels for this meal'} />
      <Body style={{ paddingBottom: 12 }}>
        <Seg value="parcel" options={[{ v: 'meal', label: 'At the mess' }, { v: 'parcel', label: 'Parcel to my site' }]} off={outside ? ['meal'] : []} onChange={(v) => v === 'meal' && nav('/app/meal')} />
        <div className="row" style={{ gap: 6 }}>{MEALS.map((x) => <button key={x} className={'chip' + (x === m ? ' on' : '')} onClick={() => setMeal(x)}>{mealName(x)}</button>)}</div>
        {how === 'delivery' && <Link className="card" to="/app/section" style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <div className={'tile ' + (to.point ? 'blue' : 'navy')}><Icon name={to.point ? 'locate-fixed' : 'map-pin'} size={22} /></div>
          <div className="sp"><span className="xs">Deliver to{to.why ? ' · ' + to.why : ''}</span>
            <b style={{ display: 'block', fontSize: 15, marginTop: 2 }}>{to.sec ? 'Section ' + to.sec.code + (to.sec.name && to.sec.name !== to.sec.code ? ' – ' + to.sec.name : '') : to.point ? 'Your location' : to.asking ? 'Finding where you are…' : 'Choose the section'}</b>
            <div className="sm">{to.sec ? [to.sec.km != null ? 'Km ' + to.sec.km : '', to.sec.place || ''].filter(Boolean).join(' · ') || ' ' : to.point ? <>{away != null && mess?.lat != null && mess?.lng != null && here.state === 'ok' ? <><RoadText from={{ lat: Number(mess.lat), lng: Number(mess.lng) }} to={{ lat: here.lat, lng: here.lng }} straight={away} /> from the mess · </> : ''}the van brings it here</> : here.state === 'off' ? 'Location is off – choose the section' : ' '}</div></div>
          <span className="sm" style={{ color: 'var(--leafD)', fontWeight: 600 }}>Change</span>
        </Link>}
        {how === 'delivery' && to.point && <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">You are outside every section. Your location goes with this order only – for the van's directions.</span></div>}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {meals && <div className="row"><div className="tile s40"><Icon name={mealIcon[m]!} /></div><div className="sp"><b style={{ fontSize: 15 }}>{meals.name}</b><div className="xs">Packed · one a person</div></div><span className="chip" style={{ height: 28 }}>1</span></div>}
          {extras.map((e) => <div className="row" key={e.id}><div className={'tile s40 ' + (e.code.startsWith('water') ? 'blue' : 'leaf')}><Icon name={e.code.startsWith('water') ? 'glass-water' : 'salad'} /></div><div className="sp"><b style={{ fontSize: 15 }}>{e.name}</b><div className="xs">Extra – needs the mess's OK</div></div><Stepper value={extra[e.code] || 0} onChange={(k) => setExtra((x) => ({ ...x, [e.code]: k }))} max={10} /></div>)}
        </div>
        <div className="col" style={{ gap: 8 }}><span className="lbl">When</span>
          <div className="row wrap" style={{ gap: 8 }}><button className={'chip' + (how === 'delivery' ? ' on' : '')} onClick={() => setHow('delivery')}>With the van</button><button className={'chip' + (how === 'parcel' ? ' on' : '')} onClick={() => setHow('parcel')}>I'll collect</button></div></div>
        <Field label="Note for the mess"><Input value={note} onChange={setNote} placeholder="e.g. no onion, leave at the site office" maxLength={300} /></Field>
        <ErrorLine error={a.error} />
      </Body>
      <Foot>
        <div className="row sm"><span className="sp">1 {meals?.name.toLowerCase() || 'meal'}{n ? ' · ' + n + ' extra' : ''}</span><span className="xs">Change or cancel for {w?.change_minutes ?? 0} min</span></div>
        <Btn kind="sf" onClick={ask} busy={a.busy} disabled={!st.open || !meals || !mess || (how === 'delivery' && !!to.asking)}><Icon name="package-check" />Ask for the parcel</Btn>
      </Foot>
    </Screen>
  );
}

// ── e05 · Section ── (0017: only sections; "By my location" leaves the choice to the phone's location again)
export function SectionPick() {
  const s = useSession();
  const nav = useNavigate();
  const { mess } = useMyMess();
  const secs = useSections(mess?.site_id || s.me?.home_site_id);
  const [sel, setSel] = useState(pickedSection() || s.me?.home_section_id || '');
  const map = useMemo(() => toMap(secs.data || []), [secs.data]);
  const list = secs.data || [];
  const chosen = list.find((x) => x.id === sel);
  const keep = (id: string) => { try { if (id) sessionStorage.setItem('falcon.section', id); else sessionStorage.removeItem('falcon.section'); } catch { /* */ } nav(-1); };
  return (
    <Screen>
      <div className="map" style={{ height: 300 }}>
        <GMap height={300} label="Map: the site's sections" fallback={<RoadMap sections={map.sections} mine={sel} height={300} label="The road with its sections" />}
          marks={list.map((x) => { const q = pt(x.lat, x.lng); return q ? { ...q, kind: x.id === sel ? 'mine' : 'stop', label: x.code, title: x.name } as Mark : null; }).filter(Boolean) as Mark[]} />
        <button className="ib" aria-label="Back" onClick={() => nav(-1)} style={{ position: 'absolute', left: 20, top: 18 }}><Icon name="chevron-left" /></button>
      </div>
      <div className="sheet" style={{ top: 270, overflowY: 'auto' }}>
        <div className="row"><b className="h2 sp">Where are you working?</b><span className="chip" style={{ height: 28 }}>{s.homeSite?.code}</span></div>
        <button className="card" onClick={() => keep('')} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <span className="tile s40 blue"><Icon name="locate-fixed" /></span>
          <div className="sp"><b style={{ fontSize: 15 }}>By my location</b><div className="xs">The section is found by itself – outside every section, the van comes to you</div></div>
          <Icon name="chevron-right" size={18} />
        </button>
        {secs.loading ? <Loading /> : secs.error ? <Failed error={secs.error} retry={secs.reload} /> : list.length === 0 ? <Empty icon="map" title="No sections yet" text="The Site Admin adds the sections." /> :
          <div className="col" style={{ gap: 8 }}>{list.map((x, i) => (
            <button key={x.id} className="card" onClick={() => setSel(x.id)} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', font: 'inherit', textAlign: 'left', cursor: 'pointer', ...(x.id === sel ? { border: '2px solid var(--leaf)' } : {}) }}>
              <span className="av" style={{ width: 34, height: 34, background: 'var(--navy)', color: '#fff' }}>{i + 1}</span>
              <div className="sp"><b style={{ fontSize: 15 }}>{x.code}{x.km != null ? ' · Km ' + x.km : ''}</b><div className="xs">{x.place || x.name}</div></div>
              <Icon name={x.id === sel ? 'circle-check' : 'circle-dot'} size={18} />
            </button>))}</div>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">A place other than your work place is shown to the Site Admin.</span></div>
        <Btn kind="leaf" disabled={!chosen} onClick={() => keep(sel)}>Deliver to {chosen ? chosen.code + (chosen.km != null ? ' · Km ' + chosen.km : '') : '…'}</Btn>
      </div>
    </Screen>
  );
}

// ── e06 · Menu ──
export function Menu() {
  const s = useSession();
  const { mess } = useMyMess();
  const [d, setD] = useState(today());
  const [meal, setMeal] = useState<Meal>('lunch');
  const wins = useWindows(mess?.id, d);
  const menu = useLoad(() => mess ? one<{ dishes: string[]; note: string | null; published_at: string }>(db().from('menus').select('dishes,note,published_at').eq('mess_id', mess.id).eq('service_date', d).eq('meal', meal).limit(1)) : Promise.resolve(null), [mess?.id, d, meal]);
  const w = (wins.data || []).find((x) => x.meal === meal);
  const days = [0, 1, 2, 3, 4].map((i) => today(i));
  return (
    <Screen>
      <Top back={s.me?.kind === 'guest' ? '/guest' : '/app'} title="Menu" sub={mess?.name || ''} right={<Link className="ib" to={'/app/menu/poster?d=' + d + '&m=' + meal} aria-label="Menu poster"><Icon name="sparkles" /></Link>} />
      <Body style={{ paddingBottom: 100 }}>
        <div className="row" style={{ gap: 8 }}>{days.map((x, i) => {
          const dt = new Date(x + 'T12:00:00+05:30');
          return <button key={x} className="card" onClick={() => setD(x)} style={{ padding: '8px 0', width: 62, textAlign: 'center', font: 'inherit', cursor: 'pointer', ...(x === d ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : i > 2 ? { opacity: 0.6 } : {}) }}>
            <span className="xs" style={{ display: 'block', ...(x === d ? { color: '#C9D2C9' } : {}) }}>{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</span><b style={{ fontSize: 18 }}>{dt.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</b></button>;
        })}</div>
        <Seg value={meal} options={MEALS.map((x) => ({ v: x, label: mealName(x) }))} onChange={setMeal} />
        {menu.loading ? <Loading /> : menu.error ? <Failed error={menu.error} retry={menu.reload} /> : !menu.data ? <Empty icon="utensils" title="The menu is not out yet" text="The mess publishes it before the meal." /> : (
          <div className="card lift" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row"><div className="sp"><b className="h2">{mealName(meal)}{w ? ' · ' + hm(w.serve_from) + ' – ' + hm(w.serve_to) : ''}</b><div className="xs">Published {time(menu.data.published_at)}</div></div></div>
            <div className="hr" />
            {menu.data.dishes.map((x) => <div className="row" key={x}><span style={{ width: 14, height: 14, border: '1.5px solid var(--leaf)', borderRadius: 3, display: 'grid', placeItems: 'center', flex: 'none' }}><i style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--leaf)', display: 'block' }} /></span><span className="sp" style={{ fontSize: 15 }}>{x}</span></div>)}
          </div>)}
        {menu.data?.note && <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#FFFBF5', borderColor: '#F1D3B0' }}><Icon name="history" size={18} /><div className="sp"><b style={{ fontSize: 14 }}>From the mess</b><div className="sm">{menu.data.note}</div></div></div>}
        {menu.data && <Btn kind="navy" to={'/app/menu/poster?d=' + d + '&m=' + meal}><Icon name="sparkles" />See the poster</Btn>}
      </Body>
      <Tabs tabs={s.me?.kind === 'guest' ? GUEST_TABS : EMP_TABS} label="Mess" />
    </Screen>
  );
}

// ── e07 · Today's poster (drawn from the published menu – the text decides what is served) ──
export function Poster() {
  const [q] = useSearchParams();
  const { mess } = useMyMess();
  const d = q.get('d') || today(), meal = (q.get('m') || 'lunch') as Meal;
  const wins = useWindows(mess?.id, d);
  const menu = useLoad(() => mess ? one<{ dishes: string[] }>(db().from('menus').select('dishes').eq('mess_id', mess.id).eq('service_date', d).eq('meal', meal).limit(1)) : Promise.resolve(null), [mess?.id, d, meal]);
  const w = (wins.data || []).find((x) => x.meal === meal);
  const head = ((mess?.name || '') + ' · ' + dayLong(d)).toUpperCase();
  const dishes = menu.data?.dishes || [];
  const save = () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(450, 450, 50, 450, 450, 800); grd.addColorStop(0, '#1C3157'); grd.addColorStop(1, '#0A1428');
    g.fillStyle = grd; g.fillRect(0, 0, 900, 1200);
    g.strokeStyle = 'rgba(217,158,57,.45)'; g.lineWidth = 2; g.strokeRect(30, 30, 840, 1140);
    g.textAlign = 'center'; g.fillStyle = '#D9B26A'; g.font = '600 26px Schibsted Grotesk, sans-serif'; g.fillText(head, 450, 110);
    g.fillStyle = '#F6E7C8'; g.font = '84px Georgia, serif'; g.fillText("Today's " + meal, 450, 220);
    g.fillStyle = '#fff'; g.font = '40px Schibsted Grotesk, sans-serif';
    dishes.forEach((x, i) => g.fillText(x, 450, 360 + i * 70));
    if (w) { g.fillStyle = '#D9B26A'; g.font = '28px Schibsted Grotesk, sans-serif'; g.fillText(hm(w.serve_from) + ' – ' + hm(w.serve_to), 450, 1120); }
    const a = document.createElement('a'); a.download = 'falcon-menu-' + d + '-' + meal + '.png'; a.href = c.toDataURL('image/png'); a.click();
  };
  const share = 'https://wa.me/?text=' + encodeURIComponent((mess?.name || '') + ' – ' + mealName(meal) + ', ' + day(d) + ':\n' + dishes.join(', ') + (w ? '\n' + hm(w.serve_from) + '–' + hm(w.serve_to) : ''));
  return (
    <Screen style={{ background: '#E9E4D8' }}>
      <Top back={true} title={"Today's poster"} sub="Drawn from the published menu" />
      {menu.loading ? <Loading /> : !menu.data ? <Body><Empty icon="sparkles" title="No menu to draw" text="The poster is drawn once the mess publishes the menu." /></Body> : <>
        <div style={{ margin: '4px 20px 0', minHeight: 480, borderRadius: 28, background: 'radial-gradient(90% 60% at 50% 38%,#1C3157 0%,#0E1B33 62%,#0A1428 100%)', color: '#fff', position: 'relative', overflow: 'hidden', boxShadow: '0 24px 50px rgba(14,27,51,.35)' }}>
          <div style={{ position: 'absolute', inset: 14, border: '1px solid rgba(217,158,57,.45)', borderRadius: 20 }} />
          <div style={{ textAlign: 'center', padding: '30px 24px 0', position: 'relative' }}>
            <span style={{ fontSize: 12, letterSpacing: '.12em', color: '#D9B26A', fontWeight: 600 }}>{head}</span>
            <p style={{ margin: '8px 0 0', fontFamily: 'Georgia,serif', fontSize: 40, lineHeight: 1.02, color: '#F6E7C8' }}>Today's {meal}</p>
          </div>
          <div style={{ position: 'relative', width: 200, height: 200, margin: '18px auto 0', borderRadius: '50%', background: 'radial-gradient(circle at 40% 35%,#F4F1EA 0%,#D9D3C5 55%,#B9B1A0 100%)', boxShadow: '0 18px 34px rgba(0,0,0,.45),inset 0 0 0 10px rgba(255,255,255,.35)' }}>
            <div style={{ position: 'absolute', left: 24, top: 28, width: 64, height: 64, borderRadius: '50%', background: 'radial-gradient(circle at 45% 40%,#F2C14E,#D79A1E)', boxShadow: 'inset 0 0 0 6px #C9C2B2' }} />
            <div style={{ position: 'absolute', left: 102, top: 20, width: 68, height: 68, borderRadius: '50%', background: 'radial-gradient(circle at 45% 40%,#D8A24A,#A8661C)', boxShadow: 'inset 0 0 0 6px #C9C2B2' }} />
            <div style={{ position: 'absolute', left: 114, top: 102, width: 60, height: 60, borderRadius: '50%', background: 'radial-gradient(circle at 45% 40%,#FFFFFF,#E8E2D2)', boxShadow: 'inset 0 0 0 6px #C9C2B2' }} />
            <div style={{ position: 'absolute', left: 28, top: 102, width: 84, height: 66, borderRadius: 46, background: 'radial-gradient(circle at 40% 40%,#FFFDF7,#EDE6D3)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px 18px', padding: '22px 34px 60px', position: 'relative', fontSize: 15 }}>
            {dishes.map((x, i) => <span key={x} style={{ textAlign: i % 2 ? 'right' : 'left' }}>{x}</span>)}
          </div>
          {w && <p style={{ position: 'absolute', left: 0, right: 0, bottom: 26, textAlign: 'center', margin: 0, fontSize: 13, color: '#D9B26A' }}>{hm(w.serve_from)} – {hm(w.serve_to)}</p>}
        </div>
        <div className="row xs" style={{ margin: '12px 24px 0', gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">The menu text decides what is served – the picture only shows it.</span></div>
        <div className="row" style={{ padding: '14px 20px 0', gap: 10 }}>
          <Btn kind="ghost" onClick={save} style={{ flex: 1 }}><Icon name="download" />Save</Btn>
          <a className="btn" href={share} target="_blank" rel="noreferrer" style={{ flex: 1, background: '#128C4A' }}><Icon name="message-circle" />WhatsApp</a>
        </div>
      </>}
    </Screen>
  );
}

// ── My orders (the Orders tab's list – each opens e08) ──
export function Orders() {
  const s = useSession();
  const list = useLoad(() => rows<Order>(db().from('orders').select('*').order('created_at', { ascending: false }).limit(40)), [s.me?.id], ['orders']);
  return (
    <Screen>
      <Top back={s.me?.kind === 'guest' ? '/guest' : '/app'} title="My orders" sub="Meals, parcels and deliveries" />
      <Body style={{ paddingBottom: 100 }}>
        {list.loading && !list.data ? <Loading /> : list.error ? <Failed error={list.error} retry={list.reload} /> : !list.data?.length ? <Empty icon="receipt" title="No orders yet" text="Scan the mess QR or ask for a parcel." /> :
          list.data.map((o) => (
            <Link key={o.id} to={'/app/orders/' + o.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: 12 }}>
              <div className="tile s40"><Icon name={o.kind === 'meal' ? 'utensils' : 'package'} /></div>
              <div className="sp"><b style={{ fontSize: 15 }}>{o.code}</b><div className="xs">{mealName(o.meal)} · {o.kind === 'meal' ? 'at the mess' : o.kind} · {day(o.service_date)}{o.is_group ? ' · group' : ''}</div></div>
              <span className={'chip ' + (['delivered'].includes(o.state) ? 'leaf' : ['refused', 'cancelled', 'failed'].includes(o.state) ? 'red' : 'amber')} style={{ height: 26 }}>{stateWord(o.state)}</span>
            </Link>))}
      </Body>
      <Tabs tabs={s.me?.kind === 'guest' ? GUEST_TABS : EMP_TABS} label="Mess" />
    </Screen>
  );
}

function useOrder(id: string | undefined) {
  return useLoad(async () => {
    const o = await one<Order>(db().from('orders').select('*').eq('id', id!).limit(1));
    if (!o) return null;
    const [lines, code, mess, sec] = await Promise.all([
      rows<Line>(db().from('order_lines').select('*,items(name,code)').eq('order_id', o.id)),
      one<{ code: string; used_at: string | null }>(db().from('delivery_codes').select('code,used_at').eq('order_id', o.id).limit(1)),
      one<{ name: string }>(db().from('messes').select('name').eq('id', o.mess_id).limit(1)),
      o.to_section_id ? one<{ code: string; km: number | null; place: string | null }>(db().from('sections').select('code,km,place').eq('id', o.to_section_id).limit(1)) : Promise.resolve(null),
    ]);
    // (23-11-2026, "falcon khup slow") only THIS order's confirmations – not every confirmation the person may read
    const ids = lines.map((l) => l.id);
    const conf = ids.length ? await rows<{ order_line_id: string; kind: string; qty_received: number | null; at: string }>(db().from('confirmations').select('order_line_id,kind,qty_received,at').in('order_line_id', ids)) : [];
    return { o, lines, code, mess, sec, conf };
  }, [id], ['orders', 'order_lines']);
}
interface Van { batch: string; code: string; state: string; dispatched_at: string | null; driver: string | null; driver_mobile: string | null; vehicle: string | null; vehicle_kind: string | null;
  stops: { seq: number; section: string; km: number | null; place: string | null; eta: string | null; reached_at: string | null; mine: boolean; point?: boolean }[] | null; last: { at: string; lat: number; lng: number } | null }
function useVan(id: string | undefined, on: boolean) {
  return useLoad(() => on ? call<Van | null>('my_van', { p_order: id }) : Promise.resolve(null), [id, on], ['batches', 'batch_stops', 'track_points']);
}

// ── e08 · Order status ──
export function OrderStatus() {
  const { id } = useParams();
  const s = useSession();
  const nav = useNavigate();
  const r = useOrder(id);
  const van = useVan(id, ['dispatched', 'delivered'].includes(r.data?.o.state || ''));
  const a = useAct();
  if (r.loading && !r.data) return <Screen><Top back={true} title="Order" /><Body><Loading /></Body></Screen>;
  if (r.error) return <Screen><Top back={true} title="Order" /><Body><Failed error={r.error} retry={r.reload} /></Body></Screen>;
  if (!r.data) return <Screen><Top back={true} title="Order" /><Body><Denied text="This order is not yours." /></Body></Screen>;
  const { o, lines, code, mess, sec, conf } = r.data;
  const mine = lines.filter((l) => l.person_id === s.me?.id);
  const what = mine.map((l) => (l.qty) + ' ' + (l.items?.name || '').toLowerCase()).join(' · ');
  const myStop = van.data?.stops?.find((x) => x.mine);
  const canCancel = o.requested_by === s.me?.id && (o.state === 'requested' || (o.state === 'accepted' && o.change_until && new Date(o.change_until) > new Date()));
  const delivered = mine.some((l) => ['served', 'delivered', 'short'].includes(l.state));
  const confirmed = mine.every((l) => conf.some((c) => c.order_line_id === l.id));
  const steps: [string, string, boolean][] = [
    ['Asked', time(o.created_at) + ' · from the app', true],
    [o.state === 'refused' ? 'Refused by the mess' : 'Accepted by the mess', o.accepted_at ? time(o.accepted_at) + (o.state === 'refused' ? ' · ' + (o.refused_reason || '') : ' · change window ' + (o.change_until && new Date(o.change_until) < new Date() ? 'closed' : 'open')) : o.host_state === 'waiting' ? 'waiting for the host\'s OK' : 'waiting', !!o.accepted_at],
    ['Preparing · Ready', o.ready_at ? 'ready ' + time(o.ready_at) : '', ['ready', 'dispatched', 'delivered'].includes(o.state)],
  ];
  if (o.kind === 'delivery') steps.push(['On the way', van.data?.dispatched_at ? time(van.data.dispatched_at) + ' · ' + (van.data.driver || '') + ' · ' + (van.data.vehicle || '') : 'with the van', ['dispatched', 'delivered'].includes(o.state)]);
  steps.push([o.kind === 'meal' ? 'Served' : 'Delivered', o.kind === 'meal' ? 'At the counter' : 'Give the driver your code, check the quantity', delivered]);
  steps.push(['Closed', 'After your confirmation', delivered && confirmed]);
  const nowAt = steps.findIndex((x) => !x[2]);
  return (
    <Screen>
      <Top back={true} title={o.code} sub={mealName(o.meal) + ' ' + (o.kind === 'meal' ? 'at the mess' : 'parcel') + ' · ' + dayLong(o.service_date)} />
      <Body style={{ paddingBottom: 24 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row"><div className="tile"><Icon name={o.kind === 'meal' ? 'utensils' : 'package'} size={22} /></div>
            <div className="sp"><b style={{ fontSize: 15 }}>{what || lines.length + ' people'}</b><div className="sm">{o.kind === 'delivery' && sec ? 'To ' + sec.code + (sec.km != null ? ' · Km ' + sec.km : '') + (sec.place ? ' · ' + sec.place : '') : o.kind === 'delivery' && o.to_lat != null ? 'To your location – outside the sections' : mess?.name}</div></div>
            <span className={'chip ' + (o.state === 'dispatched' ? 'blue' : o.state === 'delivered' ? 'leaf' : ['refused', 'cancelled', 'failed'].includes(o.state) ? 'red' : 'amber')} style={{ height: 26 }}>{stateWord(o.state)}</span></div>
        </div>
        <div className="card" style={{ padding: '18px 16px 4px' }}>
          <div className="tl">{steps.map(([t, sub, d], i) => (
            <div key={t} className={'st' + (d ? ' done' : i === nowAt ? ' now' : '')}><span className="k">{d ? <Icon name="check" size={14} /> : i === nowAt ? <Icon name={o.state === 'dispatched' ? 'truck' : 'clock'} size={14} /> : null}</span><div><b style={d || i === nowAt ? {} : { color: 'var(--muted)' }}>{t}</b><small>{sub}</small></div></div>))}</div>
        </div>
        {(code || myStop) && <div className="row" style={{ gap: 10 }}>
          {code && <div className="card" style={{ flex: 1, padding: 12 }}><span className="xs">Your code</span><b style={{ display: 'block', fontSize: 24, letterSpacing: '.12em', marginTop: 2 }}>{code.code.split('').join(' ')}</b></div>}
          {myStop?.eta && <div className="card" style={{ flex: 1, padding: 12 }}><span className="xs">Arrives about</span><b style={{ display: 'block', fontSize: 24, marginTop: 2, color: 'var(--sfD)' }}>{time(myStop.eta)}</b></div>}
        </div>}
        {o.state === 'dispatched' && <Btn kind="sf" to={'/app/orders/' + o.id + '/track'}><Icon name="navigation" />Track live</Btn>}
        {o.state === 'dispatched' && code && !code.used_at && <Btn kind="ghost" to={'/app/orders/' + o.id + '/confirm'}><Icon name="package-check" />The van is here – show my code</Btn>}
        {delivered && !confirmed && <Btn kind="leaf" to={'/app/orders/' + o.id + '/quantity'}><Icon name="package-check" />Check what I got</Btn>}
        {delivered && confirmed && <Btn kind="ghost" to={'/app/orders/' + o.id + '/review'}><Icon name="star" />Review (optional)</Btn>}
        {canCancel && <Btn kind="ghost" busy={a.busy} onClick={() => a.run(async () => { await call('cancel_order', { p_order: o.id, p_reason: 'Taken back by the person' }); r.reload(); })}><Icon name="x" />Take it back</Btn>}
        {!['cancelled', 'refused'].includes(o.state) && <Btn kind="ghost" onClick={() => nav('/app/complaints/new?order=' + o.id)}><Icon name="message-square-warning" />Something wrong? Complaint</Btn>}
        <ErrorLine error={a.error} />
      </Body>
    </Screen>
  );
}

// ── e09 · Live tracking ──
export function Track() {
  const { id } = useParams();
  const r = useOrder(id);
  const van = useVan(id, true);
  const { mess } = useMyMess();
  const secs = useSections(mess?.site_id);
  const map = useMemo(() => toMap(secs.data || []), [secs.data]);
  const v = van.data;
  if (!v) return <Screen><Top back={true} title="Track" /><Body>{van.loading ? <Loading /> : <Empty icon="truck" title="Not on the way" text="The van's place is shown only while your parcel is on the way." />}</Body></Screen>;
  const stops = v.stops || [], mine = stops.find((x) => x.mine);
  const doneN = stops.filter((x) => x.reached_at).length;
  const last = stops.filter((x) => x.reached_at).slice(-1)[0];
  const nextKm = stops.find((x) => !x.reached_at)?.km ?? null;
  const vanKm = last?.km != null && nextKm != null ? (last.km + nextKm) / 2 : (stops[0]?.km ?? null);
  const mineId = (secs.data || []).find((x) => x.code === mine?.section)?.id;
  const ago = v.last ? Math.max(0, Math.round((Date.now() - new Date(v.last.at).getTime()) / 1000)) : null;
  const mins = mine?.eta ? Math.max(0, Math.round((new Date(mine.eta).getTime() - Date.now()) / 60000)) : null;
  // (23-11-2026, picture N3) the Google map: the mess, the stops with a place, the van where its driver's phone last said; the line
  // from the van through the stops left (straight lines – the road route is Google Maps' own)
  // (0017) a stop that is a point: only his own is drawn (where he asked it to come); somebody else's is never shown
  const mineAt = r.data?.o.to_lat != null ? pt(r.data.o.to_lat, r.data.o.to_lng) : null;
  const secPt = (x: { section: string; point?: boolean; mine: boolean }) => { if (x.point) return x.mine ? mineAt : null; const y = (secs.data || []).find((z) => z.code === x.section); return y ? pt(y.lat, y.lng) : null; };
  const vanPt = v.state === 'on_the_way' && v.last ? pt(v.last.lat, v.last.lng) : null;
  const messPt = mess ? pt(mess.lat, mess.lng) : null;
  const stopMarks = stops.map((x) => { const p = secPt(x); return p ? { ...p, kind: x.mine ? 'mine' : x.reached_at ? 'done' : 'stop', label: x.point ? 'You' : x.section, title: x.point ? 'Your location' : 'Section ' + x.section } as Mark : null; }).filter(Boolean) as Mark[];
  const gMarks: Mark[] = stopMarks.length || vanPt ? [...(messPt ? [{ ...messPt, kind: 'mess', title: mess!.name } as Mark] : []), ...stopMarks, ...(vanPt ? [{ ...vanPt, kind: 'van', title: v.vehicle || 'Van' } as Mark] : [])] : [];
  const gLine = vanPt ? [vanPt, ...stops.filter((x) => !x.reached_at).map((x) => secPt(x)).filter(Boolean) as { lat: number; lng: number }[]] : undefined;
  return (
    <Screen>
      <div className="map" style={{ position: 'absolute', inset: '0 0 250px 0' }}>
        <GMap marks={gMarks} line={gLine} height="100%" label="Map: the van, the mess and the stops"
          fallback={<RoadMap sections={map.sections} mine={mineId} van={v.state === 'on_the_way' ? vanKm : null} done={(secs.data || []).filter((x) => stops.some((y) => y.section === x.code && y.reached_at)).map((x) => x.id)} height={600} label="The van on the road" />} />
      </div>
      <Link className="ib" to={'/app/orders/' + id} aria-label="Back" style={{ position: 'absolute', left: 20, top: 18, boxShadow: '0 6px 16px rgba(14,27,51,.15)' }}><Icon name="chevron-left" /></Link>
      <span className="chip" style={{ position: 'absolute', left: 76, top: 25, height: 32 }}><span className="dot sf" />{ago != null ? 'Live · updated ' + (ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' min') + ' ago' : 'Waiting for the van\'s place'}</span>
      <div className="sheet">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="sp"><span className="sm">Arriving in</span><div className="row" style={{ gap: 8, alignItems: 'baseline' }}><span className="big">{mins != null ? mins + ' min' : '–'}</span><span className="sm">{mine?.eta ? '· ' + time(mine.eta) : ''}</span></div></div>
          <div style={{ textAlign: 'right' }}><span className="xs">stop {mine?.seq || '–'} of {stops.length}</span></div>
        </div>
        <div className="row" style={{ gap: 6 }}>{stops.map((x) => <i key={x.seq} style={{ flex: 1, height: 6, borderRadius: 3, background: x.reached_at ? 'var(--leaf)' : x.mine ? '#C2560E' : '#E7E1D3' }} />)}</div>
        <div className="row xs"><span className="sp">{doneN} of {stops.length} stops done</span><span>{r.data?.o.code}</span></div>
        <Link className="card" to={'/app/orders/' + id + '/driver'} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, textDecoration: 'none', color: 'inherit' }}>
          <div className="av navy">{initials(v.driver)}</div><div className="sp"><b style={{ fontSize: 15 }}>{v.driver}</b><div className="xs">{v.vehicle} · stop {mine?.seq} of {stops.length} is yours</div></div>
          <span className="ib" aria-hidden="true" style={{ background: 'var(--leafS)', borderColor: 'transparent', color: 'var(--leafD)' }}><Icon name="phone" /></span>
        </Link>
      </div>
    </Screen>
  );
}

// ── e10 · Driver details ──
export function DriverCard() {
  const { id } = useParams();
  const van = useVan(id, true);
  const v = van.data;
  if (!v) return <Screen><Top back={true} title="Driver" /><Body>{van.loading ? <Loading /> : <Empty icon="truck" title="Not on the way" />}</Body></Screen>;
  const tel = v.driver_mobile;
  return (
    <Screen>
      <div className="map" style={{ position: 'absolute', inset: '0 0 480px 0', background: 'var(--navy)' }} />
      <Link className="ib" to={'/app/orders/' + id + '/track'} aria-label="Back" style={{ position: 'absolute', left: 20, top: 18 }}><Icon name="chevron-left" /></Link>
      <div className="sheet" style={{ top: 120 }}>
        <div className="row" style={{ gap: 14 }}><div className="av lg navy">{initials(v.driver)}</div><div className="sp"><b style={{ fontSize: 19 }}>{v.driver}</b><div className="sm">Mess driver · batch {v.code}</div></div></div>
        <div className="row" style={{ gap: 10 }}>
          {tel ? <a className="btn leaf" href={'tel:' + tel} style={{ flex: 1, height: 48 }}><Icon name="phone" />Call</a> : <Btn kind="leaf" disabled style={{ flex: 1, height: 48 }}><Icon name="phone" />Call</Btn>}
          {tel ? <a className="btn ghost" href={'https://wa.me/' + tel.replace(/\D/g, '')} target="_blank" rel="noreferrer" style={{ flex: 1, height: 48 }}><Icon name="message-circle" />Message</a> : <Btn kind="ghost" disabled style={{ flex: 1, height: 48 }}><Icon name="message-circle" />Message</Btn>}
        </div>
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'var(--cream)' }}><div className="tile s40 navy"><Icon name="truck" /></div><div className="sp"><b style={{ fontSize: 15, letterSpacing: '.04em' }}>{v.vehicle}</b><div className="xs">{v.vehicle_kind}</div></div></div>
        <div className="col" style={{ gap: 2 }}>
          <span className="lbl">This trip · {v.stops?.length || 0} stops</span>
          {(v.stops || []).map((x, i, all) => {
            const now = !x.reached_at && all.slice(0, i).every((y) => y.reached_at);
            return <div key={x.seq} className="row" style={{ padding: '8px 0', borderBottom: i < all.length - 1 ? '1px solid var(--line)' : 0 }}>
              <span className={'dot ' + (x.reached_at ? '' : x.mine ? 'sf' : now ? 'blue' : 'grey')} />
              {x.mine ? <b className="sp" style={{ fontSize: 14 }}>{x.seq} · {x.section}{x.km != null ? ' Km ' + x.km : ''} – you</b> : <span className="sp" style={{ fontSize: 14, ...(x.reached_at || now ? {} : { color: 'var(--muted)' }) }}>{x.seq} · {x.section}{x.km != null ? ' Km ' + x.km : ''}</span>}
              <span className="xs" style={x.mine ? { color: 'var(--sfD)', fontWeight: 700 } : now ? { color: '#1747A6', fontWeight: 600 } : {}}>{x.reached_at ? 'Reached ' + time(x.reached_at) : now ? 'Next' : x.eta ? time(x.eta) : ''}</span>
            </div>;
          })}
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">His place and number are shown only during this trip and stop when it ends.</span></div>
      </div>
    </Screen>
  );
}

// ── e11 · Delivery confirmation (show the code) ──
export function ShowCode() {
  const { id } = useParams();
  const s = useSession();
  const r = useOrder(id);
  const van = useVan(id, true);
  if (!r.data) return <Screen><Top back={true} title="Your parcel" /><Body>{r.loading ? <Loading /> : <Denied />}</Body></Screen>;
  const { o, lines, code } = r.data;
  const mine = lines.filter((l) => l.person_id === s.me?.id);
  const used = !!code?.used_at;
  return (
    <Screen>
      <Top back={true} title={used ? 'Code taken' : 'Your parcel is here'} sub={o.code} />
      <Body style={{ gap: 16 }}>
        <div className="hero" style={{ textAlign: 'center', padding: '26px 18px' }}>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}><div className="av navy" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(van.data?.driver)}</div><span className="sm">{van.data?.driver || 'The driver'} has your parcel</span></div>
          <p style={{ margin: '18px 0 6px', fontSize: 14, color: '#C9D2E0' }}>{used ? 'He has typed your code – it is delivered' : 'Show this code to the driver'}</p>
          <div className="row" style={{ justifyContent: 'center', gap: 10 }}>{(code?.code || '----').split('').map((d, i) => <span key={i} style={{ width: 60, height: 72, borderRadius: 16, background: '#22385F', display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 700, color: '#F2C14E' }}>{d}</span>)}</div>
          <p style={{ margin: '14px 0 0' }} className="xs">He types it in his app – that proves you got it.</p>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <b className="h2">He is handing over</b>
          {mine.map((l) => <div className="row" key={l.id}><div className={'tile s40 ' + (l.is_meal ? '' : 'blue')}><Icon name={l.is_meal ? 'soup' : 'glass-water'} /></div><span className="sp" style={{ fontSize: 15 }}>{l.items?.name}</span><b>× {l.qty}</b></div>)}
        </div>
        <span className="sp" />
        <Btn kind="leaf" to={'/app/orders/' + o.id + '/quantity'} disabled={!used}><Icon name="package-check" />I have it – check what I got</Btn>
        <Btn kind="ghost" to={'/app/complaints/new?order=' + o.id + '&cat=missing'} style={{ marginBottom: 22 }}>Not with me – report</Btn>
      </Body>
    </Screen>
  );
}

// ── e12 · Quantity received ──
export function Received() {
  const { id } = useParams();
  const s = useSession();
  const nav = useNavigate();
  const r = useOrder(id);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [food, setFood] = useState('hot');
  const [box, setBox] = useState('sealed');
  const a = useAct();
  if (!r.data) return <Screen><Top back={true} title="What did you get?" /><Body>{r.loading ? <Loading /> : <Denied />}</Body></Screen>;
  const { o, lines } = r.data;
  const mine = lines.filter((l) => l.person_id === s.me?.id && ['served', 'delivered', 'short'].includes(l.state));
  const got = (l: Line) => qty[l.id] ?? (l.delivered_qty ?? l.qty);
  const short = mine.filter((l) => got(l) < (l.delivered_qty ?? l.qty));
  const confirm = () => a.run(async () => {
    for (const l of mine) await call('report_received', { p_line: l.id, p_qty: got(l), p_food: o.kind === 'meal' ? null : food, p_box: o.kind === 'meal' ? null : box });
    nav('/app/orders/' + o.id + '/review');
  });
  return (
    <Screen>
      <Top back={true} title="What did you get?" sub={o.code} />
      <Body style={{ paddingBottom: 12 }}>
        {mine.length === 0 ? <Empty icon="package" title="Nothing handed over yet" /> : <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mine.map((l, i) => <div key={l.id}>{i > 0 && <div className="hr" style={{ marginBottom: 14 }} />}<div className="row"><div className={'tile s40 ' + (l.is_meal ? '' : 'blue')}><Icon name={l.is_meal ? 'soup' : 'glass-water'} /></div>
            <div className="sp"><b style={{ fontSize: 15 }}>{l.items?.name}</b><div className="xs">Handed over {l.delivered_qty ?? l.qty}</div></div><Stepper value={got(l)} onChange={(n) => setQty((x) => ({ ...x, [l.id]: n }))} max={l.delivered_qty ?? l.qty} /></div></div>)}
          {short.length > 0 && <div className="row sm" style={{ background: 'var(--redS)', color: '#8B1A1A', borderRadius: 12, padding: '10px 12px', gap: 8 }}><Icon name="package-x" size={18} /><span className="sp">{short.map((l) => ((l.delivered_qty ?? l.qty) - got(l)) + ' ' + (l.items?.name || '').toLowerCase()).join(', ')} short – the mess is told at once</span></div>}
        </div>}
        {o.kind !== 'meal' && <>
          <div className="col" style={{ gap: 8 }}><span className="lbl">The food was</span><div className="row" style={{ gap: 8 }}>{['hot', 'warm', 'cold'].map((x) => <button key={x} className={'chip' + (food === x ? ' on' : '')} onClick={() => setFood(x)}>{x === 'hot' && <Icon name="thermometer" size={14} />}{mealName(x)}</button>)}</div></div>
          <div className="col" style={{ gap: 8 }}><span className="lbl">The box was</span><div className="row" style={{ gap: 8 }}>{['sealed', 'open', 'leaking'].map((x) => <button key={x} className={'chip' + (box === x ? ' on' : '')} onClick={() => setBox(x)}>{mealName(x)}</button>)}</div></div>
        </>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Only what you received is billed to the contractor.</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="sf" onClick={confirm} busy={a.busy} disabled={!mine.length}>Confirm · {mine.map((l) => got(l) + ' ' + (l.items?.name || '').toLowerCase()).join(', ')}</Btn></Foot>
    </Screen>
  );
}

// ── e13 · Review (optional – never stops anything) ──
export function Review() {
  const { id } = useParams();
  const s = useSession();
  const nav = useNavigate();
  const r = useOrder(id);
  const [stars, setStars] = useState<Record<string, number>>({ overall: 4, taste: 4, quantity: 4, hot: 4, delivery: 4 });
  const [liked, setLiked] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const a = useAct();
  const words = ['', 'Poor', 'Not good', 'OK', 'Good', 'Very good'];
  const Stars = ({ k, big }: { k: string; big?: boolean }) => <span className="row" style={{ gap: big ? 6 : 2, justifyContent: big ? 'center' : undefined }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-label={n + ' stars'} onClick={() => setStars((x) => ({ ...x, [k]: n }))} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: n <= (stars[k] || 0) ? 'var(--gold)' : '#DCD5C5' }}><Icon name="star" size={big ? 32 : 18} /></button>)}</span>;
  const send = () => a.run(async () => {
    await call('review_order', { p_order: id, p_overall: stars.overall, p_taste: stars.taste, p_quantity: stars.quantity, p_hot: stars.hot, p_delivery: r.data?.o.kind === 'delivery' ? stars.delivery : null, p_liked: liked, p_comment: comment || null });
    nav(s.me?.kind === 'guest' ? '/guest' : '/app');
  });
  const tags = ['Tasty', 'On time', 'Clean box', 'Fresh chapati', 'Polite driver'];
  return (
    <Screen>
      <Top back={true} title={'How was ' + (r.data ? r.data.o.meal : 'it') + '?'} sub={r.data?.mess?.name || ''} />
      <Body style={{ gap: 16 }}>
        <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}><Stars k="overall" big /><b style={{ display: 'block', marginTop: 10, fontSize: 18 }}>{words[stars.overall!]}</b><span className="xs">Tap the stars</span></div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[['taste', 'Taste'], ['quantity', 'Quantity'], ['hot', 'Hot when it came'], ...(r.data?.o.kind === 'delivery' ? [['delivery', 'Delivery']] : [])].map(([k, l]) => <div className="row" key={k}><span className="sp" style={{ fontSize: 15 }}>{l}</span><Stars k={k!} /></div>)}
        </div>
        <div className="col" style={{ gap: 8 }}><span className="lbl">What was good</span><div className="row wrap" style={{ gap: 8 }}>{tags.map((t) => <button key={t} className={'chip' + (liked.includes(t) ? ' on' : '')} onClick={() => setLiked((x) => x.includes(t) ? x.filter((y) => y !== t) : [...x, t])}>{t}</button>)}</div></div>
        <textarea className="inp" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything for the mess? (optional)" maxLength={500} style={{ height: 84, padding: '14px', font: 'inherit', resize: 'none' }} />
        <Link className="row sm" to={'/app/complaints/new?order=' + id} style={{ textDecoration: 'none', color: '#9B1C1C', fontWeight: 600, gap: 8 }}><Icon name="message-square-warning" size={16} /><span className="sp">Something wrong? Make a complaint</span><Icon name="chevron-right" size={16} /></Link>
        <ErrorLine error={a.error} />
        <span className="sp" />
        <Btn kind="leaf" onClick={send} busy={a.busy}>Send review</Btn>
        <Btn kind="ghost" to={s.me?.kind === 'guest' ? '/guest' : '/app'} style={{ marginBottom: 22 }}>Skip</Btn>
      </Body>
    </Screen>
  );
}

// ── e14 · Complaint – photo, voice ──
const CATS: [string, string][] = [['quality', 'Food quality'], ['taste', 'Taste'], ['quantity', 'Quantity'], ['temperature', 'Temperature'], ['cleanliness', 'Cleanliness'], ['water', 'Water'], ['delay', 'Delay'], ['missing', 'Missing meal'], ['other', 'Other']];
export function Complaint() {
  const s = useSession();
  const nav = useNavigate();
  const [q] = useSearchParams();
  const { mess } = useMyMess();
  const order = q.get('order');
  const ord = useLoad(() => order ? one<{ code: string; meal: string; service_date: string; mess_id: string }>(db().from('orders').select('code,meal,service_date,mess_id').eq('id', order).limit(1)) : Promise.resolve(null), [order]);
  const [cat, setCat] = useState(q.get('cat') || 'quality');
  const [serious, setSerious] = useState(false);
  const [text, setText] = useState('');
  const [heard, setHeard] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const a = useAct();
  useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, [rec]);
  const record = async () => {
    if (rec) { rec.stop(); setRec(null); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = () => { setVoice(new Blob(parts, { type: r.mimeType || 'audio/webm' })); stream.getTracks().forEach((t) => t.stop()); };
      const SR = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; start: () => void; stop: () => void } }).webkitSpeechRecognition;
      if (SR) { const sr = new SR(); sr.lang = 'mr-IN'; sr.continuous = true; sr.onresult = (e) => setHeard(Array.from(e.results).map((x) => x[0]!.transcript).join(' ')); sr.start(); r.addEventListener('stop', () => sr.stop()); }
      setSecs(0); r.start(); setRec(r);
    } catch { a.setError('The microphone is not allowed – write it instead.'); }
  };
  const send = () => a.run(async () => {
    const messId = ord.data?.mess_id || mess?.id;
    if (!messId) throw new Error('Choose the mess first.');
    if (!text.trim() && !heard.trim() && !photos.length && !voice) throw new Error('Say, write or show what is wrong.');
    const uid = s.session!.user.id, base = s.me!.company_id + '/' + uid + '/' + Date.now();
    const up = async (b: Blob, name: string) => { const p = base + '-' + name; const r2 = await supabase!.storage.from('complaint-media').upload(p, b, { contentType: b.type }); if (r2.error) throw new Error('A photo could not be sent – try again.'); return p; };
    const paths: string[] = []; for (const [i, p] of photos.entries()) paths.push(await up(p, 'photo' + i + '.jpg'));
    const vp = voice ? await up(voice, 'voice.webm') : null;
    const r = await call<{ id: string; code: string }>('raise_complaint', { p_mess: messId, p_category: cat, p_text: text || null, p_heard: heard || null, p_photos: paths, p_voice: vp, p_order: order, p_people: 1, p_serious: serious });
    nav('/app/complaints/' + r.id);
  });
  return (
    <Screen>
      <Top back={true} title="Complaint" sub={ord.data ? 'About ' + ord.data.code + ' · ' + ord.data.meal + ', ' + day(ord.data.service_date) : mess?.name || ''} />
      <Body style={{ paddingBottom: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>{CATS.map(([v, l]) => <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => setCat(v)}>{l}</button>)}</div>
        <button className="card" onClick={() => setSerious((x) => !x)} aria-pressed={serious} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', font: 'inherit', textAlign: 'left', cursor: 'pointer', ...(serious || cat === 'cleanliness' ? { border: '2px solid #E8A49B', background: '#FFF8F6' } : {}) }}>
          <div className="tile s40 red"><Icon name="siren" /></div>
          <div className="sp"><b style={{ fontSize: 15, color: '#8B1A1A' }}>Serious – health or a foreign object</b><div className="xs">Site Admin and the mess are alerted now</div></div>
          <span style={{ width: 46, height: 28, borderRadius: 14, background: serious || cat === 'cleanliness' ? 'var(--red)' : '#DCD5C5', position: 'relative', flex: 'none' }}><i style={{ position: 'absolute', [serious || cat === 'cleanliness' ? 'right' : 'left']: 3, top: 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block' }} /></span>
        </button>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><button className="tile s40" onClick={record} aria-label={rec ? 'Stop' : 'Speak'} style={{ background: rec ? 'var(--red)' : 'var(--leaf)', color: '#fff', border: 0, cursor: 'pointer' }}><Icon name={rec ? 'square' : 'mic'} /></button>
            <div className="sp sm">{rec ? 'Listening… tap to stop' : voice ? 'Voice kept' : 'Tap and say it (Marathi, Hindi or English)'}</div><span className="xs">{rec || voice ? '0:' + String(secs).padStart(2, '0') : ''}</span></div>
          {heard && <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '10px 12px', fontSize: 14, lineHeight: 1.45 }}><span className="xs" style={{ display: 'block', marginBottom: 2 }}>Heard</span>{heard}</div>}
          <textarea className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or write it" maxLength={1000} style={{ height: 72, padding: 12, font: 'inherit', resize: 'none' }} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          {photos.map((p, i) => <img key={i} alt={'Photo ' + (i + 1)} src={URL.createObjectURL(p)} style={{ width: 96, height: 96, borderRadius: 16, objectFit: 'cover' }} />)}
          {photos.length < 3 && <label style={{ width: 96, height: 96, borderRadius: 16, border: '1.5px dashed var(--line2)', display: 'grid', placeItems: 'center', color: 'var(--muted)', cursor: 'pointer' }}><Icon name="camera" size={24} /><input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && setPhotos((x) => [...x, e.target.files![0]!])} /></label>}
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="ticket" size={14} /><span className="sp">A ticket opens; you confirm when it is solved.</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="red" onClick={send} busy={a.busy}><Icon name="send" />Send complaint</Btn></Foot>
    </Screen>
  );
}

// A complaint's own page (the ticket): its state, the mess's reply, and "solved / not yet".
export function ComplaintTicket() {
  const { id } = useParams();
  const c = useLoad(() => one<{ id: string; code: string; category: string; state: string; text: string | null; heard_text: string | null; owner_reply: string | null; owner_action: string | null; due_at: string; created_at: string; serious: boolean; found_true: boolean | null }>(
    db().from('complaints').select('*').eq('id', id!).limit(1)), [id], ['complaints']);
  const a = useAct();
  const x = c.data;
  return (
    <Screen>
      <Top back={true} title={x?.code || 'Complaint'} sub={x ? x.category + (x.serious ? ' · serious' : '') : ''} />
      <Body>
        {c.loading && !x ? <Loading /> : !x ? <Denied /> : <>
          <div className="card" style={{ padding: '16px 14px 2px' }}><div className="tl">
            <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>Raised</b><small>{time(x.created_at)} · {x.text || x.heard_text}</small></div></div>
            <div className={'st' + (x.owner_reply ? ' done' : ' now')}><span className="k">{x.owner_reply ? <Icon name="check" size={14} /> : <Icon name="clock" size={14} />}</span><div><b>The mess's reply</b><small>{x.owner_reply ? x.owner_reply + (x.owner_action ? ' · ' + x.owner_action : '') : 'due ' + time(x.due_at)}</small></div></div>
            <div className={'st' + (x.state === 'closed' ? ' done' : x.state === 'answered' ? ' now' : '')}><span className="k">{x.state === 'closed' && <Icon name="check" size={14} />}</span><div><b style={x.state === 'closed' ? {} : { color: 'var(--muted)' }}>{x.state === 'closed' ? 'Closed' + (x.found_true != null ? ' · ' + (x.found_true ? 'found true' : 'not found true') : '') : 'You say if it is solved'}</b><small>then the supervisor closes it</small></div></div>
          </div></div>
          {x.state === 'answered' && <div className="row" style={{ gap: 10 }}>
            <Btn kind="leaf" busy={a.busy} onClick={() => a.run(async () => { await call('complaint_solved', { p_id: x.id, p_solved: true }); c.reload(); })} style={{ flex: 1 }}>Solved</Btn>
            <Btn kind="ghost" busy={a.busy} onClick={() => a.run(async () => { await call('complaint_solved', { p_id: x.id, p_solved: false }); c.reload(); })} style={{ flex: 1 }}>Not yet</Btn>
          </div>}
          <ErrorLine error={a.error} />
        </>}
      </Body>
    </Screen>
  );
}

// ── e15 · Guest request (a guest without the app) ──
export function GuestRequest() {
  const s = useSession();
  const nav = useNavigate();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: '', mobile: '', kind: 'Visitor', organisation: '', designation: '', purpose: '' });
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [visit, setVisit] = useState<{ visit: string; name: string } | null>(null);
  const [meal, setMeal] = useState<Meal | null>(null);
  const a = useAct();
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (s.me?.state !== 'verified' && s.me?.state !== 'linked' && s.me?.state !== 'id_assigned') return <Screen><Top back={true} title="Food as a guest" /><Body><Denied text="A checked employee brings a guest." /></Body></Screen>;
  const m: Meal = meal || currentMeal(wins.data || []);
  const sendCode = () => a.run(async () => { const r = await api<{ token: string }>('/api/guest-pass', { mobile: f.mobile }); setToken(r.token); });
  const check = (c: string) => a.run(async () => {
    const r = await api<{ visit: string; name: string }>('/api/guest-pass', { token, code: c, name: f.name, organisation: f.organisation || f.kind, designation: f.designation, purpose: f.purpose, site: mess?.site_id });
    setVisit(r); setStep(2);
  });
  const order = (kind: 'meal' | 'parcel') => a.run(async () => {
    const r = await call<{ order_id: string }>('order_for_guest', { p_visit: visit!.visit, p_mess: mess!.id, p_date: today(), p_meal: m, p_kind: kind });
    nav('/app/orders/' + r.order_id);
  });
  return (
    <Screen>
      <Top back={true} title="Food as a guest" sub={(mess?.name || '') + ' · no employee code needed'} />
      <Body style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}><span className={'chip' + (step === 1 ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }}>1 · Who the guest is</span><span className={'chip' + (step === 2 ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }}>2 · Meal and place</span></div>
        {step === 1 ? <>
          <Field label="Full name"><Input value={f.name} onChange={set('name')} placeholder="Guest's name" /></Field>
          <Field label="Mobile number"><Input value={f.mobile} onChange={set('mobile')} placeholder="10 digits" inputMode="tel" maxLength={14} icon="phone" /></Field>
          {token ? <><span className="lbl">The code the guest got on WhatsApp</span><CodeBoxes value={code} onChange={(v) => { setCode(v); if (v.length === 6) void check(v); }} /></>
            : <Btn kind="ghost" onClick={sendCode} busy={a.busy} disabled={!f.mobile}><Icon name="message-circle" />Send the guest a code</Btn>}
          <div className="col" style={{ gap: 8 }}><span className="lbl">The guest is</span><div className="row wrap" style={{ gap: 6 }}>{['Company guest', 'Client', 'Govt officer', 'Visitor', 'Subcontractor', 'Vendor'].map((k) => <button key={k} className={'chip' + (f.kind === k ? ' on' : '')} onClick={() => set('kind')(k)}>{k}</button>)}</div></div>
          <div className="row" style={{ gap: 10 }}><div style={{ flex: 1 }}><Field label="Company"><Input value={f.organisation} onChange={set('organisation')} placeholder="optional" /></Field></div><div style={{ flex: 1 }}><Field label="Designation"><Input value={f.designation} onChange={set('designation')} placeholder="optional" /></Field></div></div>
          <Field label="Purpose of visit"><Input value={f.purpose} onChange={set('purpose')} placeholder="e.g. shuttering work at B2" /></Field>
          <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">One guest profile for every visit – his own ticket and bill line.</span></div>
        </> : <>
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="av plum">{initials(visit?.name)}</div><div className="sp"><b>{visit?.name}</b><div className="xs">Guest · your visit</div></div><span className="chip leaf" style={{ height: 26 }}><Icon name="check" size={14} />Code OK</span></div>
          <div className="row" style={{ gap: 6 }}>{MEALS.map((x) => <button key={x} className={'chip' + (x === m ? ' on' : '')} onClick={() => setMeal(x)}>{mealName(x)}</button>)}</div>
          <Btn kind="leaf" onClick={() => order('meal')} busy={a.busy}><Icon name="utensils" />{mealName(m)} at the mess</Btn>
          <Btn kind="ghost" onClick={() => order('parcel')} busy={a.busy}><Icon name="package" />{mealName(m)} parcel</Btn>
        </>}
        <ErrorLine error={a.error} />
      </Body>
    </Screen>
  );
}

// ── e16 · Group request ──
export function Group() {
  const s = useSession();
  const nav = useNavigate();
  const { mess } = useMyMess();
  const wins = useWindows(mess?.id, today());
  const secs = useSections(mess?.site_id);
  const [kind, setKind] = useState<'delivery' | 'meal'>('delivery');
  const [sec, setSec] = useState(s.me?.home_section_id || '');
  const [meal, setMeal] = useState<Meal | null>(null);
  const m: Meal = meal || currentMeal(wins.data || []);
  const team = useLoad(() => sec ? call<{ person_id: string; full_name: string; work_role: string | null; state: string; has_meal: boolean; existing_order: string | null }[]>('team_for_group', { p_section: sec, p_date: today(), p_meal: m }) : Promise.resolve([]), [sec, m]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const a = useAct();
  if (!s.me?.may_group) return <Screen><Top back={true} title="Meals for my team" /><Body><Denied text="Asking for others needs the Site Admin's permission." /></Body></Screen>;
  const can = (team.data || []).filter((p) => !p.has_meal && p.state !== 'temporary');
  const chosen = can.filter((p) => sel[p.person_id] ?? true);
  const temps = (team.data || []).filter((p) => p.state === 'temporary');
  const secRow = (secs.data || []).find((x) => x.id === sec);
  const ask = () => a.run(async () => {
    const lines = chosen.map((p) => ({ person: p.person_id === s.me!.id ? '' : p.person_id, item: (m as string) }));
    const r = await call<{ order_id: string | null; existing: { order_id: string }[] }>('request_order', { p_mess: mess!.id, p_date: today(), p_meal: m, p_kind: kind, p_lines: lines, p_section: kind === 'delivery' ? sec : null });
    nav('/app/orders/' + (r.order_id || r.existing[0]?.order_id));
  });
  return (
    <Screen>
      <Top back={true} title={mealName(m) + ' for my team'} sub={s.me.full_name + ' · allowed by Site Admin'} />
      <Body style={{ gap: 10, paddingBottom: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}><button className={'chip' + (kind === 'delivery' ? ' on' : '')} onClick={() => setKind('delivery')}>Parcel to {secRow?.code || 'section'}</button><button className={'chip' + (kind === 'meal' ? ' on' : '')} onClick={() => setKind('meal')}>At the mess</button>
          <select value={sec} onChange={(e) => setSec(e.target.value)} className="chip" aria-label="Section" style={{ font: 'inherit' }}>{(secs.data || []).map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></div>
        <div className="row" style={{ gap: 6 }}>{MEALS.map((x) => <button key={x} className={'chip' + (x === m ? ' on' : '')} onClick={() => setMeal(x)}>{mealName(x)}</button>)}</div>
        <div className="row"><b className="sp" style={{ fontSize: 15 }}>My team · {secRow?.code || ''}</b><button className="sm" onClick={() => setSel({})} style={{ background: 'none', border: 0, color: 'var(--leafD)', fontWeight: 600 }}>All</button></div>
        {team.loading ? <Loading /> : team.error ? <Failed error={team.error} retry={team.reload} /> : (team.data || []).length === 0 ? <Empty icon="users" title="Nobody at this section" /> :
          <div className="card" style={{ padding: '4px 14px' }}>{(team.data || []).map((p, i, all) => {
            const off = p.has_meal || p.state === 'temporary', on = !off && (sel[p.person_id] ?? true);
            return <button key={p.person_id} onClick={() => !off && setSel((x) => ({ ...x, [p.person_id]: !on }))} className="row" style={{ padding: '10px 0', borderBottom: i < all.length - 1 ? '1px solid var(--line)' : 0, width: '100%', background: 'none', border: 0, borderRadius: 0, font: 'inherit', textAlign: 'left', opacity: off ? 0.5 : 1, cursor: off ? 'default' : 'pointer' }}>
              <span style={{ width: 24, height: 24, borderRadius: 7, background: on ? 'var(--leaf)' : 'transparent', border: on ? 0 : '1.5px solid var(--line2)', color: '#fff', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={14} />}</span>
              <div className="sp"><b style={{ fontSize: 14 }}>{p.full_name}</b><div className="xs">{p.work_role || 'Employee'}{p.has_meal ? ' · has it already (' + p.existing_order + ')' : p.state === 'temporary' ? ' · temporary' : ''}</div></div></button>;
          })}</div>}
        {temps.length > 0 && <div className="row sm" style={{ background: 'var(--amberS)', color: 'var(--amber)', borderRadius: 14, padding: '10px 12px', gap: 8 }}><Icon name="info" size={16} /><span className="sp">{temps.map((t) => firstName(t.full_name)).join(', ')} {temps.length > 1 ? 'are' : 'is'} temporary – the meal is at the mess, asked by himself.</span></div>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="users" size={14} /><span className="sp">Each meal is in that person's own record. You confirm for those without a phone.</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn kind="sf" onClick={ask} busy={a.busy} disabled={!chosen.length || !mess}><Icon name="users" />Ask for {chosen.length} {kind === 'delivery' ? 'parcels' : 'at the mess'}</Btn></Foot>
    </Screen>
  );
}

// "Me": who he is, his notifications, sign out.
export function Me() {
  const s = useSession();
  const notes = useLoad(() => rows<{ id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }>(db().from('notifications').select('*').order('created_at', { ascending: false }).limit(30)), [s.me?.id], ['notifications']);
  useEffect(() => { if (notes.data?.some((n) => !n.read_at)) void call('mark_read', { p_id: null }).catch(() => undefined); }, [notes.data]);
  return (
    <Screen>
      <Top left={<div className="av">{initials(s.me?.full_name)}</div>} title={s.me?.full_name || ''} sub={[s.me?.rcl_id, s.homeSite?.code, s.me?.state].filter(Boolean).join(' · ')} />
      <Body style={{ paddingBottom: 100 }}>
        <b className="h2">Notifications</b>
        {notes.loading && !notes.data ? <Loading /> : !notes.data?.length ? <Empty icon="bell" title="Nothing new" /> :
          notes.data.map((n) => <Link key={n.id} to={n.link || '#'} className="card" style={{ padding: 12, textDecoration: 'none', color: 'inherit', display: 'flex', gap: 10 }}>
            <span className={'dot ' + (n.read_at ? 'grey' : 'sf')} style={{ marginTop: 6 }} /><div className="sp"><b style={{ fontSize: 14 }}>{n.title}</b>{n.body && <div className="xs">{n.body}</div>}</div><span className="xs">{time(n.created_at)}</span></Link>)}
        <Btn kind="ghost" onClick={() => void s.signOut()}><Icon name="log-out" />Sign out</Btn>
      </Body>
      <Tabs tabs={s.me?.kind === 'guest' ? GUEST_TABS : EMP_TABS} label="Mess" />
    </Screen>
  );
}
