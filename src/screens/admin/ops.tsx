// The web's operations and insight: w01 dashboard, w07 daily consumption, w14 complaints, w15 audit log, w11 reports, w12 analytics,
// w13 contractor scorecard.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { call, db, rows, settingNum, useAct, useLoad, useSettings } from '../../lib/db';
import { useSession } from '../../lib/session';
import { day, dayLong, inr, leftText, num, time, today } from '../../lib/fmt';
import { Icon } from '../../ui/Icon';
import { ErrorLine, Failed, Input, Loading } from '../../ui/kit';
import { Kpi, SitePick, Tbl, Web, csv } from '../../ui/web';

interface Stat { site_id: string; mess_id: string; service_date: string; breakfast: number; lunch: number; snacks: number; dinner: number; meals: number; guests: number; parcels: number; not_confirmed: number; failed: number; cancelled: number; short: number }
const sum = (a: Stat[], k: keyof Stat) => a.reduce((n, x) => n + Number(x[k] || 0), 0);
function useStats(from: string, to: string) { return useLoad(() => call<Stat[]>('office_stats', { p_from: from, p_to: to }), [from, to], ['order_lines']); }
function useMesses() { return useLoad(() => rows<{ id: string; name: string; site_id: string; contractor_id: string | null; contractors: { name: string } | null }>(db().from('messes').select('id,name,site_id,contractor_id,contractors(name)').order('name')), []); }

// ── w01 · Dashboard ──
export function Dashboard() {
  const s = useSession();
  const [site, setSite] = useState('');
  const st = useStats(today(-13), today());
  const del = useLoad(() => call<{ mess_id: string; stops: number; on_time: number }[]>('office_delivery', { p_from: today(), p_to: today() }), []);
  const comp = useLoad(() => rows<{ id: string; code: string; category: string; serious: boolean; due_at: string; site_id: string; state: string }>(db().from('complaints').select('id,code,category,serious,due_at,site_id,state').neq('state', 'closed').order('due_at')), [], ['complaints']);
  const regs = useLoad(() => rows<{ id: string; site_id: string | null }>(db().from('registrations').select('id,site_id').is('decided_at', null)), [], ['registrations']);
  const docs = useLoad(() => rows<{ id: string; kind: string; valid_to: string; contractors: { name: string } | null }>(db().from('contractor_documents').select('id,kind,valid_to,contractors(name)').neq('state', 'rejected').lte('valid_to', today(60)).gte('valid_to', today(-1))), []);
  const messes = useMesses();
  const f = (x: { site_id?: string | null }) => !site || x.site_id === site;
  const all = (st.data || []).filter(f), todays = all.filter((x) => x.service_date === today());
  const days = Array.from({ length: 14 }, (_, i) => today(i - 13));
  const perDay = days.map((d) => sum(all.filter((x) => x.service_date === d), 'meals'));
  const max = Math.max(1, ...perDay);
  const onTime = (del.data || []).reduce((a, x) => ({ s: a.s + x.stops, o: a.o + x.on_time }), { s: 0, o: 0 });
  const openC = (comp.data || []).filter(f);
  return (
    <Web title={dayLong(today())} roles={['system_admin', 'management', 'accounts', 'site_admin', 'mess_supervisor']}
      actions={<><SitePick value={site} onChange={setSite} all /><Link className="wbtn pri" to="/admin/reports"><Icon name="download" size={16} />Day report</Link></>}>
      {st.error && <Failed error={st.error} retry={st.reload} />}
      <div className="kpis">
        <Kpi label="Meals served today" value={num(sum(todays, 'meals'))} note={s.sites.filter((x) => !site || x.id === site).map((x) => x.code + ' ' + sum(todays.filter((y) => y.site_id === x.id), 'meals')).join(' · ')} />
        <Kpi label="Parcels on time" value={onTime.s ? Math.round((100 * onTime.o) / onTime.s) + '%' : '–'} note={onTime.o + ' of ' + onTime.s + ' stops'} tone="leaf" />
        <Kpi label="Open complaints" value={openC.length} note={openC.filter((c) => c.serious).length + ' serious'} tone={openC.some((c) => c.serious) ? 'red' : 'muted'} />
        <Kpi label="Not in HR – new at sites" value={(regs.data || []).filter(f).length} note="waiting for check" tone="amber" />
      </div>
      <div className="g2">
        <div className="wcard"><h3>Meals – last 14 days</h3>
          <div className="vbars">{days.map((d, i) => <div key={d}><i className={d === today() ? 'sf' : ''} style={{ height: Math.max(2, (100 * perDay[i]!) / max) + '%' }} /><span>{d.slice(8)}</span></div>)}</div>
          <div className="legend" style={{ marginTop: 10 }}><span><i style={{ background: 'var(--leaf)' }} />Served or delivered</span><span><i style={{ background: 'var(--sf)' }} />Today so far</span></div>
        </div>
        <div className="wcard"><h3>Needs attention</h3>
          <div className="col" style={{ gap: 10 }}>
            {openC.filter((c) => c.serious).map((c) => <Link key={c.id} to="/admin/complaints" className="row sm" style={{ textDecoration: 'none' }}><span className="dot red" /><span className="sp" style={{ color: 'var(--ink)' }}>Serious complaint – {c.category} · {c.code}</span><span className="xs">{leftText(c.due_at)}</span></Link>)}
            {sum(todays, 'not_confirmed') > 0 && <div className="row sm"><span className="dot sf" /><span className="sp" style={{ color: 'var(--ink)' }}>{sum(todays, 'not_confirmed')} deliveries not confirmed</span></div>}
            {(docs.data || []).map((d) => <div key={d.id} className="row sm"><span className="dot sf" /><span className="sp" style={{ color: 'var(--ink)' }}>{d.contractors?.name}: {d.kind.toUpperCase()} ends {day(d.valid_to)}</span></div>)}
            {(regs.data || []).filter(f).length > 0 && <Link to="/admin/registrations" className="row sm" style={{ textDecoration: 'none' }}><span className="dot blue" /><span className="sp" style={{ color: 'var(--ink)' }}>{(regs.data || []).filter(f).length} registrations wait for a check</span></Link>}
            {!openC.some((c) => c.serious) && !sum(todays, 'not_confirmed') && !(docs.data || []).length && !(regs.data || []).filter(f).length && <div className="sm">Nothing waits.</div>}
          </div>
        </div>
      </div>
      <div className="g2">
        <div className="wcard"><h3>By mess · today</h3>
          {(messes.data || []).filter(f).map((m) => { const t = todays.filter((x) => x.mess_id === m.id); return <div key={m.id} className="row sm" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span className="sp" style={{ color: 'var(--ink)' }}><b>{m.name}</b> · {m.contractors?.name || 'no contractor'}</span><b style={{ color: 'var(--ink)' }}>{sum(t, 'meals')} meals</b></div>; })}
        </div>
        <div className="wcard"><h3>Last 14 days</h3>
          {[['Meals', sum(all, 'meals')], ['Guest meals', sum(all, 'guests')], ['Parcels delivered', sum(all, 'parcels')], ['Not confirmed', sum(all, 'not_confirmed')], ['Failed', sum(all, 'failed')]].map(([l, v]) => <div key={l as string} className="row sm" style={{ padding: '6px 0' }}><span className="sp">{l}</span><b style={{ color: 'var(--ink)' }}>{num(v as number)}</b></div>)}
        </div>
      </div>
    </Web>
  );
}

