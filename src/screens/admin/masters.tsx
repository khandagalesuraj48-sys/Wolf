// The web's masters: w02 sites, sections · w03 mess (times, who may eat, QR codes) · w04 contractor (bank apart) ·
// w05 documents · w06 work orders, rates with dates, penalties. Every save goes through the table's own rule (RLS) or a function.
// (23-11-2026, his words: "pratek gost edit delet fromdate as sagle asaw proper"; pictures M1–M8 approved) EVERY record has Edit ·
// History · Remove and its From / Till: Remove asks from which date and the reason (office_remove – it stays in the record);
// a dated version (meal times, rates, penalties) is edited from a date or corrected from its start (office_meal_times,
// office_rate_edit, office_penalty); the Km of a section comes by itself from its place (site_km – his word: "KM mi kuthe taknar
// nahi … auto km"). (0017, his word: "ekach thew only section") a site's places are its SECTIONS only – each with its place and
// the metres around it (an order inside them finds the section by itself); no circle is asked or shown.
import { useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { call, db, one, rows, useAct, useLoad } from '../../lib/db';
import { useSession } from '../../lib/session';
import { day, inr, maskMobile, mealName, MEALS, today } from '../../lib/fmt';
import { inUse, listed, stateOf, type Dated } from '../../lib/dated';
import { Icon } from '../../ui/Icon';
import { RoadMap } from '../../ui/RoadMap';
import { GMap, pt, type Mark } from '../../ui/GMap';
import { ErrorLine, Failed, Loading } from '../../ui/kit';
import { Kpi, SitePick, Tbl, Web } from '../../ui/web';
import { Acts, Drawer, here, HistoryBox, RemoveBox, SaveFoot, ShowPick, shownOf, StateChip, WField, type RemoveKind, type Shown } from '../../ui/masters_kit';

async function save(table: string, row: Record<string, unknown>) {
  const { error } = row.id ? await db().from(table).update(row).eq('id', row.id as string) : await db().from(table).insert(row);
  if (error) throw new Error(error.code === '42501' ? 'This change is not yours to make.' : error.code === '23505' ? 'This code / name is used already – choose another, or Edit the one there.' : error.message);
}
const val = (x: string) => (x.trim() === '' ? null : x.trim());
const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const DATED = 'active,valid_from,valid_to,removed_at,removed_reason';

type Hist = { entity: string; id: string; name: string } | null;
type Rem = { kind: RemoveKind; id: string; name: string; sub?: string; noDate?: boolean; word?: string } | null;

// a place typed or read: both numbers inside the earth, or none
function place(lat: string, lng: string): { lat: number | null; lng: number | null } {
  if (lat.trim() === '' && lng.trim() === '') return { lat: null, lng: null };
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) throw new Error('Give both latitude and longitude as numbers (e.g. 19.012345 and 73.145678) – or leave both empty.');
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}
const placeText = (lat: number | null, lng: number | null, m?: number | null) => lat == null || lng == null ? null : Number(lat).toFixed(4) + ', ' + Number(lng).toFixed(4) + (m ? ' · ' + m + ' m' : '');
const NotSet = () => <span className="tag" style={{ background: 'var(--amberS)', color: 'var(--amber)' }}><Icon name="map-pin" size={14} />Not set – Edit to set it</span>;

function PlaceFields({ lat, lng, onChange, metres, onMetres }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void; metres?: string; onMetres?: (v: string) => void }) {
  const a = useAct();
  let p: { lat: number; lng: number } | null = null;
  try { const q = place(lat, lng); p = q.lat == null || q.lng == null ? null : { lat: q.lat, lng: q.lng }; } catch { p = null; }
  return (
    <>
      {p && <GMap height={170} label="Map: the place" marks={[{ ...p, kind: 'mess' }]} ring={metres && Number(metres) > 0 ? { center: p, metres: Number(metres) } : undefined}
        fallback={<div className="xs">{p.lat}, {p.lng}</div>} style={{ borderRadius: 12 }} />}
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <WField label="Latitude"><input className="winp" value={lat} inputMode="decimal" onChange={(e) => onChange(e.target.value, lng)} placeholder="19.012345" /></WField>
        <WField label="Longitude"><input className="winp" value={lng} inputMode="decimal" onChange={(e) => onChange(lat, e.target.value)} placeholder="73.145678" /></WField>
        {onMetres && <WField label="Metres" style={{ flex: 'none', width: 96 }}><input className="winp" value={metres} inputMode="numeric" onChange={(e) => onMetres(e.target.value)} /></WField>}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="wbtn" disabled={a.busy} onClick={() => a.run(async () => { const h = await here(); onChange(h.lat.toFixed(6), h.lng.toFixed(6)); })}>
          <Icon name="locate-fixed" size={16} />{a.busy ? 'Reading…' : 'Use my location'}</button>
        <span className="xs sp">Or in Google Maps: press and hold the place – the two numbers show at the top.</span>
      </div>
      <ErrorLine error={a.error} />
    </>
  );
}

// ── w02 · Sites and sections ──
interface SiteRow extends Dated { id: string; code: string; name: string; removed_reason?: string | null }
interface Sec extends Dated { id: string; site_id: string; code: string; name: string; km: number | null; place: string | null; lat: number | null; lng: number | null; radius_m: number | null; removed_reason?: string | null }

export function Sites() {
  const s = useSession();
  const sysadm = s.has('system_admin');
  const [site, setSite] = useState(s.sites[0]?.id || '');
  const sites = useLoad(() => sysadm ? rows<SiteRow>(db().from('sites').select('id,code,name,' + DATED).order('code')) : Promise.resolve([] as SiteRow[]), [sysadm]);
  const secs = useLoad(() => site ? rows<Sec>(db().from('sections').select('*').eq('site_id', site).order('code')) : Promise.resolve([] as Sec[]), [site]);
  const [showS, setShowS] = useState<Shown>('active');
  const [edSite, setEdSite] = useState<SiteRow | 'new' | null>(null);
  const [edSec, setEdSec] = useState<Sec | 'new' | null>(null);
  const [hist, setHist] = useState<Hist>(null);
  const [rem, setRem] = useState<Rem>(null);
  const reload = () => { sites.reload(); secs.reload(); };
  const canSec = s.has(['system_admin', 'site_admin'], site);
  const ord = (list: Sec[]) => [...list].sort((a, b) => nat(a.code, b.code));
  const live = ord((secs.data || []).filter((x) => inUse(x)));
  const shownSecs = ord(shownOf(secs.data || [], showS));
  const siteName = (sites.data || []).find((x) => x.id === site)?.code || s.sites.find((x) => x.id === site)?.code || '';
  const names: Record<string, string> = Object.fromEntries(s.sites.map((x) => [x.id, x.code]));
  return (
    <Web title="Sites and sections" roles={['system_admin', 'site_admin']} actions={<>
      <SitePick value={site} onChange={setSite} />
      {canSec && <button className="wbtn pri" onClick={() => setEdSec('new')} disabled={!site}><Icon name="plus" size={16} />New section</button>}</>}>
      <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)' }}>
        <div className="wcard" style={{ padding: 0, overflow: 'hidden' }}><GMap height={320} label="Map: the site's sections" fallback={<RoadMap sections={live.map((y) => ({ id: y.id, code: y.code, km: y.km }))} height={320} label="The site's road with its sections" />}
          marks={live.map((y) => { const q = pt(y.lat, y.lng); return q ? { ...q, kind: 'stop', label: y.code, title: y.name } as Mark : null; }).filter(Boolean) as Mark[]} /></div>
        {sysadm ? <div className="wcard tight"><div className="row" style={{ marginBottom: 10 }}><h3 className="sp" style={{ margin: 0 }}>Sites</h3><span className="tag">System Admin</span>
          <button className="wbtn" style={{ height: 34 }} onClick={() => setEdSite('new')}><Icon name="plus" size={14} />New site</button></div>
          {sites.error ? <Failed error={sites.error} retry={sites.reload} /> : <Tbl head={['Code', 'Name', 'From', 'Status', '']} right={[4]}
            rows={(sites.data || []).map((x) => [<b>{x.code}</b>, x.name, day(x.valid_from), <StateChip r={x} />,
              <Acts onEdit={stateOf(x) === 'removed' ? undefined : () => setEdSite(x)} onHistory={() => setHist({ entity: 'sites', id: x.id, name: x.code })}
                onRemove={listed(x) && !x.removed_at ? () => setRem({ kind: 'site', id: x.id, name: x.code, sub: x.name }) : undefined} />])} />}
        </div> : <div className="wcard"><h3>A section is a place</h3><div className="sm">Give each section its place on the map and the metres around it. An order from inside those metres finds the section by itself; an order from outside every section brings its location – the kitchen and the driver get it with the directions. The Km comes by itself: the sections in the order of their codes (A1, A2 … B1 …), the first Km 0.</div></div>}
      </div>
      <div className="wcard"><div className="row wrap" style={{ marginBottom: 10, gap: 10 }}><h3 className="sp" style={{ margin: 0 }}>Sections · {siteName}</h3><ShowPick list={secs.data || []} value={showS} onChange={setShowS} /></div>
        {secs.loading && !secs.data ? <Loading /> : secs.error ? <Failed error={secs.error} retry={secs.reload} /> :
          <Tbl head={['Section', 'Name', 'Km', 'Drop point', 'Place and metres', 'From', 'Status', '']} right={[7]} empty="No section yet" hl={(i) => { const y = shownSecs[i]; return !!y && listed(y) && (y.lat == null || y.radius_m == null); }}
            rows={shownSecs.map((y) => [<b>{y.code}</b>, y.name, y.km ?? '–', y.place || '–', y.lat != null && y.radius_m != null ? placeText(y.lat, y.lng, y.radius_m) : <NotSet />, day(y.valid_from), <StateChip r={y} />,
              <Acts onEdit={canSec && stateOf(y) !== 'removed' ? () => setEdSec(y) : undefined} onHistory={() => setHist({ entity: 'sections', id: y.id, name: 'Section ' + y.code })}
                onRemove={canSec && listed(y) && !y.removed_at ? () => setRem({ kind: 'section', id: y.id, name: 'Section ' + y.code, sub: y.name }) : undefined} />])} />}
        <div className="row xs" style={{ marginTop: 12, gap: 8, alignItems: 'flex-start' }}><Icon name="info" size={14} /><span className="sp">A van order from inside a section's metres goes to that section by itself; from outside every section it carries the person's location. A section without its place and metres is only chosen by hand. The Km comes by itself, in the order of the codes. Remove asks from which date and the reason; orders and deliveries before it stay as they are.</span></div>
      </div>
      {edSite && <SiteForm row={edSite === 'new' ? null : edSite} onClose={() => setEdSite(null)} onSaved={async () => { setEdSite(null); reload(); await s.refresh(); }} />}
      {edSec && <SectionForm site={site} row={edSec === 'new' ? null : edSec} onClose={() => setEdSec(null)} onSaved={() => { setEdSec(null); reload(); }} />}
      {hist && <HistoryBox {...hist} names={names} onClose={() => setHist(null)} />}
      {rem && <RemoveBox {...rem} onClose={() => setRem(null)} onDone={async () => { setRem(null); reload(); if (rem.kind === 'site') await s.refresh(); }} />}
    </Web>
  );
}

