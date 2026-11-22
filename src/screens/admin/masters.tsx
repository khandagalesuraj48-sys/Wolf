// The web's masters: w02 sites, circles, sections · w03 mess (times, who may eat, QR codes) · w04 contractor (bank apart) ·
// w05 documents · w06 work orders, rates with dates, penalties. Every save goes through the table's own rule (RLS) or a function.
import { useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { call, db, one, rows, useAct, useLoad } from '../../lib/db';
import { useSession } from '../../lib/session';
import { day, inr, maskMobile, mealName, MEALS, today } from '../../lib/fmt';
import { Icon } from '../../ui/Icon';
import { RoadMap } from '../../ui/RoadMap';
import { ErrorLine, Failed, Input, Loading } from '../../ui/kit';
import { Kpi, SitePick, Tbl, Web } from '../../ui/web';

async function save(table: string, row: Record<string, unknown>) {
  const { error } = row.id ? await db().from(table).update(row).eq('id', row.id as string) : await db().from(table).insert(row);
  if (error) throw new Error(error.code === '42501' ? 'This change is not yours to make.' : error.message);
}
const val = (x: string) => (x.trim() === '' ? null : x.trim());

// ── w02 · Sites, circles, sections ──
export function Sites() {
  const s = useSession();
  const [site, setSite] = useState(s.sites[0]?.id || '');
  const circles = useLoad(() => site ? rows<{ id: string; code: string; name: string; km_from: number | null; km_to: number | null }>(db().from('circles').select('*').eq('site_id', site).order('code')) : Promise.resolve([]), [site]);
  const secs = useLoad(() => site ? rows<{ id: string; code: string; name: string; km: number | null; place: string | null; lat: number | null; lng: number | null; circle_id: string; active: boolean }>(db().from('sections').select('*').eq('site_id', site).order('km')) : Promise.resolve([]), [site]);
  const [c, setC] = useState({ code: '', name: '', from: '', to: '' });
  const [x, setX] = useState({ circle: '', code: '', name: '', km: '', place: '', lat: '', lng: '' });
  const [ns, setNs] = useState({ code: '', name: '' });
  const a = useAct();
  const sysadm = s.has('system_admin');
  const addSite = () => a.run(async () => { await save('sites', { company_id: s.me!.company_id, code: ns.code.toUpperCase(), name: ns.name }); setNs({ code: '', name: '' }); await s.refresh(); });
  const addCircle = () => a.run(async () => { await save('circles', { site_id: site, code: c.code.toUpperCase(), name: c.name || 'Circle ' + c.code, km_from: val(c.from), km_to: val(c.to) }); setC({ code: '', name: '', from: '', to: '' }); circles.reload(); });
  const addSec = () => a.run(async () => { await save('sections', { site_id: site, circle_id: x.circle, code: x.code.toUpperCase(), name: x.name || x.code, km: val(x.km), place: val(x.place), lat: val(x.lat), lng: val(x.lng) }); setX({ ...x, code: '', name: '', km: '', place: '', lat: '', lng: '' }); secs.reload(); });
  const cm = new Map((circles.data || []).map((y) => [y.id, y]));
  return (
    <Web title={'Circles and sections'} roles={['system_admin', 'site_admin']} actions={<SitePick value={site} onChange={setSite} />}>
      <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="wcard" style={{ padding: 0, overflow: 'hidden' }}><RoadMap sections={(secs.data || []).map((y) => ({ id: y.id, code: y.code, km: y.km, circle: cm.get(y.circle_id)?.code }))} circles={(circles.data || []).map((y) => ({ code: y.code, km_from: y.km_from, km_to: y.km_to }))} height={320} label="The site's road with its circles and sections" /></div>
        <div className="wcard"><h3>Circles and sections</h3>
          {(circles.data || []).map((ci) => <div key={ci.id} style={{ marginBottom: 10 }}><div className="row sm"><b className="sp" style={{ color: 'var(--ink)' }}>Circle {ci.code}{ci.km_from != null ? ' · Km ' + ci.km_from + ' – ' + ci.km_to : ''}</b><span className="xs">{(secs.data || []).filter((y) => y.circle_id === ci.id).length} sections</span></div>
            {(secs.data || []).filter((y) => y.circle_id === ci.id).map((y) => <div key={y.id} className="row xs" style={{ padding: '4px 0 4px 12px' }}><span className="sp">{y.code}{y.km != null ? ' · Km ' + y.km : ''}{y.place ? ' · ' + y.place : ''}</span><span>{y.lat != null ? y.lat + ', ' + y.lng : 'no GPS'}</span></div>)}</div>)}
        </div>
      </div>
      <div className="g3">
        <div className="wcard"><h3>Add a circle</h3><div className="col" style={{ gap: 8 }}><Input value={c.code} onChange={(v) => setC({ ...c, code: v })} placeholder="Code (A)" /><Input value={c.name} onChange={(v) => setC({ ...c, name: v })} placeholder="Name" /><div className="row" style={{ gap: 8 }}><Input value={c.from} onChange={(v) => setC({ ...c, from: v })} placeholder="Km from" inputMode="numeric" /><Input value={c.to} onChange={(v) => setC({ ...c, to: v })} placeholder="Km to" inputMode="numeric" /></div><button className="wbtn pri" disabled={!sysadm || !c.code || a.busy} onClick={addCircle}><Icon name="plus" size={16} />Add circle</button>{!sysadm && <span className="xs">The System Admin adds circles.</span>}</div></div>
        <div className="wcard"><h3>Add a section</h3><div className="col" style={{ gap: 8 }}>
          <select className="winp" value={x.circle} onChange={(e) => setX({ ...x, circle: e.target.value })} aria-label="Circle"><option value="">Circle</option>{(circles.data || []).map((ci) => <option key={ci.id} value={ci.id}>Circle {ci.code}</option>)}</select>
          <div className="row" style={{ gap: 8 }}><Input value={x.code} onChange={(v) => setX({ ...x, code: v })} placeholder="Code (A1)" /><Input value={x.km} onChange={(v) => setX({ ...x, km: v })} placeholder="Km (2.4)" inputMode="numeric" /></div>
          <Input value={x.place} onChange={(v) => setX({ ...x, place: v })} placeholder="Drop point, e.g. site office" />
          <div className="row" style={{ gap: 8 }}><Input value={x.lat} onChange={(v) => setX({ ...x, lat: v })} placeholder="Latitude" /><Input value={x.lng} onChange={(v) => setX({ ...x, lng: v })} placeholder="Longitude" /></div>
          <button className="wbtn pri" disabled={!x.circle || !x.code || a.busy} onClick={addSec}><Icon name="plus" size={16} />Add section</button></div></div>
        {sysadm && <div className="wcard"><h3>Add a site</h3><div className="col" style={{ gap: 8 }}><Input value={ns.code} onChange={(v) => setNs({ ...ns, code: v })} placeholder="Code (VTR)" /><Input value={ns.name} onChange={(v) => setNs({ ...ns, name: v })} placeholder="Name" /><button className="wbtn pri" disabled={!ns.code || !ns.name || a.busy} onClick={addSite}><Icon name="plus" size={16} />Add site</button></div></div>}
      </div>
      <ErrorLine error={a.error} />
      <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">A person's section comes from his registration; the mess keeps only the delivery point.</span></div>
    </Web>
  );
}

interface Mess { id: string; name: string; site_id: string; contractor_id: string | null; lat: number | null; lng: number | null; radius_m: number | null; counters: number | null; active: boolean }
// ── w03 · Mess master ──
export function Messes() {
  const s = useSession();
  const list = useLoad(() => rows<Mess>(db().from('messes').select('*').order('name')), []);
  const cons = useLoad(() => rows<{ id: string; name: string }>(db().from('contractors').select('id,name').order('name')), []);
  const [sel, setSel] = useState('');
  const m = (list.data || []).find((x) => x.id === sel) || list.data?.[0];
  const wins = useLoad(() => m ? rows<{ id: string; meal: string; serve_from: string; serve_to: string; order_by: string; change_minutes: number; valid_from: string; valid_to: string | null }>(db().from('meal_windows').select('*').eq('mess_id', m.id).order('valid_from', { ascending: false })) : Promise.resolve([]), [m?.id]);
  const [nm, setNm] = useState({ name: '', site: s.sites[0]?.id || '', contractor: '', counters: '1' });
  const [w, setW] = useState({ meal: 'lunch', from: '12:30', to: '14:30', by: '11:30', change: '2', valid: today(1) });
  const a = useAct();
  const addMess = () => a.run(async () => { await save('messes', { company_id: s.me!.company_id, site_id: nm.site, name: nm.name, contractor_id: nm.contractor || null, counters: Number(nm.counters) || 1 }); setNm({ ...nm, name: '' }); list.reload(); });
  const addWin = () => a.run(async () => {
    const cur = (wins.data || []).find((x) => x.meal === w.meal && !x.valid_to);
    if (cur && cur.valid_from >= w.valid) throw new Error('The new times must start after ' + day(cur.valid_from) + '.');
    if (cur) { const prev = new Date(w.valid + 'T12:00:00+05:30'); prev.setDate(prev.getDate() - 1); await save('meal_windows', { id: cur.id, valid_to: prev.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }); }
    await save('meal_windows', { mess_id: m!.id, meal: w.meal, serve_from: w.from, serve_to: w.to, order_by: w.by, change_minutes: Number(w.change), valid_from: w.valid }); wins.reload();
  });
  const printQR = async () => {
    if (!m) return;
    const win = window.open('', '_blank'); if (!win) return;
    const n = m.counters || 1, codes: string[] = [];
    for (let i = 1; i <= n; i++) codes.push(await QRCode.toDataURL(location.origin + '/m/' + m.id + '?c=' + i, { width: 360, margin: 1 }));
    win.document.write('<title>' + m.name + ' – QR</title><body style="font-family:sans-serif;display:flex;flex-wrap:wrap;gap:24px">' + codes.map((c, i) => '<div style="text-align:center;border:1px solid #ccc;padding:18px;border-radius:12px"><img src="' + c + '" width="260"><h2>' + m.name + '</h2><p>Counter ' + (i + 1) + ' · scan with FALCON</p></div>').join('') + '<script>print()<\/script>');
  };
  return (
    <Web title={m ? m.name : 'Mess master'} roles={['system_admin', 'site_admin', 'accounts']} actions={<>
      <select className="wbtn" value={m?.id || ''} onChange={(e) => setSel(e.target.value)} aria-label="Mess">{(list.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <button className="wbtn pri" onClick={() => void printQR()} disabled={!m}><Icon name="qr-code" size={16} />Print QR codes</button></>}>
      {list.error && <Failed error={list.error} retry={list.reload} />}
      {m && <div className="g2">
        <div className="wcard"><h3>Place and people</h3>
          {[['Site', s.sites.find((x) => x.id === m.site_id)?.code], ['Contractor', (cons.data || []).find((x) => x.id === m.contractor_id)?.name || '–'], ['Counters with QR', m.counters || 1], ['GPS', m.lat != null ? m.lat + ', ' + m.lng + ' · ' + (m.radius_m || '–') + ' m' : '–'], ['Active', m.active ? 'yes' : 'no']].map(([k, v]) => <div key={k as string} className="row sm" style={{ padding: '6px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v as string}</b></div>)}
        </div>
        <div className="wcard"><h3>Meals and times</h3>
          <Tbl head={['Meal', 'Served', 'Parcel order by', 'Change window', 'From', 'To']} rows={(wins.data || []).map((x) => [mealName(x.meal), x.serve_from.slice(0, 5) + ' – ' + x.serve_to.slice(0, 5), x.order_by.slice(0, 5), x.change_minutes + ' min', day(x.valid_from), x.valid_to ? day(x.valid_to) : '–'])} />
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <select className="winp" value={w.meal} onChange={(e) => setW({ ...w, meal: e.target.value })} aria-label="Meal">{MEALS.map((x) => <option key={x} value={x}>{mealName(x)}</option>)}</select>
            <input className="winp" type="time" value={w.from} onChange={(e) => setW({ ...w, from: e.target.value })} aria-label="Served from" /><input className="winp" type="time" value={w.to} onChange={(e) => setW({ ...w, to: e.target.value })} aria-label="Served to" />
            <input className="winp" type="time" value={w.by} onChange={(e) => setW({ ...w, by: e.target.value })} aria-label="Parcel order by" /><input className="winp" value={w.change} onChange={(e) => setW({ ...w, change: e.target.value })} aria-label="Change minutes" style={{ width: 70 }} />
            <input className="winp" type="date" value={w.valid} onChange={(e) => setW({ ...w, valid: e.target.value })} aria-label="From" />
            <button className="wbtn pri" onClick={addWin} disabled={a.busy}>New times from this date</button></div>
          <div className="xs" style={{ marginTop: 8 }}>Every change keeps the old version with its date – a day is always counted with that day's times.</div>
        </div>
      </div>}
      <div className="wcard"><h3>New mess</h3><div className="row wrap" style={{ gap: 8 }}>
        <Input value={nm.name} onChange={(v) => setNm({ ...nm, name: v })} placeholder="Mess name" />
        <select className="winp" value={nm.site} onChange={(e) => setNm({ ...nm, site: e.target.value })} aria-label="Site">{s.sites.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
        <select className="winp" value={nm.contractor} onChange={(e) => setNm({ ...nm, contractor: e.target.value })} aria-label="Contractor"><option value="">Contractor</option>{(cons.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <Input value={nm.counters} onChange={(v) => setNm({ ...nm, counters: v })} placeholder="Counters" inputMode="numeric" />
        <button className="wbtn pri" onClick={addMess} disabled={!nm.name || a.busy}><Icon name="plus" size={16} />Add mess</button></div></div>
      <ErrorLine error={a.error} />
      <Contractors />
    </Web>
  );
}

// ── w04 · w05 · Contractors, bank details, documents ──
function Contractors() {
  const s = useSession();
  const list = useLoad(() => rows<{ id: string; name: string; kind: string; contact_name: string | null; contact_mobile: string | null; gstin: string | null; pan: string | null; udyam: string | null; address: string | null; active: boolean; login_code: string | null }>(db().from('contractors').select('*').order('name')), []);
  const [sel, setSel] = useState('');
  const c = (list.data || []).find((x) => x.id === sel) || list.data?.[0];
  // (23-11-2026) who signs in with the contractor's code: a live Mess owner / operator role at one of its messes (People and roles)
  const signers = useLoad(async () => {
    if (!c) return [];
    const ms = await rows<{ id: string; name: string }>(db().from('messes').select('id,name').eq('contractor_id', c.id));
    if (!ms.length) return [];
    const gs = await rows<{ person_id: string; role: string; mess_id: string }>(db().from('role_grants').select('person_id,role,mess_id').in('mess_id', ms.map((m) => m.id)).in('role', ['mess_owner', 'mess_operator']).is('revoked_at', null));
    const ps = gs.length ? await rows<{ id: string; full_name: string; mobile: string | null }>(db().from('people').select('id,full_name,mobile').in('id', [...new Set(gs.map((g) => g.person_id))])) : [];
    return gs.map((g) => ({ ...g, person: ps.find((p) => p.id === g.person_id), mess: ms.find((m) => m.id === g.mess_id)?.name }));
  }, [c?.id]);
  const [code, setCode] = useState('');
  const bank = useLoad(() => c ? one<{ bank_name: string; ifsc: string; account_no: string }>(db().from('contractor_bank').select('bank_name,ifsc,account_no').eq('contractor_id', c.id).limit(1)) : Promise.resolve(null), [c?.id]);
  const docs = useLoad(() => c ? rows<{ id: string; kind: string; number: string | null; valid_from: string | null; valid_to: string | null; state: string; file_path: string | null }>(db().from('contractor_documents').select('*').eq('contractor_id', c.id).order('kind')) : Promise.resolve([]), [c?.id]);
  const [f, setF] = useState({ name: '', kind: 'proprietor', contact: '', mobile: '', gstin: '', pan: '', address: '' });
  const [b, setB] = useState({ bank: '', ifsc: '', acc: '' });
  const [d, setD] = useState({ kind: 'fssai', number: '', from: '', to: '' });
  const [file, setFile] = useState<File | null>(null);
  const a = useAct();
  const money = s.has(['accounts', 'system_admin']);
  const addC = () => a.run(async () => { await save('contractors', { company_id: s.me!.company_id, name: f.name, kind: f.kind, contact_name: val(f.contact), contact_mobile: f.mobile ? '+91' + f.mobile.replace(/\D/g, '').slice(-10) : null, gstin: val(f.gstin.toUpperCase()), pan: val(f.pan.toUpperCase()), address: val(f.address) }); setF({ ...f, name: '' }); list.reload(); });
  const saveBank = () => a.run(async () => { const { error } = await db().from('contractor_bank').upsert({ contractor_id: c!.id, bank_name: b.bank, ifsc: b.ifsc.toUpperCase(), account_no: b.acc.replace(/\D/g, ''), updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); bank.reload(); });
  const addDoc = () => a.run(async () => {
    let path: string | null = null;
    if (file) { path = s.me!.company_id + '/' + c!.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_'); const r = await supabase!.storage.from('contractor-papers').upload(path, file, { contentType: file.type }); if (r.error) throw new Error('The file could not be sent.'); }
    await save('contractor_documents', { contractor_id: c!.id, kind: d.kind, number: val(d.number), valid_from: val(d.from), valid_to: val(d.to), file_path: path, state: path ? 'attached' : 'asked', asked_at: path ? null : new Date().toISOString() }); docs.reload();
  });
  const saveCode = () => a.run(async () => { await call('office_contractor_code', { p_contractor: c!.id, p_code: code.trim().toUpperCase() || null }); setCode(''); list.reload(); });
  const verify = (id: string) => a.run(async () => { await save('contractor_documents', { id, state: 'verified', verified_by: s.me!.id, verified_at: new Date().toISOString() }); docs.reload(); });
  const open = async (p: string) => { const r = await supabase!.storage.from('contractor-papers').createSignedUrl(p, 300); if (r.data) window.open(r.data.signedUrl, '_blank'); };
  const ending = (docs.data || []).filter((x) => x.valid_to && x.valid_to <= today(60) && x.valid_to >= today());
  return (<>
    <div className="wtop" style={{ marginTop: 8 }}><h1 style={{ fontSize: 20 }}>Contractor{c ? ' · ' + c.name : 's'}</h1><select className="wbtn" value={c?.id || ''} onChange={(e) => setSel(e.target.value)} aria-label="Contractor">{(list.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    {c && <div className="g3">
      <div className="wcard"><h3>Business</h3>{[['Type', c.kind], ['Contact', c.contact_name], ['Mobile', c.contact_mobile], ['Address', c.address]].map(([k, v]) => <div key={k as string} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v || '–'}</b></div>)}</div>
      <div className="wcard"><h3>Tax</h3>{[['PAN', c.pan], ['GSTIN', c.gstin], ['Udyam', c.udyam], ['GST · TDS', 'Accounts\' rules with dates']].map(([k, v]) => <div key={k as string} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v || '–'}</b></div>)}</div>
      <div className="wcard"><h3>Bank</h3>{bank.data ? <>{[['Bank · IFSC', bank.data.bank_name + ' · ' + bank.data.ifsc], ['Account', 'XXXX ' + bank.data.account_no.slice(-4)]].map(([k, v]) => <div key={k} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v}</b></div>)}</> : <div className="sm">{money ? 'Not given yet' : 'Seen only by Accounts'}</div>}
        {money && <div className="col" style={{ gap: 6, marginTop: 8 }}><Input value={b.bank} onChange={(v) => setB({ ...b, bank: v })} placeholder="Bank" /><Input value={b.ifsc} onChange={(v) => setB({ ...b, ifsc: v })} placeholder="IFSC" /><Input value={b.acc} onChange={(v) => setB({ ...b, acc: v })} placeholder="Account number" inputMode="numeric" /><button className="wbtn" onClick={saveBank} disabled={!b.bank || !b.ifsc || !b.acc}>Save bank details</button></div>}</div>
    </div>}
    {c && <div className="wcard"><h3>Sign-in code – for the owner and his operators</h3>
      <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
        <b style={{ fontSize: 26, letterSpacing: '.08em', color: c.login_code ? 'var(--ink)' : 'var(--muted)' }}>{c.login_code || 'Not set'}</b>
        {s.has('system_admin') && <><Input value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder={c.login_code ? 'New code' : 'Code, e.g. SAIMESS'} maxLength={12} />
          <button className="wbtn pri" onClick={saveCode} disabled={a.busy || (!code.trim() && !c.login_code)}>{code.trim() ? 'Save code' : 'Remove code'}</button></>}
      </div>
      <div className="xs" style={{ marginTop: 6 }}>Typed on the app's first screen instead of the company code: the app knows {c.name}'s people have come. One code in all of FALCON – never a company's code. Only the System Admin sets it.</div>
      <Tbl head={['Signs in', 'Mobile', 'Role', 'Mess']} empty="Nobody yet – give the Mess owner / Mess operator role at this contractor's mess in People and roles"
        rows={(signers.data || []).map((x) => [<b>{x.person?.full_name || '–'}</b>, maskMobile(x.person?.mobile), x.role === 'mess_owner' ? 'Owner' : 'Operator', x.mess || '–'])} />
    </div>}
    {c && <><div className="kpis"><Kpi label="Valid" value={(docs.data || []).filter((x) => x.state === 'verified' && (!x.valid_to || x.valid_to >= today())).length} tone="leaf" /><Kpi label="Ending in 60 days" value={ending.length} tone="amber" /><Kpi label="Expired" value={(docs.data || []).filter((x) => x.valid_to && x.valid_to < today()).length} tone="red" /><Kpi label="Asked, not given" value={(docs.data || []).filter((x) => x.state === 'asked').length} tone="red" /></div>
      <div className="wcard"><Tbl head={['Document', 'Number', 'Valid from', 'Valid till', 'Status', '']} hl={(i) => !!ending.find((e) => e.id === (docs.data || [])[i]?.id)}
        rows={(docs.data || []).map((x) => [<b>{x.kind.replace('_', ' ').toUpperCase()}</b>, x.number || '–', day(x.valid_from), day(x.valid_to), <span className={'chip ' + (x.state === 'verified' ? 'leaf' : x.state === 'asked' ? 'red' : 'amber')} style={{ height: 24 }}>{x.state}</span>,
          <span className="row" style={{ gap: 6 }}>{x.file_path && <button className="chip" onClick={() => void open(x.file_path!)}><Icon name="eye" size={14} /></button>}{x.state === 'attached' && <button className="chip leaf" onClick={() => verify(x.id)}>Verify</button>}</span>])} />
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <select className="winp" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} aria-label="Kind">{['fssai', 'gst', 'pan', 'udyam', 'shop_act', 'work_order', 'agreement', 'bank_proof', 'medical_fitness', 'pest_control', 'other'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select>
          <Input value={d.number} onChange={(v) => setD({ ...d, number: v })} placeholder="Number" /><input className="winp" type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} aria-label="Valid from" /><input className="winp" type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} aria-label="Valid till" />
          <label className="wbtn" style={{ cursor: 'pointer' }}><Icon name="upload" size={16} />{file ? file.name : 'File'}<input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <button className="wbtn pri" onClick={addDoc} disabled={a.busy}>{file ? 'Add paper' : 'Ask for it'}</button></div>
        <div className="xs" style={{ marginTop: 8 }}>Alerts 60, 30 and 7 days before the end and on the day it ends – to the Site Admin, Accounts and the contractor.</div></div></>}
    {money && <div className="wcard"><h3>New contractor</h3><div className="row wrap" style={{ gap: 8 }}>
      <Input value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Business name" />
      <select className="winp" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Type">{['proprietor', 'partnership', 'llp', 'company', 'other'].map((k) => <option key={k}>{k}</option>)}</select>
      <Input value={f.contact} onChange={(v) => setF({ ...f, contact: v })} placeholder="Contact person" /><Input value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} placeholder="Mobile" inputMode="tel" />
      <Input value={f.gstin} onChange={(v) => setF({ ...f, gstin: v })} placeholder="GSTIN" /><Input value={f.pan} onChange={(v) => setF({ ...f, pan: v })} placeholder="PAN" /><Input value={f.address} onChange={(v) => setF({ ...f, address: v })} placeholder="Address" />
      <button className="wbtn pri" onClick={addC} disabled={!f.name || a.busy}><Icon name="plus" size={16} />Add contractor</button></div></div>}
    <ErrorLine error={a.error} />
  </>);
}

// ── w06 · Work orders and rates ──
export function WorkOrders() {
  const s = useSession();
  const wos = useLoad(() => rows<{ id: string; number: string; site_id: string; mess_id: string; contractor_id: string; valid_from: string; valid_to: string; payment_days: number; advance_amount: number; advance_recovery_pct: number; security_deposit: number; retention_pct: number; state: string; messes: { name: string } | null; contractors: { name: string } | null }>(db().from('work_orders').select('*,messes(name),contractors(name)').order('valid_from', { ascending: false })), []);
  const [sel, setSel] = useState('');
  const w = (wos.data || []).find((x) => x.id === sel) || wos.data?.[0];
  const rates = useLoad(() => w ? rows<{ id: string; item_id: string; rate: number; valid_from: string; valid_to: string | null; state: string; asked_by: string | null; reason: string | null; items: { name: string; code: string } }>(db().from('rates').select('*,items(name,code)').eq('work_order_id', w.id).order('valid_from', { ascending: false })) : Promise.resolve([]), [w?.id]);
  const pens = useLoad(() => w ? rows<{ id: string; code: string; what: string; amount: number | null; per: string; valid_from: string }>(db().from('penalty_rules').select('*').eq('work_order_id', w.id)) : Promise.resolve([]), [w?.id]);
  const items = useLoad(() => rows<{ id: string; name: string; code: string; unit: string }>(db().from('items').select('id,name,code,unit').eq('active', true).order('name')), []);
  // (23-11-2026, his word: "work contract madhe BOQ perfect – item wise ani rate, name disawa") the BOQ, item by item
  const boq = useLoad(() => w ? rows<{ id: string; item_id: string; qty: number; note: string | null; items: { name: string; code: string; unit: string } }>(db().from('work_order_boq').select('id,item_id,qty,note,items(name,code,unit)').eq('work_order_id', w.id)) : Promise.resolve([]), [w?.id]);
  const [bq, setBq] = useState({ item: '', qty: '' });
  const messes = useLoad(() => rows<{ id: string; name: string; site_id: string; contractor_id: string | null }>(db().from('messes').select('id,name,site_id,contractor_id')), []);
  const [r, setR] = useState({ item: '', rate: '', from: today(1) });
  const [nw, setNw] = useState({ number: '', mess: '', from: '', to: '', days: '30', adv: '0', advp: '0', sd: '0', ret: '5' });
  const [pn, setPn] = useState({ code: 'late_van', what: 'Van more than 30 min late', amount: '', per: 'batch' });
  const a = useAct();
  const money = s.has(['accounts', 'system_admin']);
  const ask = () => a.run(async () => { await save('rates', { work_order_id: w!.id, item_id: r.item, rate: Number(r.rate), valid_from: r.from, asked_by: s.me!.id }); rates.reload(); });
  const decide = (id: string, ok: boolean) => a.run(async () => { await call('decide_rate', { p_rate: id, p_approve: ok, p_reason: ok ? null : prompt('Why refuse?') || '' }); rates.reload(); });
  const addWo = () => a.run(async () => { const m = (messes.data || []).find((x) => x.id === nw.mess)!; await save('work_orders', { company_id: s.me!.company_id, site_id: m.site_id, mess_id: m.id, contractor_id: m.contractor_id, number: nw.number, valid_from: nw.from, valid_to: nw.to, payment_days: Number(nw.days), advance_amount: Number(nw.adv), advance_recovery_pct: Number(nw.advp), security_deposit: Number(nw.sd), retention_pct: Number(nw.ret), state: 'active', created_by: s.me!.id }); wos.reload(); });
  const setBoq = (item: string, qty: string) => a.run(async () => {
    const n = Number(qty.replace(/,/g, ''));
    if (!item || !Number.isFinite(n) || n < 0) throw new Error('Choose the item and type its quantity (0 or more).');
    await call('office_boq_set', { p_work_order: w!.id, p_item: item, p_qty: n }); setBq({ item: '', qty: '' }); boq.reload();
  });
  const addPen = () => a.run(async () => { await save('penalty_rules', { work_order_id: w!.id, code: pn.code, what: pn.what, amount: val(pn.amount), per: pn.per, valid_from: w!.valid_from }); pens.reload(); });
  return (
    <Web title={w ? w.number + ' · ' + (w.contractors?.name || '') : 'Work orders and rates'} roles={['system_admin', 'site_admin', 'accounts', 'management']}
      actions={<select className="wbtn" value={w?.id || ''} onChange={(e) => setSel(e.target.value)} aria-label="Work order">{(wos.data || []).map((x) => <option key={x.id} value={x.id}>{x.number}</option>)}</select>}>
      {wos.loading && !wos.data ? <Loading /> : wos.error ? <Failed error={wos.error} retry={wos.reload} /> : w && <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr)' }}>
        <div className="wcard"><h3>Terms</h3>
          {[['Mess', w.messes?.name], ['Valid', day(w.valid_from) + ' – ' + day(w.valid_to)], ['Payment', w.payment_days + ' days after approval'], ['Advance', inr(w.advance_amount) + ' · ' + w.advance_recovery_pct + '% a month back'], ['Security deposit', inr(w.security_deposit)], ['Retention', w.retention_pct + '% of each bill'], ['GST · TDS', 'Accounts\' rules, with dates']].map(([k, v]) => <div key={k as string} className="row sm" style={{ padding: '5px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v as string}</b></div>)}
          <h3 style={{ marginTop: 12 }}>Penalties</h3>
          {(pens.data || []).map((p) => <div key={p.id} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{p.what}</span><b style={{ color: 'var(--ink)' }}>{p.amount != null ? inr(p.amount) + ' a ' + p.per : 'bill on hold'}</b></div>)}
          {money && <div className="col" style={{ gap: 6, marginTop: 8 }}><Input value={pn.what} onChange={(v) => setPn({ ...pn, what: v })} placeholder="What" /><div className="row" style={{ gap: 6 }}><Input value={pn.code} onChange={(v) => setPn({ ...pn, code: v })} placeholder="code (late_van)" /><Input value={pn.amount} onChange={(v) => setPn({ ...pn, amount: v })} placeholder="₹" inputMode="numeric" /></div><button className="wbtn" onClick={addPen}>Add penalty</button></div>}
        </div>
        <div className="wcard"><h3>Rates – each with its date, old ones kept</h3>
          <Tbl head={['Item', 'Rate', 'From', 'Till', 'State', '']} right={[1]} hl={(i) => (rates.data || [])[i]?.state === 'waiting'}
            rows={(rates.data || []).map((x) => [<b>{x.items.name}</b>, inr(x.rate), day(x.valid_from), x.valid_to ? day(x.valid_to) : '–', <span className={'chip ' + (x.state === 'approved' ? 'leaf' : x.state === 'waiting' ? 'amber' : 'red')} style={{ height: 24 }}>{x.state}</span>,
              x.state === 'waiting' && money && x.asked_by !== s.me?.id ? <span className="row" style={{ gap: 6 }}><button className="chip leaf" onClick={() => decide(x.id, true)}>Approve</button><button className="chip" onClick={() => decide(x.id, false)}>Refuse</button></span> : x.state === 'waiting' ? <span className="xs">asked</span> : ''])} />
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <select className="winp" value={r.item} onChange={(e) => setR({ ...r, item: e.target.value })} aria-label="Item"><option value="">Item</option>{(items.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <Input value={r.rate} onChange={(v) => setR({ ...r, rate: v })} placeholder="₹ rate" inputMode="numeric" /><input className="winp" type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} aria-label="From" />
            <button className="wbtn pri" onClick={ask} disabled={!r.item || !r.rate || a.busy}><Icon name="plus" size={16} />New rate from a date</button></div>
          <div className="xs" style={{ marginTop: 8 }}>A new rate waits for Accounts; approving it ends the rate before it on the day before. Nobody approves the rate he asked.</div>
        </div>
      </div>}
      {w && (() => {
        // the rate of each line: the approved rate on today – or, outside the work order's dates, on its nearest day
        const ref = today() < w.valid_from ? w.valid_from : today() > w.valid_to ? w.valid_to : today();
        const rateOf = (item: string) => (rates.data || []).find((x) => x.state === 'approved' && x.item_id === item && x.valid_from <= ref && (!x.valid_to || x.valid_to >= ref));
        const lines = (boq.data || []).filter((x) => x.qty > 0).sort((x, y) => x.items.name.localeCompare(y.items.name));
        const total = lines.reduce((t, x) => t + (rateOf(x.item_id) ? x.qty * rateOf(x.item_id)!.rate : 0), 0);
        const missing = lines.filter((x) => !rateOf(x.item_id)).length;
        return <div className="wcard"><h3>BOQ – item by item</h3>
          <Tbl head={['Item', 'Unit', 'Quantity', 'Rate', 'Amount']} right={[2, 3, 4]} empty="No BOQ yet – add its items below"
            rows={[...lines.map((x) => { const r = rateOf(x.item_id); return [<b>{x.items.name}</b>, x.items.unit, x.qty.toLocaleString('en-IN'),
              r ? inr(r.rate) : <span className="chip amber" style={{ height: 22 }}>no approved rate</span>, r ? inr(x.qty * r.rate) : '–']; }),
              ...(lines.length ? [[<b>Total</b>, '', '', '', <b>{inr(total)}</b>]] : [])]} />
          <div className="xs" style={{ marginTop: 6 }}>Rates: the approved rate on {day(ref)} (the rates above, with their dates).{missing ? ' ' + missing + ' item(s) have no approved rate – not in the total.' : ''} Every change of a quantity is in the audit log.</div>
          {money && <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <select className="winp" value={bq.item} onChange={(e) => setBq({ ...bq, item: e.target.value, qty: String((boq.data || []).find((x) => x.item_id === e.target.value)?.qty ?? '') })} aria-label="BOQ item"><option value="">Item</option>{(items.data || []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
            <Input value={bq.qty} onChange={(v) => setBq({ ...bq, qty: v })} placeholder="Quantity (0 = out of the BOQ)" inputMode="numeric" />
            <button className="wbtn pri" onClick={() => setBoq(bq.item, bq.qty)} disabled={!bq.item || bq.qty.trim() === '' || a.busy}><Icon name="plus" size={16} />Set in the BOQ</button></div>}
        </div>;
      })()}
      {money && <div className="wcard"><h3>New work order</h3><div className="row wrap" style={{ gap: 8 }}>
        <Input value={nw.number} onChange={(v) => setNw({ ...nw, number: v })} placeholder="Number" />
        <select className="winp" value={nw.mess} onChange={(e) => setNw({ ...nw, mess: e.target.value })} aria-label="Mess"><option value="">Mess</option>{(messes.data || []).filter((m) => m.contractor_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <input className="winp" type="date" value={nw.from} onChange={(e) => setNw({ ...nw, from: e.target.value })} aria-label="From" /><input className="winp" type="date" value={nw.to} onChange={(e) => setNw({ ...nw, to: e.target.value })} aria-label="To" />
        <Input value={nw.days} onChange={(v) => setNw({ ...nw, days: v })} placeholder="Payment days" /><Input value={nw.adv} onChange={(v) => setNw({ ...nw, adv: v })} placeholder="Advance ₹" /><Input value={nw.advp} onChange={(v) => setNw({ ...nw, advp: v })} placeholder="Advance back %" /><Input value={nw.sd} onChange={(v) => setNw({ ...nw, sd: v })} placeholder="Security ₹" /><Input value={nw.ret} onChange={(v) => setNw({ ...nw, ret: v })} placeholder="Retention %" />
        <button className="wbtn pri" onClick={addWo} disabled={!nw.number || !nw.mess || !nw.from || !nw.to || a.busy}><Icon name="plus" size={16} />Add work order</button></div></div>}
      <ErrorLine error={a.error} />
    </Web>
  );
}