// ── w07 · Daily consumption: the days, the lock, corrections ──
export function Consumption() {
  const s = useSession();
  const messes = useMesses();
  const [mess, setMess] = useState('');
  const m = (messes.data || []).find((x) => x.id === mess) || messes.data?.[0];
  const from = today().slice(0, 8) + '01';
  const st = useStats(from, today());
  const dcs = useLoad(() => m ? rows<{ id: string; service_date: string; state: string; present_count: number | null; present_source: string | null; owner_remarks: string | null; locked_at: string | null }>(db().from('day_closings').select('*').eq('mess_id', m.id).gte('service_date', today(-40)).order('service_date', { ascending: false })) : Promise.resolve([]), [m?.id], ['day_closings']);
  const corr = useLoad(() => rows<{ id: string; order_line_id: string; before: Record<string, unknown>; after: Record<string, unknown>; reason: string; asked_at: string; decided_at: string | null; approved: boolean | null; day_closing_id: string }>(db().from('day_corrections').select('*').order('asked_at', { ascending: false }).limit(30)), [], ['day_corrections']);
  const [pres, setPres] = useState<Record<string, string>>({});
  const a = useAct();
  const sup = m ? s.has('mess_supervisor', m.site_id) : false, admin = m ? s.has('site_admin', m.site_id) : false;
  const rowsF = (st.data || []).filter((x) => x.mess_id === m?.id).sort((x, y) => y.service_date.localeCompare(x.service_date));
  const dc = (d: string) => (dcs.data || []).find((x) => x.service_date === d);
  return (
    <Web title={'Daily consumption' + (m ? ' · ' + m.name : '')} actions={<>
      <select className="wbtn" value={m?.id || ''} onChange={(e) => setMess(e.target.value)} aria-label="Mess">{(messes.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <button className="wbtn" onClick={() => csv('falcon-consumption-' + (m?.name || ''), ['Day', 'Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Guests', 'Parcels', 'Not confirmed', 'Failed', 'Closing'], rowsF.map((r) => [r.service_date, r.breakfast, r.lunch, r.snacks, r.dinner, r.guests, r.parcels, r.not_confirmed, r.failed, dc(r.service_date)?.state || 'open']))}><Icon name="download" size={16} />Excel</button>
      <button className="wbtn" onClick={() => window.print()}><Icon name="printer" size={16} />PDF</button></>}>
      {st.error && <Failed error={st.error} retry={st.reload} />}
      <div className="wcard" style={{ padding: '8px 8px 0' }}>
        <Tbl head={['Day', 'Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Guests', 'Parcels', 'Not confirmed', 'Failed', 'Present (HR)', 'Day closing']} right={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
          hl={(i) => rowsF[i]?.service_date === today()}
          rows={[...rowsF.map((r) => {
            const d = dc(r.service_date), past = r.service_date < today();
            return [<b>{dayLong(r.service_date)}</b>, r.breakfast, r.lunch, r.snacks, r.dinner, r.guests, r.parcels, r.not_confirmed, r.failed,
              d?.present_count ?? (sup && d?.state !== 'locked' ? <span className="row" style={{ gap: 4 }}><input aria-label="Present" value={pres[r.service_date] || ''} onChange={(e) => setPres((x) => ({ ...x, [r.service_date]: e.target.value }))} style={{ width: 54 }} /><button className="chip" style={{ height: 24 }} onClick={() => a.run(async () => { await call('set_present', { p_mess: m!.id, p_date: r.service_date, p_count: Number(pres[r.service_date]), p_source: 'entered by the supervisor' }); dcs.reload(); })}>Save</button></span> : '–'),
              d?.state === 'locked' ? <span className="chip leaf" style={{ height: 24 }}><Icon name="lock" size={14} />Locked</span>
                : sup && past ? <button className="chip amber" style={{ height: 24 }} onClick={() => a.run(async () => { await call('lock_day', { p_mess: m!.id, p_date: r.service_date }); dcs.reload(); })}>{d?.state === 'submitted' ? 'Sent · lock it' : 'Lock the day'}</button>
                : <span className="chip amber" style={{ height: 24 }}>{d?.state === 'submitted' ? 'With supervisor' : 'Open'}</span>];
          }), [<b>Month</b>, ...(['breakfast', 'lunch', 'snacks', 'dinner', 'guests', 'parcels', 'not_confirmed', 'failed'] as (keyof Stat)[]).map((k) => <b>{sum(rowsF, k)}</b>), '', <span className="xs">{(dcs.data || []).filter((x) => x.state === 'locked' && x.service_date >= from).length} locked</span>]]} />
      </div>
      <ErrorLine error={a.error} />
      <div className="wcard"><h3>Corrections after the lock</h3>
        <Tbl head={['Asked', 'Change', 'Reason', 'Decision']} empty="No corrections asked"
          rows={(corr.data || []).map((c) => [time(c.asked_at) + ' ' + day(c.asked_at), JSON.stringify(c.before) + ' → ' + JSON.stringify(c.after), c.reason,
            c.decided_at ? (c.approved ? 'approved' : 'refused') : admin ? <span className="row" style={{ gap: 6 }}><button className="chip leaf" onClick={() => a.run(async () => { await call('decide_correction', { p_id: c.id, p_ok: true }); corr.reload(); })}>Approve</button><button className="chip" onClick={() => a.run(async () => { await call('decide_correction', { p_id: c.id, p_ok: false }); corr.reload(); })}>Refuse</button></span> : 'waiting for the Site Admin'])} />
      </div>
      <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">What is locked is what is billed. A change after the lock is asked by the supervisor and approved by the Site Admin – never by the one who asked.</span></div>
    </Web>
  );
}

// ── w14 · Complaints ──
export function Complaints() {
  const [site, setSite] = useState('');
  const list = useLoad(() => rows<{ id: string; code: string; category: string; serious: boolean; text: string | null; heard_text: string | null; state: string; due_at: string; created_at: string; site_id: string; people_count: number; owner_reply: string | null; owner_action: string | null; photo_paths: string[]; voice_path: string | null; found_true: boolean | null; penalty: number | null }>(
    db().from('complaints').select('*').order('created_at', { ascending: false }).limit(200)), [], ['complaints']);
  const [sel, setSel] = useState<string | null>(null);
  const [pen, setPen] = useState(''); const [note, setNote] = useState('');
  const a = useAct();
  const l = (list.data || []).filter((c) => !site || c.site_id === site);
  const c = l.find((x) => x.id === sel) || l.find((x) => x.state !== 'closed');
  const month = l.filter((x) => x.created_at >= today().slice(0, 8) + '01');
  const media = async (p: string) => { const r = await supabase!.storage.from('complaint-media').createSignedUrl(p, 300); if (r.data) window.open(r.data.signedUrl, '_blank'); };
  return (
    <Web title="Complaints" roles={['system_admin', 'management', 'site_admin', 'mess_supervisor']} actions={<SitePick value={site} onChange={setSite} all />}>
      <div className="kpis">
        <Kpi label="Open" value={l.filter((x) => x.state !== 'closed').length} note={l.filter((x) => x.state !== 'closed' && x.serious).length + ' serious'} tone="red" />
        <Kpi label="Closed this month" value={month.filter((x) => x.state === 'closed').length} note={month.filter((x) => x.found_true).length + ' found true'} tone="leaf" />
        <Kpi label="Penalty this month" value={inr(month.reduce((n, x) => n + Number(x.penalty || 0), 0))} note="found true" />
      </div>
      <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.8fr) minmax(0,1fr)' }}>
        <div className="wcard" style={{ padding: '8px 8px 0' }}>{list.loading && !list.data ? <Loading /> :
          <Tbl head={['Ticket', 'About', 'Raised', 'Status']} hl={(i) => l[i]?.id === c?.id}
            rows={l.map((x) => [<button className="chip" style={{ height: 26 }} onClick={() => setSel(x.id)}><b>{x.code}</b></button>, <span className={x.serious ? 'chip red' : ''} style={x.serious ? { height: 24 } : {}}>{x.category} · {(x.text || x.heard_text || '').slice(0, 40)}</span>, day(x.created_at) + ' ' + time(x.created_at),
              <span className={'chip ' + (x.state === 'closed' ? 'leaf' : x.state === 'open' ? 'red' : 'amber')} style={{ height: 24 }}>{x.state === 'open' ? 'Owner · ' + leftText(x.due_at) : x.state.replace('_', ' ')}</span>])} />}</div>
        {c ? <div className="wcard"><h3>{c.code}{c.serious ? ' · serious' : ''}</h3>
          <div className="sm" style={{ marginBottom: 10 }}>{c.text || c.heard_text}</div>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>{c.photo_paths.map((p, i) => <button key={p} className="chip" onClick={() => void media(p)}><Icon name="image" size={14} />Photo {i + 1}</button>)}{c.voice_path && <button className="chip" onClick={() => void media(c.voice_path!)}><Icon name="play" size={14} />Voice</button>}</div>
          <div className="tl">
            <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>Raised</b><small>{time(c.created_at)} · {c.people_count} people</small></div></div>
            <div className={'st' + (c.owner_reply ? ' done' : ' now')}><span className="k">{c.owner_reply ? <Icon name="check" size={14} /> : <Icon name="clock" size={14} />}</span><div><b>Mess owner's reply and action</b><small>{c.owner_reply ? c.owner_reply + (c.owner_action ? ' · ' + c.owner_action : '') : leftText(c.due_at)}</small></div></div>
            <div className={'st' + (c.state === 'closed' ? ' done' : c.owner_reply ? ' now' : '')}><span className="k">{c.state === 'closed' && <Icon name="check" size={14} />}</span><div><b>Supervisor decides</b><small>{c.state === 'closed' ? (c.found_true ? 'found true' + (c.penalty ? ' · penalty ' + inr(c.penalty) : '') : 'not true') : 'found true or not · penalty by the work order'}</small></div></div>
          </div>
          {['answered', 'person_confirmed'].includes(c.state) && <div className="col" style={{ gap: 8, marginTop: 8 }}>
            {c.state !== 'person_confirmed' && <div className="xs">The person has not said it is solved – write why it is closed.</div>}
            <Input value={pen} onChange={setPen} placeholder="Penalty ₹ (if true)" inputMode="numeric" /><Input value={note} onChange={setNote} placeholder="Note" />
            <div className="row" style={{ gap: 8 }}><button className="wbtn pri" onClick={() => a.run(async () => { await call('decide_complaint', { p_id: c.id, p_found_true: true, p_penalty: pen ? Number(pen) : null, p_note: note || null }); list.reload(); })}>Found true · close</button>
              <button className="wbtn" onClick={() => a.run(async () => { await call('decide_complaint', { p_id: c.id, p_found_true: false, p_penalty: null, p_note: note || null }); list.reload(); })}>Not true · close</button></div>
          </div>}
          <ErrorLine error={a.error} />
        </div> : <div className="wcard sm">No open complaint.</div>}
      </div>
      <div className="row xs" style={{ gap: 8 }}><Icon name="bell" size={14} /><span className="sp">A complaint never stops a delivery, the day's closing or the bill – it is followed on its own.</span></div>
    </Web>
  );
}

// ── w15 · Audit log ──
export function Audit() {
  const [d, setD] = useState(today());
  const [what, setWhat] = useState('');
  const log = useLoad(() => {
    let q = db().from('audit_log').select('*').gte('at', d + 'T00:00:00+05:30').lte('at', d + 'T23:59:59+05:30').order('at', { ascending: false }).limit(500);
    if (what) q = q.eq('entity', what);
    return rows<{ id: number; at: string; actor: string | null; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown; how: string | null; reason: string | null }>(q);
  }, [d, what]);
  const people = useLoad(() => rows<{ id: string; full_name: string }>(db().from('people').select('id,full_name')), []);
  const name = (id: string | null) => (people.data || []).find((p) => p.id === id)?.full_name || (id ? 'someone' : 'the system');
  const short = (v: unknown) => { if (!v) return ''; const s = JSON.stringify(v); return s.length > 90 ? s.slice(0, 90) + '…' : s; };
  return (
    <Web title="Audit log" roles={['system_admin', 'management', 'site_admin']} actions={<>
      <input className="wbtn" type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label="Day" />
      <select className="wbtn" value={what} onChange={(e) => setWhat(e.target.value)} aria-label="Kind"><option value="">Every kind</option>{['orders', 'order_lines', 'batches', 'complaints', 'day_closings', 'day_corrections', 'monthly_bills', 'registrations', 'people', 'role_grants', 'rates', 'work_orders', 'tax_rules', 'menus'].map((x) => <option key={x}>{x}</option>)}</select>
      <button className="wbtn" onClick={() => csv('falcon-audit-' + d, ['Time', 'Who', 'What', 'Entity', 'Before', 'After', 'How', 'Reason'], (log.data || []).map((x) => [x.at, name(x.actor), x.action, x.entity + ' ' + (x.entity_id || ''), JSON.stringify(x.before), JSON.stringify(x.after), x.how, x.reason]))}><Icon name="download" size={16} />Excel</button></>}>
      {log.error && <Failed error={log.error} retry={log.reload} />}
      <div className="wcard" style={{ padding: '8px 8px 0' }}>{log.loading && !log.data ? <Loading /> :
        <Tbl head={['Time', 'Who', 'What', 'Before → after', 'How']} empty="Nothing that day"
          rows={(log.data || []).map((x) => [time(x.at), <b>{name(x.actor)}</b>, x.action + ' · ' + x.entity, <span className="xs">{short(x.before)}{x.before ? ' → ' : ''}{short(x.after)}{x.reason ? ' · ' + x.reason : ''}</span>, <span className="tag">{x.how || ''}</span>])} />}</div>
      <div className="row xs" style={{ gap: 8 }}><Icon name="lock" size={14} /><span className="sp">Every change is kept with who, when, before and after. Nobody can change or delete a line here. The way each meal was confirmed is kept as it happened – a phone follow-up is never shown as an OTP.</span></div>
    </Web>
  );
}

// ── w11 · Reports ──
export function Reports() {
  const s = useSession();
  const [from, setFrom] = useState(today().slice(0, 8) + '01'); const [to, setTo] = useState(today());
  const a = useAct();
  const office = s.has(['system_admin', 'management', 'accounts', 'site_admin']);
  const money = s.has(['accounts', 'management', 'system_admin']);
  const reps: { name: string; what: string; who: string; ok: boolean; run: () => Promise<void> }[] = [
    { name: 'Daily meal register', what: 'every meal and parcel, by day, mess and meal', who: 'Supervisor · Site Admin · Accounts', ok: true, run: async () => {
      const r = await call<Stat[]>('office_stats', { p_from: from, p_to: to }); csv('falcon-meals-' + from + '-' + to, ['Day', 'Site', 'Mess', 'Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Guests', 'Parcels', 'Not confirmed', 'Failed', 'Cancelled', 'Short'], r.map((x) => [x.service_date, s.sites.find((y) => y.id === x.site_id)?.code, x.mess_id, x.breakfast, x.lunch, x.snacks, x.dinner, x.guests, x.parcels, x.not_confirmed, x.failed, x.cancelled, x.short])); } },
    { name: 'Orders and confirmations', what: 'each order with how each meal was confirmed', who: 'Supervisor · Site Admin · Accounts', ok: true, run: async () => {
      const r = await rows<{ code: string; service_date: string; meal: string; kind: string; state: string; order_lines: { state: string; is_meal: boolean; confirmations: { kind: string }[] }[] }>(db().from('orders').select('code,service_date,meal,kind,state,order_lines(state,is_meal,confirmations(kind))').gte('service_date', from).lte('service_date', to).limit(5000));
      csv('falcon-orders-' + from + '-' + to, ['Order', 'Day', 'Meal', 'Kind', 'State', 'Meals', 'Confirmed by'], r.map((o) => [o.code, o.service_date, o.meal, o.kind, o.state, o.order_lines.filter((l) => l.is_meal).length, o.order_lines.flatMap((l) => l.confirmations.map((c) => c.kind)).join(' ')])); } },
    { name: 'Complaints register', what: 'type, action, time to close, penalty', who: 'Site Admin · Management', ok: office, run: async () => {
      const r = await rows<{ code: string; category: string; serious: boolean; state: string; created_at: string; closed_at: string | null; found_true: boolean | null; penalty: number | null; owner_reply: string | null }>(db().from('complaints').select('code,category,serious,state,created_at,closed_at,found_true,penalty,owner_reply').gte('created_at', from).lte('created_at', to + 'T23:59:59+05:30'));
      csv('falcon-complaints-' + from + '-' + to, ['Ticket', 'About', 'Serious', 'State', 'Raised', 'Closed', 'Found true', 'Penalty', 'Reply'], r.map((x) => [x.code, x.category, x.serious ? 'yes' : '', x.state, x.created_at, x.closed_at, x.found_true == null ? '' : x.found_true ? 'yes' : 'no', x.penalty, x.owner_reply])); } },
    { name: 'Contractor bills and payments', what: 'quantity × rate, GST, TDS, deductions, net, UTR', who: 'Accounts · Management', ok: money, run: async () => {
      const r = await rows<{ code: string; month: string; state: string; taxable: number; gst_amount: number; tds_amount: number; retention: number; advance_recovery: number; penalties: number; net_payable: number; payments: { utr: string; paid_on: string }[] }>(db().from('monthly_bills').select('*,payments(utr,paid_on)').order('month'));
      csv('falcon-bills', ['Bill', 'Month', 'State', 'Taxable', 'GST', 'TDS', 'Retention', 'Advance', 'Penalties', 'Net', 'UTR', 'Paid on'], r.map((b) => [b.code, b.month, b.state, b.taxable, b.gst_amount, b.tds_amount, b.retention, b.advance_recovery, b.penalties, b.net_payable, b.payments[0]?.utr, b.payments[0]?.paid_on])); } },
    { name: 'Registrations', what: 'new and unregistered people, status, who decided', who: 'Site Admin · System Admin', ok: office, run: async () => {
      const r = await rows<{ code: string; typed_rcl_id: string | null; hr_result: string; last_action: string | null; decided_at: string | null; created_at: string; people: { full_name: string; state: string } }>(db().from('registrations').select('code,typed_rcl_id,hr_result,last_action,decided_at,created_at,people(full_name,state)'));
      csv('falcon-registrations', ['Registration', 'Person', 'Typed ID', 'HR', 'State', 'Last action', 'Decided', 'Since'], r.map((x) => [x.code, x.people?.full_name, x.typed_rcl_id, x.hr_result, x.people?.state, x.last_action, x.decided_at, x.created_at])); } },
  ];
  return (
    <Web title="Reports" actions={<><input className="wbtn" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input className="wbtn" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>}>
      <div className="wcard" style={{ padding: '8px 8px 0' }}>
        <Tbl head={['Report', 'What it shows', 'Who sees it', '']} rows={reps.filter((r) => r.ok).map((r) => [<b>{r.name}</b>, r.what, <span className="xs">{r.who}</span>,
          <span className="row" style={{ gap: 6 }}><button className="wbtn" style={{ height: 32 }} disabled={a.busy} onClick={() => a.run(r.run)}><Icon name="download" size={14} />Excel</button><button className="wbtn" style={{ height: 32 }} onClick={() => window.print()}><Icon name="printer" size={14} />PDF</button></span>])} />
      </div>
      <ErrorLine error={a.error} />
      <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">The server checks every report against the person's role and site – a report shows only what he may see.</span></div>
    </Web>
  );
}

// ── w12 · Analytics · w13 · Contractor scorecard ──
export function Analytics() {
  const from = today(-150).slice(0, 8) + '01';
  const st = useStats(from, today());
  const rat = useLoad(() => call<{ mess_id: string; reviews: number; overall: number; taste: number; quantity: number; hot: number }[]>('office_ratings', { p_from: today().slice(0, 8) + '01', p_to: today() }), []);
  const del = useLoad(() => call<{ mess_id: string; stops: number; on_time: number; batches: number; late_batches: number }[]>('office_delivery', { p_from: today().slice(0, 8) + '01', p_to: today() }), []);
  const months = useMemo(() => { const m = new Map<string, number>(); (st.data || []).forEach((x) => m.set(x.service_date.slice(0, 7), (m.get(x.service_date.slice(0, 7)) || 0) + x.meals)); return [...m].sort(); }, [st.data]);
  const max = Math.max(1, ...months.map((x) => x[1]));
  const thisM = (st.data || []).filter((x) => x.service_date >= today().slice(0, 8) + '01');
  const r = (rat.data || [])[0], d = (del.data || []).reduce((a, x) => ({ s: a.s + x.stops, o: a.o + x.on_time, l: a.l + x.late_batches }), { s: 0, o: 0, l: 0 });
  return (
    <Web title="Analytics" roles={['system_admin', 'management', 'site_admin', 'accounts']} actions={<Link className="wbtn" to="/admin/scorecard"><Icon name="star" size={16} />Contractor scorecard</Link>}>
      <div className="kpis">
        <Kpi label="Meals this month" value={num(sum(thisM, 'meals'))} note={sum(thisM, 'guests') + ' guest meals'} />
        <Kpi label="Parcels on time" value={d.s ? Math.round((100 * d.o) / d.s) + '%' : '–'} note={d.l + ' late vans this month'} tone="leaf" />
        <Kpi label="Not billable" value={sum(thisM, 'not_confirmed') + sum(thisM, 'failed')} note="not confirmed or failed" tone="amber" />
        <Kpi label="Rating" value={r?.overall ?? '–'} note={(r?.reviews || 0) + ' reviews this month'} />
      </div>
      <div className="g2">
        <div className="wcard"><h3>Meals a month</h3><div className="vbars">{months.map(([m, n]) => <div key={m}><i className={m === today().slice(0, 7) ? 'sf' : ''} style={{ height: Math.max(2, (100 * n) / max) + '%' }} /><span>{m.slice(5)} · {num(n)}</span></div>)}</div></div>
        <div className="wcard"><h3>Ratings · 1 to 5 · this month</h3>{[['Taste', r?.taste], ['Quantity', r?.quantity], ['Hot when it came', r?.hot], ['Overall', r?.overall]].map(([l, v]) => <div key={l as string} style={{ marginBottom: 10 }}><div className="row sm"><span className="sp">{l}</span><b style={{ color: 'var(--ink)' }}>{v ?? '–'}</b></div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: ((Number(v) || 0) / 5) * 100 + '%' }} /></div></div>)}</div>
      </div>
    </Web>
  );
}