function SiteForm({ row, onClose, onSaved }: { row: SiteRow | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ code: row?.code || '', name: row?.name || '', from: row?.valid_from || (row ? '' : today()), why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    await save('sites', { ...(row ? { id: row.id } : { company_id: s.me!.company_id }), code: f.code.trim().toUpperCase(), name: f.name.trim(), valid_from: val(f.from) });
    if (row && f.why.trim()) await call('office_note', { p_entity: 'sites', p_id: row.id, p_reason: f.why });
    onSaved();
  });
  return (
    <Drawer title={row ? 'Edit · ' + row.code : 'New site'} onClose={onClose} foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={!f.code.trim() || !f.name.trim()} word={row ? 'Save changes' : 'Add site'} />}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Code" style={{ flex: 'none', width: 140 }}><input className="winp" value={f.code} maxLength={16} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="VTR" /></WField>
        <WField label="Name"><input className="winp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></WField>
      </div>
      <WField label="In use from"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
      {row && <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional" /></WField>}
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function SectionForm({ site, row, onClose, onSaved }: { site: string; row: Sec | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: row?.code || '', name: row?.name || '', place: row?.place || '', lat: row?.lat != null ? String(row.lat) : '', lng: row?.lng != null ? String(row.lng) : '',
    metres: row?.radius_m != null ? String(row.radius_m) : '', from: row?.valid_from || (row ? '' : today()), why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const p = place(f.lat, f.lng), metres = Number(f.metres);
    if (p.lat != null && (f.metres.trim() === '' || !Number.isInteger(metres) || metres < 10 || metres > 5000)) throw new Error('Metres around the section: 10 to 5000.');
    await save('sections', { ...(row ? { id: row.id } : { site_id: site }), code: f.code.trim().toUpperCase(), name: f.name.trim() || f.code.trim().toUpperCase(),
      place: val(f.place), lat: p.lat, lng: p.lng, radius_m: p.lat == null ? null : metres, valid_from: val(f.from) });
    if (row && f.why.trim()) await call('office_note', { p_entity: 'sections', p_id: row.id, p_reason: f.why });
    onSaved();
  });
  return (
    <Drawer title={row ? 'Edit · Section ' + row.code : 'New section'} sub={row?.km != null ? 'Km ' + row.km + ' – it comes by itself from the places' : 'The Km comes by itself from the places'} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={!f.code.trim()} word={row ? 'Save changes' : 'Add section'} />}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Code" style={{ flex: 'none', width: 140 }}><input className="winp" value={f.code} maxLength={12} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="A1" /></WField>
        <WField label="Name"><input className="winp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Majiwada" /></WField>
      </div>
      <WField label="Drop point"><input className="winp" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="e.g. site office" /></WField>
      <div className="hr" /><b style={{ fontSize: 14 }}>Place on the map and the metres around it</b>
      <PlaceFields lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF({ ...f, lat, lng })} metres={f.metres} onMetres={(v) => setF({ ...f, metres: v })} />
      <div className="xs">A van order from inside these metres goes to this section by itself. Outside every section, the order brings the person's location.</div>
      <div className="hr" />
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="In use from"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
        {row && <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional" /></WField>}
      </div>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

// ── w03 · Mess master ──
interface Mess extends Dated { id: string; name: string; site_id: string; contractor_id: string | null; lat: number | null; lng: number | null; radius_m: number | null; counters: number | null; removed_reason?: string | null }
interface Con extends Dated { id: string; name: string; kind: string; contact_name: string | null; contact_mobile: string | null; gstin: string | null; pan: string | null; udyam: string | null; address: string | null; login_code: string | null; removed_reason?: string | null }

export function Messes() {
  const [tab, setTab] = useState<'messes' | 'contractors'>('messes');
  return (
    <Web title="Mess and contractors" roles={['system_admin', 'site_admin', 'accounts']}>
      <div className="row wrap" style={{ gap: 8 }} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'messes'} className={'chip' + (tab === 'messes' ? ' on' : '')} onClick={() => setTab('messes')}><Icon name="store" size={14} />Messes</button>
        <button type="button" role="tab" aria-selected={tab === 'contractors'} className={'chip' + (tab === 'contractors' ? ' on' : '')} onClick={() => setTab('contractors')}><Icon name="users" size={14} />Contractors</button>
      </div>
      {tab === 'messes' ? <MessList /> : <Contractors />}
    </Web>
  );
}

function MessList() {
  const s = useSession();
  const list = useLoad(() => rows<Mess>(db().from('messes').select('*').order('name')), []);
  const cons = useLoad(() => rows<Con>(db().from('contractors').select('*').order('name')), []);
  const [sel, setSel] = useState('');
  const [shown, setShown] = useState<Shown>('active');
  const [find, setFind] = useState('');
  const [siteF, setSiteF] = useState('');
  const [ed, setEd] = useState<Mess | 'new' | null>(null);
  const [hist, setHist] = useState<Hist>(null);
  const [rem, setRem] = useState<Rem>(null);
  const siteCode = (id: string) => s.sites.find((x) => x.id === id)?.code || '–';
  const conName = (id: string | null) => (cons.data || []).find((x) => x.id === id)?.name || '–';
  const all = list.data || [];
  const q = find.trim().toLowerCase();
  const view = shownOf(all, shown).filter((m) => (!siteF || m.site_id === siteF) && (!q || [m.name, siteCode(m.site_id), conName(m.contractor_id)].some((t) => t.toLowerCase().includes(q))));
  const m = all.find((x) => x.id === sel) || view[0];
  const can = (x: Mess) => s.has(['system_admin', 'site_admin'], x.site_id);
  const printQR = async () => {
    if (!m) return;
    const win = window.open('', '_blank'); if (!win) return;
    const n = m.counters || 1, codes: string[] = [];
    for (let i = 1; i <= n; i++) codes.push(await QRCode.toDataURL(location.origin + '/m/' + m.id + '?c=' + i, { width: 360, margin: 1 }));
    win.document.write('<title>' + m.name + ' – QR</title><body style="font-family:sans-serif;display:flex;flex-wrap:wrap;gap:24px">' + codes.map((c, i) => '<div style="text-align:center;border:1px solid #ccc;padding:18px;border-radius:12px"><img src="' + c + '" width="260"><h2>' + m.name + '</h2><p>Counter ' + (i + 1) + ' · scan with FALCON</p></div>').join('') + '<script>print()<\/script>');
  };
  const names: Record<string, string> = Object.fromEntries([...s.sites.map((x) => [x.id, x.code]), ...(cons.data || []).map((c) => [c.id, c.name])]);
  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <ShowPick list={all} value={shown} onChange={setShown} />
        <span className="sp" />
        <label className="winp" style={{ width: 280 }}><Icon name="search" size={16} /><input aria-label="Search" placeholder="Search mess, site, contractor" value={find} onChange={(e) => setFind(e.target.value)}
          style={{ border: 0, outline: 0, font: 'inherit', fontSize: 14, flex: 1, minWidth: 0, background: 'transparent' }} /></label>
        <select className="wbtn" value={siteF} onChange={(e) => setSiteF(e.target.value)} aria-label="Site"><option value="">Every site</option>{s.sites.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
        <button className="wbtn" onClick={() => void printQR()} disabled={!m}><Icon name="qr-code" size={16} />Print QR codes</button>
        {s.has(['system_admin', 'site_admin']) && <button className="wbtn pri" onClick={() => setEd('new')}><Icon name="plus" size={16} />New mess</button>}
      </div>
      {list.error && <Failed error={list.error} retry={list.reload} />}
      <div className="wcard" style={{ padding: '6px 6px 0' }}>
        {list.loading && !list.data ? <Loading /> : <Tbl head={['Mess', 'Site', 'Contractor', 'Place on the map', 'Counters', 'From', 'Status', '']} right={[4, 7]} empty="No mess here"
          hl={(i) => view[i]?.id === m?.id}
          rows={view.map((x) => [<button type="button" className="sb" style={{ border: 0, padding: 0, height: 'auto', fontWeight: 700, fontSize: 14 }} onClick={() => setSel(x.id)}>{x.name}</button>,
            siteCode(x.site_id), conName(x.contractor_id), placeText(x.lat, x.lng, x.radius_m) || (listed(x) ? <NotSet /> : '–'), x.counters || 1, day(x.valid_from), <StateChip r={x} />,
            <Acts onEdit={can(x) && stateOf(x) !== 'removed' ? () => setEd(x) : undefined} onHistory={() => setHist({ entity: 'messes', id: x.id, name: x.name })}
              onRemove={can(x) && listed(x) && !x.removed_at ? () => setRem({ kind: 'mess', id: x.id, name: x.name, sub: siteCode(x.site_id) + ' · ' + conName(x.contractor_id) }) : undefined} />])} />}
      </div>
      {m && <MealTimes mess={m} can={can(m) && listed(m)} onHistory={setHist} onRemove={setRem} />}
      <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">Every save and every removal is kept in History – who, when, before → after and the reason. Nothing is wiped out.</span></div>
      {ed && <MessForm row={ed === 'new' ? null : ed} cons={(cons.data || []).filter((c) => inUse(c) || (ed !== 'new' && c.id === ed.contractor_id))} onClose={() => setEd(null)} onSaved={() => { setEd(null); list.reload(); }} />}
      {hist && <HistoryBox {...hist} names={names} onClose={() => setHist(null)} />}
      {rem && <RemoveBox {...rem} onClose={() => setRem(null)} onDone={() => { setRem(null); list.reload(); }} />}
    </>
  );
}

function MessForm({ row, cons, onClose, onSaved }: { row: Mess | null; cons: Con[]; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const mySites = s.sites.filter((x) => s.has(['system_admin', 'site_admin'], x.id));
  const [f, setF] = useState({ name: row?.name || '', site: row?.site_id || mySites[0]?.id || '', contractor: row?.contractor_id || '', counters: String(row?.counters || 1),
    lat: row?.lat != null ? String(row.lat) : '', lng: row?.lng != null ? String(row.lng) : '', metres: String(row?.radius_m || 100), from: row?.valid_from || (row ? '' : today()), why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const p = place(f.lat, f.lng), metres = Number(f.metres), counters = Number(f.counters);
    if (p.lat != null && (!Number.isInteger(metres) || metres < 10 || metres > 5000)) throw new Error('Metres around the mess: 10 to 5000.');
    if (!Number.isInteger(counters) || counters < 1 || counters > 50) throw new Error('Counters with QR: 1 to 50.');
    await save('messes', { ...(row ? { id: row.id } : { company_id: s.me!.company_id }), name: f.name.trim(), site_id: f.site, contractor_id: f.contractor || null, counters,
      lat: p.lat, lng: p.lng, radius_m: p.lat == null ? null : metres, valid_from: val(f.from) });
    if (row && f.why.trim()) await call('office_note', { p_entity: 'messes', p_id: row.id, p_reason: f.why });
    onSaved();
  });
  return (
    <Drawer title={row ? 'Edit · ' + row.name : 'New mess'} sub={row?.valid_from ? 'In use from ' + day(row.valid_from) : undefined} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={f.name.trim().length < 2 || !f.site} word={row ? 'Save changes' : 'Add mess'} />}>
      <WField label="Mess name"><input className="winp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></WField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Site"><select className="winp" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}>{mySites.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></WField>
        <WField label="Contractor"><select className="winp" value={f.contractor} onChange={(e) => setF({ ...f, contractor: e.target.value })}><option value="">None yet</option>{cons.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></WField>
      </div>
      <WField label="Counters with QR"><input className="winp" value={f.counters} inputMode="numeric" onChange={(e) => setF({ ...f, counters: e.target.value })} /></WField>
      <div className="hr" /><b style={{ fontSize: 14 }}>Place on the map</b>
      <PlaceFields lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF({ ...f, lat, lng })} metres={f.metres} onMetres={(v) => setF({ ...f, metres: v })} />
      <div className="xs">Inside these metres the phone says “You are at the mess”; outside it shows how far, the way, and the parcel.</div>
      <div className="hr" />
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="In use from"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
        {row && <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional, e.g. place set at the camp gate" /></WField>}
      </div>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

// the meal times of one mess, each version with its dates
interface Win extends Dated { id: string; meal: string; serve_from: string; serve_to: string; order_by: string; change_minutes: number; valid_from: string; valid_to: string | null }
function MealTimes({ mess, can, onHistory, onRemove }: { mess: Mess; can: boolean; onHistory: (h: Hist) => void; onRemove: (r: Rem) => void }) {
  const wins = useLoad(() => rows<Win>(db().from('meal_windows').select('*').eq('mess_id', mess.id).order('valid_from', { ascending: false })), [mess.id]);
  const [shown, setShown] = useState<Shown>('active');
  const [ed, setEd] = useState<Win | 'new' | null>(null);
  const order = (w: Win) => MEALS.indexOf(w.meal as (typeof MEALS)[number]);
  const view = shownOf(wins.data || [], shown).sort((a, b) => order(a) - order(b) || nat(a.valid_from, b.valid_from));
  const hm = (t: string) => t.slice(0, 5);
  return (
    <div className="wcard">
      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}><h3 className="sp" style={{ margin: 0 }}>{mess.name} · Meals and times</h3><ShowPick list={wins.data || []} value={shown} onChange={setShown} />
        {can && <button className="wbtn pri" onClick={() => setEd('new')}><Icon name="plus" size={16} />New times from a date</button>}</div>
      {wins.error ? <Failed error={wins.error} retry={wins.reload} /> : <Tbl head={['Meal', 'Served', 'Parcel order by', 'Change window', 'From', 'Till', 'Status', '']} right={[7]} empty="No meal times yet – give them from a date"
        rows={view.map((w) => { const st = stateOf(w), live = st !== 'ended' && st !== 'removed';
          return [<b>{mealName(w.meal)}</b>, hm(w.serve_from) + ' – ' + hm(w.serve_to), hm(w.order_by), w.change_minutes + ' min', day(w.valid_from), w.valid_to ? day(w.valid_to) : '–', <StateChip r={w} inUse="In use" />,
            <Acts onEdit={can && live ? () => setEd(w) : undefined} onHistory={() => onHistory({ entity: 'meal_windows', id: w.id, name: mealName(w.meal) + ' · ' + mess.name })}
              onRemove={can && live ? () => onRemove({ kind: 'meal_time', id: w.id, name: mealName(w.meal) + ' times', sub: mess.name + ' · from ' + day(w.valid_from) }) : undefined} />]; })} />}
      <div className="row xs" style={{ marginTop: 12, gap: 8, alignItems: 'flex-start' }}><Icon name="info" size={14} /><span className="sp">In use: Edit asks from which date – the days before keep the old times. Coming: Edit or Remove it as it is. Ended: kept, read only.</span></div>
      {ed && <TimesForm mess={mess} win={ed === 'new' ? null : ed} onClose={() => setEd(null)} onSaved={() => { setEd(null); wins.reload(); }} />}
    </div>
  );
}

function TimesForm({ mess, win, onClose, onSaved }: { mess: Mess; win: Win | null; onClose: () => void; onSaved: () => void }) {
  const coming = !!win && win.valid_from > today();
  const [f, setF] = useState({ meal: win?.meal || 'lunch', from: win ? (coming ? win.valid_from : today()) : today(), sf: win?.serve_from.slice(0, 5) || '12:30', st: win?.serve_to.slice(0, 5) || '14:30',
    ob: win?.order_by.slice(0, 5) || '11:30', ch: String(win?.change_minutes ?? 2), how: coming ? 'correct' : 'date', why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    await call('office_meal_times', { p_mess: mess.id, p_meal: f.meal, p_window: win?.id || null, p_from: win && f.how === 'correct' ? null : f.from,
      p_serve_from: f.sf, p_serve_to: f.st, p_order_by: f.ob, p_change: Number(f.ch), p_reason: f.why.trim() || null });
    onSaved();
  });
  return (
    <Drawer title={win ? 'Edit · ' + mealName(win.meal) + ' · ' + mess.name : 'New times · ' + mess.name} sub={win ? (coming ? 'Coming – from ' : 'In use since ') + day(win.valid_from) : 'From the date you give; the times before it stay'}
      onClose={onClose} foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} word="Save" disabled={!f.sf || !f.st || !f.ob || (f.how === 'date' && !f.from)} />}>
      {!win && <WField label="Meal"><select className="winp" value={f.meal} onChange={(e) => setF({ ...f, meal: e.target.value })}>{MEALS.map((x) => <option key={x} value={x}>{mealName(x)}</option>)}</select></WField>}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Served from"><input className="winp" type="time" value={f.sf} onChange={(e) => setF({ ...f, sf: e.target.value })} /></WField>
        <WField label="Served till"><input className="winp" type="time" value={f.st} onChange={(e) => setF({ ...f, st: e.target.value })} /></WField>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Parcel order by"><input className="winp" type="time" value={f.ob} onChange={(e) => setF({ ...f, ob: e.target.value })} /></WField>
        <WField label="Change window (minutes)"><input className="winp" value={f.ch} inputMode="numeric" onChange={(e) => setF({ ...f, ch: e.target.value })} /></WField>
      </div>
      <div className="hr" />
      {win ? <>
        <b style={{ fontSize: 14 }}>Which days get the new times?</b>
        <label className={'opt' + (f.how === 'date' ? ' on' : '')}><input type="radio" name="how" checked={f.how === 'date'} onChange={() => setF({ ...f, how: 'date' })} style={{ marginTop: 3 }} />
          <span className="col sp" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>From a date</b>
            <input className="winp" type="date" min={today()} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, how: 'date' })} aria-label="New times from" />
            <span className="xs">The days before it keep the old times; from it the new ones. Both stay in the list with their dates.</span></span></label>
        <label className={'opt' + (f.how === 'correct' ? ' on' : '')}><input type="radio" name="how" checked={f.how === 'correct'} onChange={() => setF({ ...f, how: 'correct' })} style={{ marginTop: 3 }} />
          <span className="col sp" style={{ gap: 4 }}><b style={{ fontSize: 14 }}>Correct it from its start ({day(win.valid_from)})</b>
            <span className="xs">Only for a typing mistake. Orders already made stay as they are.</span></span></label>
      </> : <WField label="From"><input className="winp" type="date" min={today()} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>}
      <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional" /></WField>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