// The measures and weights of the board; the weights are dated settings of the System Admin (Settings), these are only the
// values until he sets them.
export const SCORE_KEYS = ['scorecard.w_rating', 'scorecard.w_time', 'scorecard.w_complaints', 'scorecard.w_billing', 'scorecard.w_papers'];
export function Scorecard() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const from = month + '-01';
  const end = new Date(from + 'T12:00:00+05:30'); end.setMonth(end.getMonth() + 1); end.setDate(0);
  const to = end.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) < today() ? end.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : today();
  const messes = useMesses();
  const set = useSettings(SCORE_KEYS, to);
  const W = { rating: settingNum(set.data, SCORE_KEYS[0]!, 25), time: settingNum(set.data, SCORE_KEYS[1]!, 25), complaints: settingNum(set.data, SCORE_KEYS[2]!, 20),
    billing: settingNum(set.data, SCORE_KEYS[3]!, 15), papers: settingNum(set.data, SCORE_KEYS[4]!, 15) };
  const rat = useLoad(() => call<{ mess_id: string; reviews: number; overall: number }[]>('office_ratings', { p_from: from, p_to: to }), [from, to]);
  const del = useLoad(() => call<{ mess_id: string; stops: number; on_time: number }[]>('office_delivery', { p_from: from, p_to: to }), [from, to]);
  const comp = useLoad(() => rows<{ mess_id: string; found_true: boolean | null }>(db().from('complaints').select('mess_id,found_true').gte('created_at', from).lte('created_at', to + 'T23:59:59+05:30')), [from, to]);
  const bills = useLoad(() => rows<{ mess_id: string; month: string; taxable: number; invoice_amount: number | null }>(db().from('monthly_bills').select('mess_id,month,taxable,invoice_amount').not('recon', 'is', null).lte('month', from).order('month', { ascending: false })), [from]);
  const docs = useLoad(() => rows<{ contractor_id: string; state: string; valid_to: string | null }>(db().from('contractor_documents').select('contractor_id,state,valid_to').neq('state', 'rejected')), []);
  const st = useStats(from, to);
  const score = (m: { id: string; contractor_id: string | null }) => {
    const r = (rat.data || []).find((x) => x.mess_id === m.id), d = (del.data || []).find((x) => x.mess_id === m.id);
    const meals = sum((st.data || []).filter((x) => x.mess_id === m.id), 'meals'), trueC = (comp.data || []).filter((x) => x.mess_id === m.id && x.found_true).length;
    const b = (bills.data || []).find((x) => x.mess_id === m.id && x.invoice_amount != null);
    const over = b && Number(b.taxable) > 0 ? ((Number(b.invoice_amount) - Number(b.taxable)) / Number(b.taxable)) * 100 : null;
    const ds = (docs.data || []).filter((x) => x.contractor_id === m.contractor_id);
    const good = ds.filter((x) => x.state === 'verified' && (!x.valid_to || x.valid_to >= to)).length, asked = ds.filter((x) => x.state === 'asked').length;
    const parts = {
      rating: r ? (r.overall / 5) * W.rating : null,
      time: d?.stops ? (d.on_time / d.stops) * W.time : null,
      complaints: meals ? Math.max(0, W.complaints - ((trueC * 1000) / meals) * 5) : null,
      billing: over != null ? Math.max(0, W.billing * (1 - Math.max(0, over) / 6)) : null,
      papers: ds.length ? (good / ds.length) * W.papers : null };
    const known = Object.values(parts).filter((v): v is number => v != null);
    return { parts, r, d, trueC, over, ds: ds.length, good, asked, total: known.length ? Math.round(known.reduce((t, v) => t + v, 0)) : null,
      out: Object.entries(parts).filter(([, v]) => v != null).reduce((t, [k]) => t + W[k as keyof typeof W], 0) };
  };
  const list = (messes.data || []).map((m) => ({ m, x: score(m) }));
  const f = (v: number | null) => (v == null ? '–' : String(Math.round(v)));
  const loading = [messes, rat, del, comp, bills, docs, st].some((l) => l.loading && !l.data);
  return (
    <Web title={'Contractor scorecard · ' + new Date(from + 'T12:00:00+05:30').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} roles={['system_admin', 'management', 'site_admin', 'accounts']}
      actions={<><input className="wbtn" type="month" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" /><button className="wbtn" onClick={() => window.print()}><Icon name="printer" size={16} />PDF for the review meeting</button></>}>
      {loading ? <Loading /> : <>
        <div className="g2">{list.map(({ m, x }) => <div key={m.id} className="wcard"><div className="row" style={{ gap: 12 }}><div className="tile s40 leaf"><Icon name="chef-hat" /></div><div className="sp"><b style={{ fontSize: 17 }}>{m.contractors?.name || '–'}</b><div className="xs">{m.name}</div></div>
          <div style={{ textAlign: 'right' }}><b style={{ fontSize: 34, letterSpacing: '-.02em' }}>{x.total ?? '–'}</b><div className="xs">of {x.out || 100}</div></div></div></div>)}</div>
        <div className="wcard" style={{ padding: '8px 8px 0' }}>
          <Tbl head={['Measure', 'From where', 'Weight', ...list.map(({ m }) => m.contractors?.name || m.name)]} right={[2, ...list.map((_, i) => i + 3)]} hl={(i) => i === 5}
            rows={[
              [<><b>Ratings</b> · taste, quantity, hot</>, <span className="xs">people's ratings after the meal</span>, W.rating, ...list.map(({ x }) => x.r ? x.r.overall + ' of 5 · ' + f(x.parts.rating) : '–')],
              [<><b>On time</b> · parcels</>, <span className="xs">van reached time against its time</span>, W.time, ...list.map(({ x }) => x.d?.stops ? Math.round((100 * x.d.on_time) / x.d.stops) + '% · ' + f(x.parts.time) : '–')],
              [<><b>Complaints</b> found true</>, <span className="xs">complaint dashboard · 5 points less for each one in 1,000 meals</span>, W.complaints, ...list.map(({ x }) => x.parts.complaints != null ? x.trueC + ' · ' + f(x.parts.complaints) : '–')],
              [<b>Billing accuracy</b>, <span className="xs">invoice vs system, the last checked bill · a sixth less for each 1% over</span>, W.billing, ...list.map(({ x }) => x.over != null ? (x.over > 0 ? x.over.toFixed(1) + '% over' : 'no excess') + ' · ' + f(x.parts.billing) : '–')],
              [<><b>Documents</b> valid</>, <span className="xs">FSSAI, licences, medical fitness – verified and in date</span>, W.papers, ...list.map(({ x }) => x.ds ? (x.good === x.ds ? 'all valid' : x.asked ? x.asked + ' asked, not given' : (x.ds - x.good) + ' not valid') + ' · ' + f(x.parts.papers) : '–')],
              [<b>Score</b>, '', <b>{W.rating + W.time + W.complaints + W.billing + W.papers}</b>, ...list.map(({ x }) => <b>{x.total ?? '–'}</b>)]]} />
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">The weights are a setting of the System Admin with a date (Settings). A measure without data yet ("–") is left out of the score. A score only shows – it never changes a bill by itself.</span></div>
      </>}
    </Web>
  );
}