// ── w04 · w05 · Contractors, bank details, documents ──
interface Doc { id: string; contractor_id: string; kind: string; number: string | null; valid_from: string | null; valid_to: string | null; state: string; file_path: string | null; removed_at: string | null; removed_reason: string | null }
const DOC_KINDS = ['fssai', 'gst', 'pan', 'udyam', 'shop_act', 'work_order', 'agreement', 'bank_proof', 'medical_fitness', 'pest_control', 'other'];
const docName = (k: string) => k.replace('_', ' ').toUpperCase();

function Contractors() {
  const s = useSession();
  const list = useLoad(() => rows<Con>(db().from('contractors').select('*').order('name')), []);
  const messes = useLoad(() => rows<Mess>(db().from('messes').select('id,name,site_id,contractor_id,' + DATED)), []);
  const allDocs = useLoad(() => rows<Doc>(db().from('contractor_documents').select('id,contractor_id,kind,number,valid_from,valid_to,state,file_path,removed_at,removed_reason').order('kind')), []);
  const [sel, setSel] = useState('');
  const [shown, setShown] = useState<Shown>('active');
  const [ed, setEd] = useState<Con | 'new' | null>(null);
  const [hist, setHist] = useState<Hist>(null);
  const [rem, setRem] = useState<Rem>(null);
  const money = s.has(['accounts', 'system_admin']);
  const all = list.data || [];
  const view = shownOf(all, shown);
  const c = all.find((x) => x.id === sel) || view[0];
  const docsOf = (id: string) => (allDocs.data || []).filter((d) => d.contractor_id === id && !d.removed_at);
  const papers = (id: string) => {
    const ds = docsOf(id), end = ds.filter((d) => d.valid_to && d.valid_to <= today(60) && d.valid_to >= today()).length, asked = ds.filter((d) => d.state === 'asked').length;
    const ok = ds.filter((d) => d.state !== 'asked' && (!d.valid_to || d.valid_to >= today())).length;
    return asked ? <span className="tag" style={{ background: 'var(--redS)', color: '#9B1C1C' }}>{asked} asked, not given</span>
      : end ? <span className="tag" style={{ background: 'var(--amberS)', color: 'var(--amber)' }}>{ok} valid · {end} ending</span> : ds.length ? ok + ' valid' : '–';
  };
  const reload = () => { list.reload(); messes.reload(); allDocs.reload(); };
  const names: Record<string, string> = Object.fromEntries([...s.sites.map((x) => [x.id, x.code]), ...(messes.data || []).map((m) => [m.id, m.name])]);
  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <ShowPick list={all} value={shown} onChange={setShown} /><span className="sp" />
        {money && <button className="wbtn pri" onClick={() => setEd('new')}><Icon name="plus" size={16} />New contractor</button>}
      </div>
      {list.error && <Failed error={list.error} retry={list.reload} />}
      <div className="wcard" style={{ padding: '6px 6px 0' }}>
        {list.loading && !list.data ? <Loading /> : <Tbl head={['Business', 'Type', 'Contact', 'Mobile', 'Messes', 'Papers', 'From', 'Status', '']} right={[4, 8]} empty="No contractor here" hl={(i) => view[i]?.id === c?.id}
          rows={view.map((x) => [<button type="button" className="sb" style={{ border: 0, padding: 0, height: 'auto', fontWeight: 700, fontSize: 14 }} onClick={() => setSel(x.id)}>{x.name}</button>,
            x.kind, x.contact_name || '–', maskMobile(x.contact_mobile), (messes.data || []).filter((m) => m.contractor_id === x.id && inUse(m)).length, papers(x.id), day(x.valid_from), <StateChip r={x} />,
            <Acts onEdit={money && stateOf(x) !== 'removed' ? () => setEd(x) : undefined} onHistory={() => setHist({ entity: 'contractors', id: x.id, name: x.name })}
              onRemove={money && listed(x) && !x.removed_at ? () => setRem({ kind: 'contractor', id: x.id, name: x.name, sub: x.kind }) : undefined} />])} />}
      </div>
      {c && <ContractorDetail c={c} money={money} docs={(allDocs.data || []).filter((d) => d.contractor_id === c.id)} onEdit={() => setEd(c)} onChanged={reload} onHistory={setHist} onRemove={setRem} />}
      {ed && <ContractorForm row={ed === 'new' ? null : ed} onClose={() => setEd(null)} onSaved={() => { setEd(null); list.reload(); }} />}
      {hist && <HistoryBox {...hist} names={names} onClose={() => setHist(null)} />}
      {rem && <RemoveBox {...rem} onClose={() => setRem(null)} onDone={() => { setRem(null); reload(); }} />}
    </>
  );
}

function ContractorDetail({ c, money, docs, onEdit, onChanged, onHistory, onRemove }: { c: Con; money: boolean; docs: Doc[]; onEdit: () => void; onChanged: () => void; onHistory: (h: Hist) => void; onRemove: (r: Rem) => void }) {
  const s = useSession();
  // (23-11-2026) who signs in with the contractor's code: a live Mess owner / operator role at one of its messes (People and roles)
  const signers = useLoad(async () => {
    const ms = await rows<{ id: string; name: string }>(db().from('messes').select('id,name').eq('contractor_id', c.id));
    if (!ms.length) return [];
    const gs = await rows<{ person_id: string; role: string; mess_id: string }>(db().from('role_grants').select('person_id,role,mess_id').in('mess_id', ms.map((m) => m.id)).in('role', ['mess_owner', 'mess_operator']).is('revoked_at', null));
    const ps = gs.length ? await rows<{ id: string; full_name: string; mobile: string | null }>(db().from('people').select('id,full_name,mobile').in('id', [...new Set(gs.map((g) => g.person_id))])) : [];
    return gs.map((g) => ({ ...g, person: ps.find((p) => p.id === g.person_id), mess: ms.find((m) => m.id === g.mess_id)?.name }));
  }, [c.id]);
  const bank = useLoad(() => money ? one<{ bank_name: string; ifsc: string; account_no: string }>(db().from('contractor_bank').select('bank_name,ifsc,account_no').eq('contractor_id', c.id).limit(1)) : Promise.resolve(null), [c.id, money]);
  const [code, setCode] = useState('');
  const [bankEd, setBankEd] = useState(false);
  const [doc, setDoc] = useState<Doc | 'new' | null>(null);
  const [shownD, setShownD] = useState<'current' | 'removed'>('current');
  const a = useAct();
  const saveCode = () => a.run(async () => { await call('office_contractor_code', { p_contractor: c.id, p_code: code.trim().toUpperCase() || null }); setCode(''); onChanged(); });
  const verify = (id: string) => a.run(async () => { await save('contractor_documents', { id, state: 'verified', verified_by: s.me!.id, verified_at: new Date().toISOString() }); onChanged(); });
  const open = async (p: string) => { const r = await supabase!.storage.from('contractor-papers').createSignedUrl(p, 300); if (r.data) window.open(r.data.signedUrl, '_blank'); };
  const cur = docs.filter((d) => !d.removed_at), gone = docs.filter((d) => d.removed_at);
  const ending = cur.filter((x) => x.valid_to && x.valid_to <= today(60) && x.valid_to >= today());
  const office = s.has(['site_admin', 'accounts', 'system_admin']);
  const kv = (rowsKv: [string, string | null | undefined][]) => rowsKv.map(([k, v]) => <div key={k} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v || '–'}</b></div>);
  const editBtn = (onClick: () => void, word = 'Edit') => <button type="button" className="sb" onClick={onClick}><Icon name="pencil" size={14} />{word}</button>;
  const shownDocs = shownD === 'current' ? cur : gone;
  return (
    <>
      <h2 style={{ margin: '6px 0 0', fontSize: 20 }}>{c.name}{c.removed_at && <span className="chip st red" style={{ marginLeft: 10 }}>Removed – {c.removed_reason}</span>}</h2>
      <div className="g3">
        <div className="wcard"><div className="row" style={{ marginBottom: 8 }}><h3 className="sp" style={{ margin: 0 }}>Business</h3>{money && !c.removed_at && editBtn(onEdit)}</div>
          {kv([['Type', c.kind], ['Contact', c.contact_name], ['Mobile', c.contact_mobile], ['Address', c.address], ['From', day(c.valid_from)]])}</div>
        <div className="wcard"><div className="row" style={{ marginBottom: 8 }}><h3 className="sp" style={{ margin: 0 }}>Tax</h3>{money && !c.removed_at && editBtn(onEdit)}</div>
          {kv([['PAN', c.pan], ['GSTIN', c.gstin], ['Udyam', c.udyam], ['GST · TDS', 'Accounts\' rules with dates']])}</div>
        <div className="wcard"><div className="row" style={{ marginBottom: 8 }}><h3 className="sp" style={{ margin: 0 }}>Bank</h3>{money && editBtn(() => setBankEd(true), 'Edit · Accounts')}</div>
          {bank.data ? kv([['Bank · IFSC', bank.data.bank_name + ' · ' + bank.data.ifsc], ['Account', 'XXXX ' + bank.data.account_no.slice(-4)]]) : <div className="sm">{money ? 'Not given yet' : 'Seen only by Accounts'}</div>}
          <div className="xs" style={{ marginTop: 6 }}>Seen and changed only by Accounts. Every change is in History.</div></div>
      </div>
      <div className="wcard"><h3>Sign-in code – for the owner and his operators</h3>
        <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
          <b style={{ fontSize: 26, letterSpacing: '.08em', color: c.login_code ? 'var(--ink)' : 'var(--muted)' }}>{c.login_code || 'Not set'}</b>
          {s.has('system_admin') && <><input className="winp" style={{ width: 180 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={c.login_code ? 'New code' : 'Code, e.g. SAIMESS'} maxLength={12} aria-label="Sign-in code" />
            <button className="wbtn pri" onClick={saveCode} disabled={a.busy || (!code.trim() && !c.login_code)}>{code.trim() ? 'Save code' : 'Remove code'}</button></>}
        </div>
        <div className="xs" style={{ marginTop: 6 }}>Typed on the app's first screen instead of the company code: the app knows {c.name}'s people have come. One code in all of FALCON – never a company's code. Only the System Admin sets it. A removed contractor's code opens nothing.</div>
        <Tbl head={['Signs in', 'Mobile', 'Role', 'Mess']} empty="Nobody yet – give the Mess owner / Mess operator role at this contractor's mess in People and roles"
          rows={(signers.data || []).map((x) => [<b>{x.person?.full_name || '–'}</b>, maskMobile(x.person?.mobile), x.role === 'mess_owner' ? 'Owner' : 'Operator', x.mess || '–'])} />
      </div>
      <div className="kpis"><Kpi label="Valid" value={cur.filter((x) => x.state === 'verified' && (!x.valid_to || x.valid_to >= today())).length} tone="leaf" /><Kpi label="Ending in 60 days" value={ending.length} tone="amber" /><Kpi label="Expired" value={cur.filter((x) => x.valid_to && x.valid_to < today()).length} tone="red" /><Kpi label="Asked, not given" value={cur.filter((x) => x.state === 'asked').length} tone="red" /></div>
      <div className="wcard">
        <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}><h3 className="sp" style={{ margin: 0 }}>Papers</h3>
          <button type="button" className={'chip' + (shownD === 'current' ? ' on' : '')} onClick={() => setShownD('current')}>Current · {cur.length}</button>
          <button type="button" className={'chip' + (shownD === 'removed' ? ' on' : '')} onClick={() => setShownD('removed')}>Removed · {gone.length}</button>
          {office && <button className="wbtn pri" onClick={() => setDoc('new')}><Icon name="plus" size={16} />Add a paper</button>}</div>
        <Tbl head={shownD === 'current' ? ['Paper', 'Number', 'Valid from', 'Valid till', 'Status', ''] : ['Paper', 'Number', 'Valid from', 'Valid till', 'Removed – why', '']} right={[5]} hl={(i) => shownD === 'current' && !!ending.find((e) => e.id === cur[i]?.id)}
          rows={shownDocs.map((x) => [<b>{docName(x.kind)}</b>, x.number || '–', day(x.valid_from), day(x.valid_to),
            shownD === 'removed' ? x.removed_reason || '–' : <span className={'chip st ' + (x.state === 'verified' ? (x.valid_to && x.valid_to < today() ? 'red' : 'leaf') : x.state === 'asked' ? 'red' : 'amber')}>{x.state === 'verified' ? (x.valid_to && x.valid_to < today() ? 'Expired' : 'Valid') : x.state === 'asked' ? 'Asked, not given' : x.state === 'attached' ? 'Attached – to verify' : x.state}</span>,
            <Acts onEdit={shownD === 'current' && office ? () => setDoc(x) : undefined} onHistory={() => onHistory({ entity: 'contractor_documents', id: x.id, name: docName(x.kind) + ' · ' + c.name })}
              onRemove={shownD === 'current' && office ? () => onRemove({ kind: 'paper', id: x.id, name: docName(x.kind), sub: c.name, noDate: true }) : undefined}>
              {x.file_path && <button type="button" className="sb" onClick={() => void open(x.file_path!)}><Icon name="eye" size={14} />View</button>}
              {shownD === 'current' && x.state === 'attached' && office && <button type="button" className="sb ok" onClick={() => verify(x.id)}>Verify</button>}
            </Acts>])} />
        <div className="xs" style={{ marginTop: 8 }}>Edit: its number and dates, or a new file in its place (the old one stays in History). Remove: it leaves the list and stays in the record. Alerts 60, 30 and 7 days before the end and on the day it ends – to the Site Admin, Accounts and the contractor.</div>
      </div>
      <ErrorLine error={a.error} />
      {bankEd && <BankForm c={c} now={bank.data || null} onClose={() => setBankEd(false)} onSaved={() => { setBankEd(false); bank.reload(); }} />}
      {doc && <PaperForm c={c} row={doc === 'new' ? null : doc} onClose={() => setDoc(null)} onSaved={() => { setDoc(null); onChanged(); }} />}
    </>
  );
}

function ContractorForm({ row, onClose, onSaved }: { row: Con | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ name: row?.name || '', kind: row?.kind || 'proprietor', contact: row?.contact_name || '', mobile: (row?.contact_mobile || '').replace(/^\+91/, ''), gstin: row?.gstin || '',
    pan: row?.pan || '', udyam: row?.udyam || '', address: row?.address || '', from: row?.valid_from || (row ? '' : today()), why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const mob = f.mobile.replace(/\D/g, '').slice(-10);
    if (f.mobile.trim() && mob.length !== 10) throw new Error('The mobile has 10 digits.');
    await save('contractors', { ...(row ? { id: row.id } : { company_id: s.me!.company_id }), name: f.name.trim(), kind: f.kind, contact_name: val(f.contact), contact_mobile: mob ? '+91' + mob : null,
      gstin: val(f.gstin.toUpperCase()), pan: val(f.pan.toUpperCase()), udyam: val(f.udyam), address: val(f.address), valid_from: val(f.from) });
    if (row && f.why.trim()) await call('office_note', { p_entity: 'contractors', p_id: row.id, p_reason: f.why });
    onSaved();
  });
  const t = (k: 'name' | 'contact' | 'mobile' | 'gstin' | 'pan' | 'udyam' | 'address' | 'why', label: string, ph = '') =>
    <WField label={label}><input className="winp" value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></WField>;
  return (
    <Drawer title={row ? 'Edit · ' + row.name : 'New contractor'} onClose={onClose} foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={f.name.trim().length < 2} word={row ? 'Save changes' : 'Add contractor'} />}>
      {t('name', 'Business name')}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Type"><select className="winp" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['proprietor', 'partnership', 'llp', 'company', 'other'].map((k) => <option key={k}>{k}</option>)}</select></WField>
        {t('contact', 'Contact person')}
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>{t('mobile', 'Mobile', '10 digits')}{t('gstin', 'GSTIN')}</div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>{t('pan', 'PAN')}{t('udyam', 'Udyam')}</div>
      {t('address', 'Address')}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="From"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
        {row && t('why', 'Why (kept in History)', 'Optional')}
      </div>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function BankForm({ c, now, onClose, onSaved }: { c: Con; now: { bank_name: string; ifsc: string; account_no: string } | null; onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState({ bank: now?.bank_name || '', ifsc: now?.ifsc || '', acc: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const { error } = await db().from('contractor_bank').upsert({ contractor_id: c.id, bank_name: b.bank.trim(), ifsc: b.ifsc.trim().toUpperCase(), account_no: b.acc.replace(/\D/g, ''), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.code === '42501' ? 'Only Accounts changes the bank details.' : error.message);
    onSaved();
  });
  return (
    <Drawer title={'Bank · ' + c.name} sub={now ? 'Now: ' + now.bank_name + ' · XXXX ' + now.account_no.slice(-4) : 'Not given yet'} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={!b.bank.trim() || !b.ifsc.trim() || b.acc.replace(/\D/g, '').length < 6} word="Save bank details" />}>
      <WField label="Bank"><input className="winp" value={b.bank} onChange={(e) => setB({ ...b, bank: e.target.value })} /></WField>
      <WField label="IFSC"><input className="winp" value={b.ifsc} onChange={(e) => setB({ ...b, ifsc: e.target.value.toUpperCase() })} /></WField>
      <WField label="Account number (typed in full again)"><input className="winp" value={b.acc} inputMode="numeric" onChange={(e) => setB({ ...b, acc: e.target.value })} /></WField>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function PaperForm({ c, row, onClose, onSaved }: { c: Con; row: Doc | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [d, setD] = useState({ kind: row?.kind || 'fssai', number: row?.number || '', from: row?.valid_from || '', to: row?.valid_to || '', why: '' });
  const [file, setFile] = useState<File | null>(null);
  const a = useAct();
  const go = () => a.run(async () => {
    let path: string | null = null;
    if (file) {
      path = s.me!.company_id + '/' + c.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_');
      const r = await supabase!.storage.from('contractor-papers').upload(path, file, { contentType: file.type });
      if (r.error) throw new Error('The file could not be sent.');
    }
    if (row) {
      await save('contractor_documents', { id: row.id, kind: d.kind, number: val(d.number), valid_from: val(d.from), valid_to: val(d.to),
        ...(path ? { file_path: path, state: 'attached', verified_by: null, verified_at: null } : {}) });
      if (d.why.trim()) await call('office_note', { p_entity: 'contractor_documents', p_id: row.id, p_reason: d.why });
    } else {
      await save('contractor_documents', { contractor_id: c.id, kind: d.kind, number: val(d.number), valid_from: val(d.from), valid_to: val(d.to), file_path: path, state: path ? 'attached' : 'asked', asked_at: path ? null : new Date().toISOString() });
    }
    onSaved();
  });
  return (
    <Drawer title={row ? 'Edit · ' + docName(row.kind) : 'Add a paper · ' + c.name} sub={row?.file_path ? 'A new file takes the place of the one there – the old one stays in History' : undefined} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} word={row ? 'Save changes' : file ? 'Add paper' : 'Ask for it'} />}>
      <WField label="Paper"><select className="winp" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{DOC_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select></WField>
      <WField label="Number"><input className="winp" value={d.number} onChange={(e) => setD({ ...d, number: e.target.value })} /></WField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Valid from"><input className="winp" type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></WField>
        <WField label="Valid till"><input className="winp" type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></WField>
      </div>
      <label className="wbtn" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}><Icon name="upload" size={16} />{file ? file.name : row?.file_path ? 'Change file' : 'File'}
        <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
      {!row && !file && <div className="xs">No file now: the paper is asked for – the contractor is told.</div>}
      {row && <WField label="Why (kept in History)"><input className="winp" value={d.why} onChange={(e) => setD({ ...d, why: e.target.value })} placeholder="Optional" /></WField>}
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

// ── w06 · Work orders and rates ──
interface WO extends Dated { id: string; number: string; site_id: string; mess_id: string; contractor_id: string; valid_from: string; valid_to: string; payment_days: number; advance_amount: number; advance_recovery_pct: number; security_deposit: number; retention_pct: number; state: string; removed_reason?: string | null; messes: { name: string } | null; contractors: { name: string } | null }
interface Rate extends Dated { id: string; item_id: string; rate: number; valid_from: string; valid_to: string | null; state: string; asked_by: string | null; reason: string | null; items: { name: string; code: string } }
interface Pen extends Dated { id: string; code: string; what: string; amount: number | null; per: string; valid_from: string; valid_to: string | null }

function WoChip({ w }: { w: WO }) {
  if (w.removed_at) return <span className="chip st red">Removed</span>;
  if (w.state === 'draft') return <span className="chip st amber">Draft</span>;
  if (w.state === 'closed' || w.valid_to < today()) return <span className="chip st">{w.state === 'closed' ? 'Closed' : 'Ended'}</span>;
  return <span className="chip st leaf">Active</span>;
}
const monthEnd = (m: string) => { const e = new Date(m + 'T12:00:00Z'); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0); return e.toISOString().slice(0, 10); };

export function WorkOrders() {
  const s = useSession();
  const wos = useLoad(() => rows<WO>(db().from('work_orders').select('*,messes(name),contractors(name)').order('valid_from', { ascending: false })), []);
  const [sel, setSel] = useState('');
  const [shown, setShown] = useState<Shown>('active');
  const shownWo = (w: WO) => shown === 'all' || (shown === 'active') === (!w.removed_at && w.state !== 'closed' && w.valid_to >= today());
  const view = (wos.data || []).filter(shownWo);
  const w = (wos.data || []).find((x) => x.id === sel) || view[0];
  const rates = useLoad(() => w ? rows<Rate>(db().from('rates').select('*,items(name,code)').eq('work_order_id', w.id).order('valid_from', { ascending: false })) : Promise.resolve([] as Rate[]), [w?.id]);
  const pens = useLoad(() => w ? rows<Pen>(db().from('penalty_rules').select('*').eq('work_order_id', w.id).order('valid_from', { ascending: false })) : Promise.resolve([] as Pen[]), [w?.id]);
  const items = useLoad(() => rows<{ id: string; name: string; code: string; unit: string }>(db().from('items').select('id,name,code,unit').eq('active', true).order('name')), []);
  // (23-11-2026, his word: "work contract madhe BOQ perfect – item wise ani rate, name disawa") the BOQ, item by item
  const boq = useLoad(() => w ? rows<{ id: string; item_id: string; qty: number; note: string | null; items: { name: string; code: string; unit: string } }>(db().from('work_order_boq').select('id,item_id,qty,note,items(name,code,unit)').eq('work_order_id', w.id)) : Promise.resolve([]), [w?.id]);
  const bills = useLoad(() => w ? rows<{ month: string }>(db().from('monthly_bills').select('month').eq('work_order_id', w.id)) : Promise.resolve([] as { month: string }[]), [w?.id]);
  const [edWo, setEdWo] = useState<WO | 'new' | null>(null);
  const [edRate, setEdRate] = useState<Rate | 'new' | null>(null);
  const [edPen, setEdPen] = useState<Pen | 'new' | null>(null);
  const [edBoq, setEdBoq] = useState<{ item: string; qty: string; out: boolean } | null>(null);
  const [hist, setHist] = useState<Hist>(null);
  const [rem, setRem] = useState<Rem>(null);
  const a = useAct();
  const money = s.has(['accounts', 'system_admin']);
  const decide = (id: string, ok: boolean) => a.run(async () => { await call('decide_rate', { p_rate: id, p_approve: ok, p_reason: ok ? null : prompt('Why refuse?') || '' }); rates.reload(); });
  const billed = (r: Rate) => (bills.data || []).some((b) => b.month <= (r.valid_to || '9999-12-31') && monthEnd(b.month) >= r.valid_from);
  const reloadW = () => { wos.reload(); rates.reload(); pens.reload(); boq.reload(); };
  const liveRates = (rates.data || []).filter((r) => !r.removed_at);
  const names: Record<string, string> = Object.fromEntries([...s.sites.map((x) => [x.id, x.code]), ...(items.data || []).map((i) => [i.id, i.name])]);
  return (
    <Web title="Work orders and rates" roles={['system_admin', 'site_admin', 'accounts', 'management']}
      actions={money ? <button className="wbtn pri" onClick={() => setEdWo('new')}><Icon name="plus" size={16} />New work order</button> : undefined}>
      <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Show">
        {([['active', 'Active'], ['removed', 'Ended / removed'], ['all', 'All']] as const).map(([v, label]) => <button key={v} type="button" className={'chip' + (shown === v ? ' on' : '')} aria-pressed={shown === v} onClick={() => setShown(v)}>{label}</button>)}
      </div>
      {wos.loading && !wos.data ? <Loading /> : wos.error ? <Failed error={wos.error} retry={wos.reload} /> : <div className="wcard" style={{ padding: '6px 6px 0' }}>
        <Tbl head={['Number', 'Mess', 'Contractor', 'From – till', 'Payment', 'State', '']} right={[6]} empty="No work order here" hl={(i) => view[i]?.id === w?.id}
          rows={view.map((x) => { const early = x.state === 'draft' || x.valid_from > today();
            return [<button type="button" className="sb" style={{ border: 0, padding: 0, height: 'auto', fontWeight: 700, fontSize: 14 }} onClick={() => setSel(x.id)}>{x.number}</button>,
              x.messes?.name || '–', x.contractors?.name || '–', day(x.valid_from) + ' – ' + day(x.valid_to), x.payment_days + ' days', <WoChip w={x} />,
              <Acts onEdit={money && !x.removed_at && x.state !== 'closed' ? () => setEdWo(x) : undefined} onHistory={() => setHist({ entity: 'work_orders', id: x.id, name: x.number })}
                removeWord={early ? 'Remove' : 'End from a date'}
                onRemove={money && !x.removed_at && x.state !== 'closed' && x.valid_to >= today() ? () => setRem({ kind: 'work_order', id: x.id, name: x.number, sub: (x.messes?.name || '') + ' · ' + (x.contractors?.name || ''), word: early ? 'Remove' : 'End' }) : undefined} />]; })} />
      </div>}
      {w && <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr)' }}>
        <div className="wcard tight"><div className="row" style={{ marginBottom: 10 }}><h3 className="sp" style={{ margin: 0 }}>{w.number} · Terms</h3>{money && !w.removed_at && w.state !== 'closed' && <button type="button" className="sb" onClick={() => setEdWo(w)}><Icon name="pencil" size={14} />Edit</button>}</div>
          {[['Mess', w.messes?.name], ['Valid', day(w.valid_from) + ' – ' + day(w.valid_to)], ['Payment', w.payment_days + ' days after approval'], ['Advance', inr(w.advance_amount) + ' · ' + w.advance_recovery_pct + '% a month back'], ['Security deposit', inr(w.security_deposit)], ['Retention', w.retention_pct + '% of each bill']].map(([k, v]) => <div key={k as string} className="row sm" style={{ padding: '4px 0' }}><span className="sp">{k}</span><b style={{ color: 'var(--ink)' }}>{v as string}</b></div>)}
          <div className="row" style={{ marginTop: 14, marginBottom: 6 }}><h3 className="sp" style={{ margin: 0 }}>Penalties</h3>{money && <button type="button" className="sb" onClick={() => setEdPen('new')}><Icon name="plus" size={14} />New from a date</button>}</div>
          <Tbl head={['What', 'Amount', 'From', 'Till', '']} right={[1, 4]} empty="No penalty"
            rows={(pens.data || []).filter((p) => !p.removed_at).map((p) => { const live = stateOf(p) !== 'ended';
              return [<span><b>{p.what}</b><div className="xs">a {p.per}</div></span>, p.amount != null ? inr(p.amount) : 'bill on hold', day(p.valid_from), p.valid_to ? day(p.valid_to) : '–',
                <Acts onEdit={money && live ? () => setEdPen(p) : undefined} onHistory={() => setHist({ entity: 'penalty_rules', id: p.id, name: p.what })}
                  onRemove={money && live ? () => setRem({ kind: 'penalty', id: p.id, name: p.what, sub: w.number + ' · from ' + day(p.valid_from) }) : undefined} />]; })} />
        </div>
        <div className="wcard"><div className="row wrap" style={{ marginBottom: 12, gap: 10 }}><h3 className="sp" style={{ margin: 0 }}>Rates – each with its date, old ones kept</h3>{money && <button className="wbtn pri" onClick={() => setEdRate('new')}><Icon name="plus" size={16} />New rate from a date</button>}</div>
          <Tbl head={['Item', 'Rate', 'From', 'Till', 'State', '']} right={[1, 5]} hl={(i) => liveRates[i]?.state === 'waiting'}
            rows={liveRates.map((x) => { const live = x.state !== 'refused' && stateOf(x) !== 'ended';
              return [<b>{x.items.name}</b>, inr(x.rate), day(x.valid_from), x.valid_to ? day(x.valid_to) : '–',
                <span className="row" style={{ gap: 6 }}><span className={'chip st ' + (x.state === 'approved' ? 'leaf' : x.state === 'waiting' ? 'amber' : 'red')}>{x.state === 'waiting' ? 'Waiting approval' : x.state === 'approved' ? 'Approved' : 'Refused'}</span>
                  {x.state === 'approved' && billed(x) && <span className="tag"><Icon name="lock" size={14} />in bills</span>}</span>,
                <Acts onEdit={money && live ? () => setEdRate(x) : undefined} onHistory={() => setHist({ entity: 'rates', id: x.id, name: x.items.name + ' rate' })}
                  removeWord={x.state === 'waiting' ? 'Withdraw' : 'Remove'}
                  onRemove={money && live ? () => setRem({ kind: 'rate', id: x.id, name: x.items.name + ' rate ' + inr(x.rate), sub: 'from ' + day(x.valid_from), noDate: x.state === 'waiting', word: x.state === 'waiting' ? 'Withdraw' : 'Remove' }) : undefined}>
                  {x.state === 'waiting' && money && x.asked_by !== s.me?.id && <><button type="button" className="sb ok" onClick={() => decide(x.id, true)}><Icon name="check" size={14} />Approve</button><button type="button" className="sb" onClick={() => decide(x.id, false)}><Icon name="x" size={14} />Refuse</button></>}
                </Acts>]; })} />
          <div className="col xs" style={{ marginTop: 10, gap: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="lock" size={14} /><span className="sp">Approved and already in a bill: Edit gives a new rate from a later date (it waits for Accounts) – the bills made stay as they are.</span></div>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name="pencil" size={14} /><span className="sp">Not in a bill yet, or waiting: Edit corrects it – it waits for Accounts again. Nobody approves the rate he asked.</span></div>
          </div>
        </div>
      </div>}
      {w && (() => {
        // the rate of each line: the approved rate on today – or, outside the work order's dates, on its nearest day
        const ref = today() < w.valid_from ? w.valid_from : today() > w.valid_to ? w.valid_to : today();
        const rateOf = (item: string) => liveRates.find((x) => x.state === 'approved' && x.item_id === item && x.valid_from <= ref && (!x.valid_to || x.valid_to >= ref));
        const lines = (boq.data || []).filter((x) => x.qty > 0).sort((x, y) => x.items.name.localeCompare(y.items.name));
        const total = lines.reduce((t, x) => t + (rateOf(x.item_id) ? x.qty * rateOf(x.item_id)!.rate : 0), 0);
        const missing = lines.filter((x) => !rateOf(x.item_id)).length;
        return <div className="wcard"><div className="row" style={{ marginBottom: 10 }}><h3 className="sp" style={{ margin: 0 }}>BOQ – item by item</h3>{money && <button type="button" className="wbtn" style={{ height: 34 }} onClick={() => setEdBoq({ item: '', qty: '', out: false })}><Icon name="plus" size={14} />Add an item</button>}</div>
          <Tbl head={['Item', 'Unit', 'Quantity', 'Rate', 'Amount', '']} right={[2, 3, 4, 5]} empty="No BOQ yet – add its items"
            rows={[...lines.map((x) => { const r = rateOf(x.item_id); return [<b>{x.items.name}</b>, x.items.unit, x.qty.toLocaleString('en-IN'),
              r ? inr(r.rate) : <span className="chip st amber">no approved rate</span>, r ? inr(x.qty * r.rate) : '–',
              <Acts onEdit={money ? () => setEdBoq({ item: x.item_id, qty: String(x.qty), out: false }) : undefined} onHistory={() => setHist({ entity: 'work_order_boq', id: x.id, name: x.items.name + ' · BOQ' })}
                onRemove={money ? () => setEdBoq({ item: x.item_id, qty: '0', out: true }) : undefined} />]; }),
              ...(lines.length ? [[<b>Total</b>, '', '', '', <b>{inr(total)}</b>, '']] : [])]} />
          <div className="xs" style={{ marginTop: 6 }}>Rates: the approved rate on {day(ref)} (the rates above, with their dates).{missing ? ' ' + missing + ' item(s) have no approved rate – not in the total.' : ''} Every change of the BOQ is in History.</div>
        </div>;
      })()}
      <div className="row xs" style={{ gap: 8 }}><Icon name="shield-check" size={14} /><span className="sp">Work order Edit: terms and dates. An active one is ended from a date, never wiped out; a draft can be removed. Every change is in History.</span></div>
      <ErrorLine error={a.error} />
      {edWo && <WoForm row={edWo === 'new' ? null : edWo} onClose={() => setEdWo(null)} onSaved={() => { setEdWo(null); reloadW(); }} />}
      {edRate && w && <RateForm wo={w} row={edRate === 'new' ? null : edRate} items={items.data || []} billed={edRate !== 'new' && billed(edRate)} onClose={() => setEdRate(null)} onSaved={() => { setEdRate(null); rates.reload(); }} />}
      {edPen && w && <PenaltyForm wo={w} row={edPen === 'new' ? null : edPen} onClose={() => setEdPen(null)} onSaved={() => { setEdPen(null); pens.reload(); }} />}
      {edBoq && w && <BoqForm wo={w} start={edBoq} items={items.data || []} onClose={() => setEdBoq(null)} onSaved={() => { setEdBoq(null); boq.reload(); }} />}
      {hist && <HistoryBox {...hist} names={names} onClose={() => setHist(null)} />}
      {rem && <RemoveBox {...rem} onClose={() => setRem(null)} onDone={() => { setRem(null); reloadW(); }} />}
    </Web>
  );
}

function WoForm({ row, onClose, onSaved }: { row: WO | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const messes = useLoad(() => rows<Mess>(db().from('messes').select('id,name,site_id,contractor_id,' + DATED).order('name')), []);
  const [f, setF] = useState({ number: row?.number || '', mess: row?.mess_id || '', from: row?.valid_from || '', to: row?.valid_to || '', days: String(row?.payment_days ?? 30), adv: String(row?.advance_amount ?? 0),
    advp: String(row?.advance_recovery_pct ?? 0), sd: String(row?.security_deposit ?? 0), ret: String(row?.retention_pct ?? 5), state: row?.state || 'active', why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const n = (x: string, what: string) => { const v = Number(x.replace(/,/g, '')); if (!Number.isFinite(v) || v < 0) throw new Error(what + ': a number, 0 or more.'); return v; };
    const terms = { number: f.number.trim(), valid_from: f.from, valid_to: f.to, payment_days: n(f.days, 'Payment days'), advance_amount: n(f.adv, 'Advance'), advance_recovery_pct: n(f.advp, 'Advance back %'),
      security_deposit: n(f.sd, 'Security deposit'), retention_pct: n(f.ret, 'Retention %'), state: f.state };
    if (row) {
      await save('work_orders', { id: row.id, ...terms });
      if (f.why.trim()) await call('office_note', { p_entity: 'work_orders', p_id: row.id, p_reason: f.why });
    } else {
      const m = (messes.data || []).find((x) => x.id === f.mess);
      if (!m || !m.contractor_id) throw new Error('Choose a mess that has its contractor.');
      await save('work_orders', { company_id: s.me!.company_id, site_id: m.site_id, mess_id: m.id, contractor_id: m.contractor_id, created_by: s.me!.id, ...terms });
    }
    onSaved();
  });
  const t = (k: 'number' | 'days' | 'adv' | 'advp' | 'sd' | 'ret' | 'why', label: string, mode: 'numeric' | 'text' = 'numeric') =>
    <WField label={label}><input className="winp" value={f[k]} inputMode={mode} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></WField>;
  return (
    <Drawer title={row ? 'Edit · ' + row.number : 'New work order'} onClose={onClose} foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={!f.number.trim() || (!row && !f.mess) || !f.from || !f.to} word={row ? 'Save changes' : 'Add work order'} />}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {t('number', 'Number', 'text')}
        <WField label="State"><select className="winp" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option></select></WField>
      </div>
      {!row && <WField label="Mess"><select className="winp" value={f.mess} onChange={(e) => setF({ ...f, mess: e.target.value })}><option value="">Choose</option>{(messes.data || []).filter((m) => m.contractor_id && inUse(m)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></WField>}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="From"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
        <WField label="Till"><input className="winp" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></WField>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>{t('days', 'Payment days')}{t('ret', 'Retention %')}</div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>{t('adv', 'Advance ₹')}{t('advp', 'Advance back % a month')}</div>
      {t('sd', 'Security deposit ₹')}
      {row && t('why', 'Why (kept in History)', 'text')}
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function RateForm({ wo, row, items, billed, onClose, onSaved }: { wo: WO; row: Rate | null; items: { id: string; name: string }[]; billed: boolean; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ item: row?.item_id || '', rate: row ? String(row.rate) : '', from: row ? (row.state === 'approved' && billed ? today(1) : row.valid_from) : today(1), why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const v = Number(f.rate.replace(/,/g, ''));
    if (!Number.isFinite(v) || v < 0) throw new Error('The rate is a number, 0 or more.');
    if (row) await call('office_rate_edit', { p_rate: row.id, p_value: v, p_from: f.from || null, p_reason: f.why.trim() || null });
    else await save('rates', { work_order_id: wo.id, item_id: f.item, rate: v, valid_from: f.from, asked_by: s.me!.id });
    onSaved();
  });
  const say = !row ? 'A new rate waits for Accounts; approving it ends the rate before it on the day before.'
    : row.state === 'waiting' ? 'It is waiting: the change corrects it.'
      : billed ? 'This rate is in a bill: the change is a NEW rate from the date you give (after the bills made) – it waits for Accounts.'
        : 'Not in a bill yet: the change corrects it and it waits for Accounts again.';
  return (
    <Drawer title={row ? 'Edit · ' + row.items.name + ' rate' : 'New rate from a date · ' + wo.number} sub={row ? inr(row.rate) + ' from ' + day(row.valid_from) : undefined} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={!f.rate || (!row && !f.item) || !f.from} word={row ? 'Save' : 'Ask the rate'} />}>
      {!row && <WField label="Item"><select className="winp" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">Choose</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></WField>}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Rate ₹"><input className="winp" value={f.rate} inputMode="decimal" onChange={(e) => setF({ ...f, rate: e.target.value })} /></WField>
        <WField label="From"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>
      </div>
      <div className="row sm" style={{ gap: 8, alignItems: 'flex-start' }}><Icon name={row && row.state === 'approved' && billed ? 'lock' : 'info'} size={16} /><span className="sp">{say}</span></div>
      {row && <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional" /></WField>}
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function PenaltyForm({ wo, row, onClose, onSaved }: { wo: WO; row: Pen | null; onClose: () => void; onSaved: () => void }) {
  const coming = !!row && row.valid_from > today();
  const [f, setF] = useState({ code: row?.code || 'late_van', what: row?.what || 'Van more than 30 min late', amount: row?.amount != null ? String(row.amount) : '', per: row?.per || 'batch',
    from: row ? (coming ? row.valid_from : today()) : wo.valid_from > today() ? wo.valid_from : today(), how: coming ? 'correct' : 'date', why: '' });
  const a = useAct();
  const go = () => a.run(async () => {
    const amt = f.amount.trim() === '' ? null : Number(f.amount.replace(/,/g, ''));
    if (amt != null && (!Number.isFinite(amt) || amt < 0)) throw new Error('The amount is a number, 0 or more – or empty for "bill on hold".');
    await call('office_penalty', { p_work_order: wo.id, p_rule: row?.id || null, p_from: row && f.how === 'correct' ? null : f.from, p_code: f.code, p_what: f.what, p_amount: amt, p_per: f.per, p_reason: f.why.trim() || null });
    onSaved();
  });
  return (
    <Drawer title={row ? 'Edit · ' + row.what : 'New penalty from a date · ' + wo.number} sub={row ? (coming ? 'Coming – from ' : 'In use since ') + day(row.valid_from) : undefined} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} disabled={f.what.trim().length < 3 || (!row && !f.code.trim())} word="Save" />}>
      {!row && <WField label="Code"><input className="winp" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} placeholder="late_van" /></WField>}
      <WField label="What"><input className="winp" value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} /></WField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <WField label="Amount ₹ (empty = bill on hold)"><input className="winp" value={f.amount} inputMode="decimal" onChange={(e) => setF({ ...f, amount: e.target.value })} /></WField>
        <WField label="Per"><select className="winp" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value })}>{['batch', 'case', 'day', 'month'].map((p) => <option key={p} value={p}>a {p}</option>)}</select></WField>
      </div>
      {row ? <>
        <b style={{ fontSize: 14 }}>Which days?</b>
        <label className={'opt' + (f.how === 'date' ? ' on' : '')}><input type="radio" name="phow" checked={f.how === 'date'} onChange={() => setF({ ...f, how: 'date' })} style={{ marginTop: 3 }} />
          <span className="col sp" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>From a date</b><input className="winp" type="date" min={today()} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, how: 'date' })} aria-label="From" />
            <span className="xs">The days before it keep the penalty as it was.</span></span></label>
        <label className={'opt' + (f.how === 'correct' ? ' on' : '')}><input type="radio" name="phow" checked={f.how === 'correct'} onChange={() => setF({ ...f, how: 'correct' })} style={{ marginTop: 3 }} />
          <span className="col sp" style={{ gap: 4 }}><b style={{ fontSize: 14 }}>Correct it from its start ({day(row.valid_from)})</b><span className="xs">Only for a typing mistake. Bills made stay as they are.</span></span></label>
      </> : <WField label="From"><input className="winp" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></WField>}
      {row && <WField label="Why (kept in History)"><input className="winp" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Optional" /></WField>}
      <ErrorLine error={a.error} />
    </Drawer>
  );
}

function BoqForm({ wo, start, items, onClose, onSaved }: { wo: WO; start: { item: string; qty: string; out: boolean }; items: { id: string; name: string; unit: string }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...start, note: '' });
  const a = useAct();
  const name = items.find((x) => x.id === f.item)?.name || '';
  const go = () => a.run(async () => {
    const n = Number(f.qty.replace(/,/g, ''));
    if (!f.item || !Number.isFinite(n) || n < 0) throw new Error('Choose the item and type its quantity (0 or more).');
    if (start.out && f.note.trim().length < 3) throw new Error('Write why it is taken out.');
    await call('office_boq_set', { p_work_order: wo.id, p_item: f.item, p_qty: start.out ? 0 : n, p_note: f.note.trim() || null });
    onSaved();
  });
  return (
    <Drawer title={start.out ? 'Take out of the BOQ · ' + name : start.item ? 'Edit · ' + name + ' · BOQ' : 'Add to the BOQ · ' + wo.number} onClose={onClose}
      foot={<SaveFoot onCancel={onClose} onSave={go} busy={a.busy} word={start.out ? 'Take it out' : 'Save'} disabled={!f.item} />}>
      {!start.item && <WField label="Item"><select className="winp" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">Choose</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></WField>}
      {!start.out && <WField label="Quantity"><input className="winp" value={f.qty} inputMode="decimal" onChange={(e) => setF({ ...f, qty: e.target.value })} /></WField>}
      {start.out && <div className="sm">Its quantity becomes 0: it leaves the BOQ and stays in History.</div>}
      <WField label={start.out ? 'Reason (must be given)' : 'Note (kept in History)'}><input className="winp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={start.out ? 'e.g. not in the contract' : 'Optional'} /></WField>
      <ErrorLine error={a.error} />
    </Drawer>
  );
}
