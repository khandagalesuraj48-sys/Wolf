// Boards r01–r08 (first time: who are you, RCL ID, found in HR, the WhatsApp code, done / not found / new registration /
// temporary), the guest's first registration (built on r07's form), signing in again with the mobile, and "where you stand".
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, call, db, one, useAct, useLoad } from '../lib/db';
import { useSession } from '../lib/session';
import { firstName, initials, maskMobile, time, day } from '../lib/fmt';
import { Icon } from '../ui/Icon';
import { Body, Btn, CodeBoxes, ErrorLine, Field, Foot, Input, Loading, Screen, Steps, Top, Failed } from '../ui/kit';

export const COMPANY = (import.meta.env.VITE_FALCON_COMPANY_CODE as string | undefined)?.trim().toUpperCase() || 'RCL';

// What the steps carry from one board to the next (kept for this visit only).
interface Flow {
  mode?: 'rcl' | 'new' | 'guest' | 'back';
  rcl?: string; token?: string; result?: string;
  hr?: { name?: string; designation?: string; department?: string; category?: string; site?: string; mobile_masked?: string };
  phone?: string; form?: Record<string, string>; site?: string; section?: string; photo?: Blob | null; sentTo?: string;
}
let flowMem: Flow = {};
const flow = (): Flow => { try { return { ...JSON.parse(sessionStorage.getItem('falcon.flow') || '{}'), photo: flowMem.photo }; } catch { return flowMem; } };
const setFlow = (f: Flow) => { flowMem = { ...flow(), ...f }; try { const { photo: _p, ...rest } = flowMem; sessionStorage.setItem('falcon.flow', JSON.stringify(rest)); } catch { /* memory only */ } };

const phoneE164 = (ten: string) => '+91' + ten.replace(/\D/g, '').slice(-10);
const tenOk = (ten: string) => /^[6-9]\d{9}$/.test(ten.replace(/\D/g, '').slice(-10));

interface Places { company: string; name: string; sites: { id: string; code: string; name: string; sections: { id: string; code: string; name: string; circle: string }[] }[] }
function usePlaces() {
  return useLoad<Places | null>(() => call<Places | null>('start_places', { p_company: COMPANY }), []);
}

// ── r01 · First time – who are you? ──
export function Who() {
  return (
    <Screen>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '40px 24px 34px', borderRadius: '0 0 32px 32px' }}>
        <img src="/brand/logo-96.png" width={64} height={64} alt="FALCON" style={{ display: 'block' }} />
        <p style={{ margin: '18px 0 0', fontSize: 30, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1.1 }}>Welcome to<br />FALCON</p>
        <p style={{ margin: '10px 0 0', fontSize: 15, color: '#C9D2E0' }}>Food &amp; Site Operations</p>
      </div>
      <Body style={{ gap: 14, paddingTop: 22 }}>
        <b className="h2" style={{ fontSize: 19 }}>First time here – who are you?</b>
        <Link className="card lift" to="/start/rcl-id" style={{ display: 'flex', gap: 14, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: '18px 16px' }}>
          <div className="tile leaf s56"><Icon name="hard-hat" size={28} /></div>
          <div className="sp"><b style={{ fontSize: 18 }}>I work for RCL</b><div className="sm">Staff, operator, driver, labour – with or without an RCL ID</div></div>
          <Icon name="chevron-right" />
        </Link>
        <Link className="card lift" to="/guest/new" style={{ display: 'flex', gap: 14, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: '18px 16px' }}>
          <div className="tile plum s56"><Icon name="user-plus" size={28} /></div>
          <div className="sp"><b style={{ fontSize: 18 }}>I am a guest or visitor</b><div className="sm">Client, officer, subcontractor, vendor, visitor</div></div>
          <Icon name="chevron-right" />
        </Link>
        <div className="row sm" style={{ gap: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' }}>
          <Icon name="shield-check" size={18} /><span className="sp">Asked once. After this the app knows you – your mobile is checked by a WhatsApp code.</span>
        </div>
        <span className="sp" />
        <Link className="xs" to="/start/back" style={{ textAlign: 'center', margin: '0 0 26px', color: 'var(--muted)' }}>Been here before? Your mobile number brings you back.</Link>
      </Body>
    </Screen>
  );
}

// ── r02 · Your RCL ID ──
export function RclId() {
  const nav = useNavigate();
  const [id, setId] = useState(flow().rcl || '');
  const a = useAct();
  const find = () => a.run(async () => {
    const rcl = id.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,20}$/.test(rcl)) throw new Error('Type the ID as on your card – letters, numbers and "-".');
    const r = await api<{ result: string; token?: string; name?: string; designation?: string; department?: string; category?: string; site?: string; mobile_masked?: string }>('/api/start', { rcl_id: rcl }, false);
    setFlow({ mode: 'rcl', rcl, result: r.result, token: r.token, hr: r });
    nav(r.result === 'found' ? '/start/found' : '/start/not-found');
  });
  return (
    <Screen>
      <Top back="/start" title="Your RCL ID" sub="Step 1 of 3 · RCL employee" />
      <Body style={{ gap: 16, paddingTop: 10 }}>
        <Steps n={1} of={3} />
        <p className="h1" style={{ fontSize: 26 }}>Enter your employee ID</p>
        <p className="sm" style={{ margin: '-8px 0 0' }}>It is on your ID card and salary slip.</p>
        <Input big icon="id-card" value={id} onChange={(v) => setId(v.toUpperCase())} placeholder="VTR-0000" maxLength={20} autoFocus ariaLabel="RCL ID" />
        <div className="row xs" style={{ gap: 6 }}><Icon name="info" size={14} /><span className="sp">Looked up in the RCL HR employee list – nothing else is asked if it is there.</span></div>
        <ErrorLine error={a.error} />
        <Btn kind="leaf" onClick={find} busy={a.busy} disabled={!id.trim()}><Icon name="search" />Find me</Btn>
        <Link className="card" to="/start/new" onClick={() => setFlow({ mode: 'new', rcl: id.trim().toUpperCase() || undefined })} style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: 14 }}>
          <div className="tile s40 cream"><Icon name="user-plus" /></div>
          <div className="sp"><b style={{ fontSize: 15 }}>No RCL ID yet?</b><div className="xs">New joiner or HR has not added you – register here</div></div>
          <Icon name="chevron-right" size={18} />
        </Link>
      </Body>
    </Screen>
  );
}

// ── r03 · Is this you? (from RCL HR) ──
export function Found() {
  const nav = useNavigate();
  const f = flow();
  const places = usePlaces();
  const site = useMemo(() => places.data?.sites.find((s) => s.code === (f.hr?.site || '').toUpperCase() || s.name === f.hr?.site) || null, [places.data, f.hr?.site]);
  const [section, setSection] = useState(f.section || '');
  const a = useAct();
  if (!f.token || !f.hr) return <Gone />;
  const send = () => a.run(async () => {
    const r = await api<{ sent_to: string }>('/api/start', { token: f.token, send: true }, false);
    setFlow({ site: site?.id, section: section || undefined, sentTo: r.sent_to });
    nav('/start/code');
  });
  const Row = ({ k, v, last }: { k: string; v?: string; last?: boolean }) => (
    <div className="row" style={{ padding: '10px 0', borderBottom: last ? 0 : '1px solid var(--line)' }}><span className="sm sp">{k}</span><b style={{ fontSize: 14 }}>{v || '–'}</b><Icon name="lock" size={14} /></div>
  );
  return (
    <Screen>
      <Top back="/start/rcl-id" title="Is this you?" sub="Step 2 of 3 · from RCL HR" />
      <Body style={{ gap: 12 }}>
        <Steps n={2} of={3} />
        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div className="av lg">{initials(f.hr.name)}</div>
          <div className="sp"><b style={{ fontSize: 19 }}>{f.hr.name}</b><div className="sm">RCL ID {f.rcl}</div></div>
          <span className="chip leaf" style={{ height: 26 }}><Icon name="badge-check" size={14} />Found</span>
        </div>
        <div className="card" style={{ padding: '4px 16px' }}>
          <Row k="Designation" v={f.hr.designation} />
          <Row k="Department" v={f.hr.department} />
          <Row k="Category" v={f.hr.category} />
          <Row k="Site" v={site ? site.code + ' · ' + site.name : f.hr.site} />
          <div className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <span className="sm sp">Circle · section</span>
            {site && site.sections.length ? (
              <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Circle and section" style={{ border: 0, background: 'transparent', font: 'inherit', fontSize: 14, fontWeight: 600, color: 'var(--leafD)' }}>
                <option value="">Pick</option>
                {site.sections.map((x) => <option key={x.id} value={x.id}>{x.circle} · {x.code}</option>)}
              </select>
            ) : <span className="chip amber" style={{ height: 26 }}>Not in HR</span>}
          </div>
          <Row k="WhatsApp" v={f.hr.mobile_masked} last />
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Locked details come from HR. Your pick of circle is checked by the Site Admin.</span></div>
        <div className="row sm" style={{ gap: 8, color: 'var(--muted)' }}><Icon name="message-circle" size={16} /><span className="sp">Something wrong? Tell HR – they correct it</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn style={{ background: '#128C4A' }} onClick={send} busy={a.busy}><Icon name="message-circle" />Yes – send code on WhatsApp</Btn></Foot>
    </Screen>
  );
}

// ── r04 · Enter the code ──
export function Code() {
  const nav = useNavigate();
  const s = useSession();
  const f = flow();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(60);
  const a = useAct();
  useEffect(() => { const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000); return () => clearInterval(t); }, []);
  const verify = (c: string) => a.run(async () => {
    if (!supabase) throw new Error('FALCON is not connected yet.');
    if (f.mode === 'rcl') {
      const r = await api<{ session: { access_token: string; refresh_token: string } }>('/api/start', { token: f.token, code: c }, false);
      const { error } = await supabase.auth.setSession(r.session);
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.verifyOtp({ phone: f.phone!, token: c, type: 'sms' });
      if (error) throw new Error('This code is not right or has expired.');
    }
    const { data } = await supabase.auth.getSession();
    const uid = data.session!.user.id;
    // who is this? – already in FALCON, made by the office, an active HR employee (by his mobile), or the first System Admin
    const w = await api<{ person: string | null }>('/api/welcome', {}).catch(() => ({ person: null }));
    if (w.person) { await s.refresh(); nav('/'); return; }
    if (f.mode === 'back') {
      await supabase.auth.signOut();
      throw new Error('This mobile is not in FALCON or in HR yet – go back and register.');
    }
    const exists = await one(db().from('people').select('id').eq('auth_user_id', uid).limit(1));
    if (!exists) {
      let photo: string | undefined;
      if (f.photo) {
        const places = await call<Places | null>('start_places', { p_company: COMPANY });
        const path = places!.company + '/' + uid + '/photo-' + Date.now() + '.jpg';
        const up = await supabase.storage.from('registration-photos').upload(path, f.photo, { contentType: f.photo.type || 'image/jpeg' });
        if (!up.error) photo = path;
      }
      const form = f.form || {};
      await api('/api/register', f.mode === 'guest'
        ? { kind: 'guest', full_name: form.name, organisation: form.organisation, designation: form.designation }
        : { kind: 'employee', full_name: f.mode === 'rcl' ? f.hr?.name : form.name, rcl_id: f.rcl, site: f.site, section: f.section,
            category: form.category, work_role: form.work_role, works_with: form.works_with, photo });
    }
    await s.refresh();
    nav(f.mode === 'guest' ? '/guest/welcome' : '/start/done');
  });
  const again = () => a.run(async () => {
    if (f.mode === 'rcl') await api('/api/start', { token: f.token, send: true }, false);
    else { const { error } = await supabase!.auth.signInWithOtp({ phone: f.phone! }); if (error) throw new Error('Wait a minute before asking a new code.'); }
    setWait(60);
  });
  const sentTo = f.mode === 'rcl' ? f.sentTo : maskMobile(f.phone);
  return (
    <Screen>
      <Top back={true} title="Enter the code" sub={f.mode === 'rcl' ? 'Step 3 of 3 · WhatsApp' : 'WhatsApp'} />
      <Body style={{ gap: 16, paddingTop: 6 }}>
        {f.mode === 'rcl' && <Steps n={3} of={3} last="#128C4A" />}
        <div className="row" style={{ gap: 12, background: '#F1F9F4', borderRadius: 16, padding: '12px 14px' }}>
          <span className="tile s40" style={{ background: '#128C4A', color: '#fff' }}><Icon name="message-circle" /></span>
          <div className="sp"><b style={{ fontSize: 15 }}>Sent to {sentTo}</b><div className="xs">From Sketchline Industries on WhatsApp</div></div>
        </div>
        <CodeBoxes value={code} onChange={(v) => { setCode(v); if (v.length === 6) void verify(v); }} />
        <div className="row sm"><span className="sp">{a.busy ? 'Checking…' : 'Checked as soon as the 6th digit is in'}</span>
          {wait > 0 ? <span>Send again 0:{String(wait).padStart(2, '0')}</span> : <button className="chip" onClick={again}>Send again</button>}</div>
        <ErrorLine error={a.error} />
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14 }}>
          <Icon name="info" size={18} />
          <div className="sp sm" style={{ lineHeight: 1.45 }}>The code proves the phone is yours. That you work for RCL is proved by HR's record – both are kept apart.</div>
        </div>
        <div className="row sm" style={{ gap: 8, color: 'var(--muted)' }}><Icon name="phone" size={16} /><span className="sp">Not your number any more? HR changes it</span></div>
      </Body>
    </Screen>
  );
}

// ── r05 · Registered – verified employee (or where it waits) ──
export function Done() {
  const s = useSession();
  const reg = useLoad(() => one<{ code: string; section_id: string | null }>(db().from('registrations').select('code,section_id').order('created_at', { ascending: false }).limit(1)), [s.me?.id]);
  if (s.status !== 'ready' && s.status !== 'stopped') return <Screen><Body><Loading /></Body></Screen>;
  if (s.me && s.me.state !== 'verified' && s.me.state !== 'linked' && s.me.state !== 'id_assigned') return <Waiting />;
  const sec = s.me?.home_section_id;
  return (
    <Screen>
      <Body style={{ gap: 16, paddingTop: 70, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 132, height: 132, borderRadius: '50%', background: 'var(--leafS)', display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--leaf)', color: '#fff', display: 'grid', placeItems: 'center' }}><i className="i i-check" style={{ width: 52, height: 52 }} /></div>
        </div>
        <div><p className="h1">You're in, {firstName(s.me?.full_name)}</p><p className="sm" style={{ margin: '8px 0 0' }}>FALCON knows you from now on – no sign-up again.</p></div>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}>
          <span className="chip leaf"><Icon name="message-circle" size={14} />WhatsApp verified</span>
          <span className="chip leaf"><Icon name="badge-check" size={14} />Verified employee</span>
          {s.me?.rcl_id && <span className="chip">Linked to HR · {s.me.rcl_id}</span>}
        </div>
        <div className="card" style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b style={{ fontSize: 15 }}>You can now</b>
          <div className="row sm"><Icon name="utensils" size={16} /><span className="sp">Take meals at your site's mess</span></div>
          <div className="row sm"><Icon name="package" size={16} /><span className="sp">Ask for parcels to your section</span></div>
          {!sec && reg.data && <div className="row sm"><Icon name="clock-alert" size={16} /><span className="sp">Your circle and section wait for the Site Admin's OK</span></div>}
        </div>
        <span className="sp" />
        <Btn kind="leaf" to="/" style={{ marginBottom: 26 }}>Open FALCON</Btn>
      </Body>
    </Screen>
  );
}

// ── r06 · Employee record not found ──
export function NotFound() {
  const f = flow();
  const notChecked = f.result === 'not_checked' || f.result === 'no_mobile';
  return (
    <Screen>
      <Top back="/start/rcl-id" title={notChecked ? 'HR could not be checked' : 'Not found in HR'} sub={'RCL ID ' + (f.rcl || '')} />
      <Body style={{ gap: 16, paddingTop: 20 }}>
        <div className="tile s56" style={{ background: 'var(--amberS)', color: 'var(--amber)' }}><Icon name="search" size={28} /></div>
        <p className="h1" style={{ fontSize: 25 }}>{notChecked ? 'HR could not check ' + (f.rcl || 'the ID') + ' now' : 'We could not find ' + (f.rcl || 'this ID')}</p>
        <p className="sm" style={{ margin: '-6px 0 0', lineHeight: 1.5 }}>{notChecked
          ? (f.result === 'no_mobile' ? 'HR has no WhatsApp number for you. Register here – the Site Admin checks you.' : 'HR is not connected to FALCON yet, or did not answer. Register here – the Site Admin checks you.')
          : 'This happens when you joined recently, HR has not added you yet, or the ID is typed wrong.'}</p>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row sm"><Icon name="check" size={16} /><span className="sp">You can still register and eat today</span></div>
          <div className="row sm"><Icon name="check" size={16} /><span className="sp">The Site Admin and HR are told about you</span></div>
          <div className="row sm"><Icon name="check" size={16} /><span className="sp">When HR adds you, all your meals move to your record</span></div>
          <div className="row sm"><Icon name="x" size={16} /><span className="sp">No RCL ID is made up for you</span></div>
        </div>
        <span className="sp" />
        <Btn kind="ghost" to="/start/rcl-id"><Icon name="pencil" />Check the ID again</Btn>
        <Btn kind="leaf" to="/start/new" style={{ marginBottom: 26 }}>Continue with new registration<Icon name="arrow-right" /></Btn>
      </Body>
    </Screen>
  );
}

const CATS = [['staff', 'Staff'], ['operator', 'Operator'], ['driver', 'Driver'], ['labour', 'Labour']] as const;

// ── r07 · New registration ──
export function NewReg() {
  const nav = useNavigate();
  const f = flow();
  const places = usePlaces();
  const [form, setForm] = useState<Record<string, string>>({ name: '', mobile: '', work_role: '', rcl: f.rcl || '', category: 'labour', works_with: '', ...(f.form || {}) });
  const [site, setSite] = useState(f.site || '');
  const [section, setSection] = useState(f.section || '');
  const [photo, setPhoto] = useState<Blob | null>(f.photo || null);
  const a = useAct();
  const set = (k: string) => (v: string) => setForm((x) => ({ ...x, [k]: v }));
  const st = places.data?.sites.find((x) => x.id === site);
  const send = () => a.run(async () => {
    if (form.name!.trim().length < 2) throw new Error('Write your full name.');
    if (!tenOk(form.mobile!)) throw new Error('Type your 10-digit WhatsApp mobile.');
    if (!site) throw new Error('Choose your site.');
    const phone = phoneE164(form.mobile!);
    const { error } = await supabase!.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.status === 429 ? 'Wait a minute before asking a new code.' : 'The code could not be sent – check the number.');
    setFlow({ mode: 'new', phone, form, rcl: form.rcl?.trim().toUpperCase() || undefined, site, section: section || undefined, photo });
    nav('/start/code');
  });
  return (
    <Screen>
      <Top back={true} title="New registration" sub={'For people not yet in HR' + (st ? ' · ' + st.code : '')} />
      <Body style={{ gap: 11 }}>
        {places.error && <Failed error={places.error} retry={places.reload} />}
        <Field label="Full name"><Input value={form.name!} onChange={set('name')} placeholder="As on your ID" /></Field>
        <Field label="WhatsApp mobile"><Input value={form.mobile!} onChange={set('mobile')} placeholder="10 digits" inputMode="tel" maxLength={14} icon="phone" /></Field>
        <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}><Field label="Work role"><Input value={form.work_role!} onChange={set('work_role')} placeholder="e.g. Welder" /></Field></div>
          <div style={{ flex: 1 }}><Field label="RCL ID, if given"><Input value={form.rcl!} onChange={(v) => set('rcl')(v.toUpperCase())} placeholder="optional" /></Field></div>
        </div>
        <div className="col" style={{ gap: 6 }}><span className="lbl">Category</span>
          <div className="row wrap" style={{ gap: 6 }}>{CATS.map(([v, l]) => <button key={v} className={'chip' + (form.category === v ? ' on' : '')} onClick={() => set('category')(v)}>{l}</button>)}</div></div>
        <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}><Field label="Site"><select className="inp" value={site} onChange={(e) => { setSite(e.target.value); setSection(''); }} style={{ height: 46, font: 'inherit' }}><option value="">Choose</option>{places.data?.sites.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></Field></div>
          <div style={{ flex: 1 }}><Field label="Circle · section"><select className="inp" value={section} onChange={(e) => setSection(e.target.value)} style={{ height: 46, font: 'inherit' }}><option value="">Choose</option>{st?.sections.map((x) => <option key={x.id} value={x.id}>{x.circle} · {x.code}</option>)}</select></Field></div>
        </div>
        <Field label="Contractor / subcontractor (if not on RCL's roll)"><Input value={form.works_with!} onChange={set('works_with')} placeholder="optional" /></Field>
        <label className="row" style={{ gap: 12, alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, border: '1.5px dashed var(--line2)', display: 'grid', placeItems: 'center', color: 'var(--muted)', overflow: 'hidden' }}>
            {photo ? <img alt="Your photo" src={URL.createObjectURL(photo)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="camera" />}
          </div>
          <div className="sp"><b style={{ fontSize: 14 }}>Your photo</b><div className="xs">Asked by the site's rule</div></div>
          <input type="file" accept="image/*" capture="user" onChange={(e) => setPhoto(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        </label>
        <ErrorLine error={a.error} />
      </Body>
      <Foot>
        <div className="row xs" style={{ gap: 6 }}><Icon name="shield-check" size={14} /><span className="sp">A WhatsApp code checks your mobile. HR checks the rest.</span></div>
        <Btn style={{ background: '#128C4A' }} onClick={send} busy={a.busy}><Icon name="message-circle" />Send code and register</Btn>
      </Foot>
    </Screen>
  );
}

// ── r08 · Temporary – waiting for the check ──
export function Waiting() {
  const s = useSession();
  const reg = useLoad(() => one<{ code: string; typed_rcl_id: string | null; hr_result: string; info_asked: string | null; info_answer: string | null; id: string; created_at: string }>(
    db().from('registrations').select('id,code,typed_rcl_id,hr_result,info_asked,info_answer,created_at').order('created_at', { ascending: false }).limit(1)), [s.me?.id], ['registrations']);
  const [answer, setAnswer] = useState('');
  const a = useAct();
  const me = s.me;
  if (!me) return <Screen><Body><Loading /></Body></Screen>;
  const temp = me.state === 'temporary';
  const r = reg.data;
  return (
    <Screen>
      <Top left={<div className="av sf">{initials(me.full_name)}</div>} title={me.full_name} sub={(r?.code || 'Registration') + (temp ? ' · temporary' : ' · waiting')} />
      <Body style={{ gap: 12 }}>
        <div className="card" style={{ background: 'var(--amberS)', borderColor: '#EFD7A6', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Icon name="clock-alert" size={24} />
          <div className="sp"><b style={{ fontSize: 15 }}>Waiting for the Site Admin</b>
            <div className="xs" style={{ color: '#6B4A0A' }}>{temp ? 'Limited use till ' + day(me.temporary_until) : 'Nothing can be ordered until he checks you'}</div></div>
        </div>
        <div className="card" style={{ padding: '16px 14px 2px' }}>
          <div className="tl">
            <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>WhatsApp verified</b><small>{r ? day(r.created_at) + ' ' + time(r.created_at) : ''} · {maskMobile(me.mobile)}</small></div></div>
            <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>{r?.hr_result === 'not_found' ? 'Not found in HR – new registration' : 'New registration'}</b><small>{r?.typed_rcl_id ? r.typed_rcl_id + ' typed · ' : ''}Site Admin and HR told</small></div></div>
            <div className="st now"><span className="k"><Icon name="user-check" size={14} /></span><div><b>Site Admin checks you</b><small>Is he working here? Which section?</small></div></div>
            <div className="st"><span className="k" /><div><b style={{ color: 'var(--muted)' }}>HR adds you or links you</b><small>Your meals here move to that record</small></div></div>
          </div>
        </div>
        {r?.info_asked && !r.info_answer && (
          <div className="card col" style={{ gap: 8 }}>
            <b style={{ fontSize: 14 }}>The Site Admin asks: {r.info_asked}</b>
            <Input value={answer} onChange={setAnswer} placeholder="Your answer" />
            <ErrorLine error={a.error} />
            <Btn kind="sm leaf" busy={a.busy} onClick={() => a.run(async () => { await call('answer_registration', { p_reg: r.id, p_answer: answer }); reg.reload(); })}>Send</Btn>
          </div>
        )}
        <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
          <div className="card" style={{ flex: 1, padding: 12 }}><b style={{ fontSize: 14, color: 'var(--leafD)' }}>You can</b><div className="xs" style={{ marginTop: 6, lineHeight: 1.6 }}>{temp ? 'Meals at your own site\'s mess, for yourself' : 'Wait for the check'}</div></div>
          <div className="card" style={{ flex: 1, padding: 12 }}><b style={{ fontSize: 14, color: '#9B1C1C' }}>Not yet</b><div className="xs" style={{ marginTop: 6, lineHeight: 1.6 }}>Parcels, delivery, group or guest requests, other sites</div></div>
        </div>
        <span className="sp" />
        {temp ? <Btn kind="leaf" to="/app" style={{ marginBottom: 26 }}>Open FALCON</Btn>
          : <Btn kind="ghost" onClick={() => void s.refresh()} style={{ marginBottom: 26 }}><Icon name="refresh-cw" />Check again</Btn>}
      </Body>
    </Screen>
  );
}

// ── a guest's first time (r07's form for a guest) ──
export function GuestNew() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', mobile: '', organisation: '', designation: '' });
  const a = useAct();
  const set = (k: keyof typeof form) => (v: string) => setForm((x) => ({ ...x, [k]: v }));
  const send = () => a.run(async () => {
    if (form.name.trim().length < 2) throw new Error('Write your full name.');
    if (!tenOk(form.mobile)) throw new Error('Type your 10-digit WhatsApp mobile.');
    const phone = phoneE164(form.mobile);
    const { error } = await supabase!.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.status === 429 ? 'Wait a minute before asking a new code.' : 'The code could not be sent – check the number.');
    setFlow({ mode: 'guest', phone, form });
    nav('/start/code');
  });
  return (
    <Screen>
      <Top back="/start" title="Guest or visitor" sub="Once – after this the app knows you" />
      <Body style={{ gap: 11 }}>
        <Field label="Full name"><Input value={form.name} onChange={set('name')} placeholder="Your name" /></Field>
        <Field label="WhatsApp mobile"><Input value={form.mobile} onChange={set('mobile')} placeholder="10 digits" inputMode="tel" maxLength={14} icon="phone" /></Field>
        <Field label="Company / organisation"><Input value={form.organisation} onChange={set('organisation')} placeholder="optional" /></Field>
        <Field label="Your work"><Input value={form.designation} onChange={set('designation')} placeholder="e.g. quality auditor" /></Field>
        <div className="row sm" style={{ gap: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' }}><Icon name="shield-check" size={18} /><span className="sp">One profile for every visit. You see only your own visits and orders.</span></div>
        <ErrorLine error={a.error} />
      </Body>
      <Foot><Btn style={{ background: '#128C4A' }} onClick={send} busy={a.busy}><Icon name="message-circle" />Send code on WhatsApp</Btn></Foot>
    </Screen>
  );
}

// ── coming back: the mobile and a code ──
export function Back() {
  const nav = useNavigate();
  const [mobile, setMobile] = useState('');
  const a = useAct();
  const send = () => a.run(async () => {
    if (!tenOk(mobile)) throw new Error('Type your 10-digit WhatsApp mobile.');
    const phone = phoneE164(mobile);
    // (23-11-2026) also a first sign-in: an RCL employee who is in HR is known by his mobile; who is not, registers
    const { error } = await supabase!.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
    if (error) throw new Error(error.status === 429 ? 'Wait a minute before asking a new code.' : 'The code could not be sent – try again.');
    setFlow({ mode: 'back', phone });
    nav('/start/code');
  });
  return (
    <Screen>
      <Top back="/start" title="Welcome back" sub="Your mobile brings you back" />
      <Body style={{ gap: 16, paddingTop: 10 }}>
        <p className="h1" style={{ fontSize: 26 }}>Your WhatsApp mobile</p>
        <Input big icon="phone" value={mobile} onChange={setMobile} placeholder="10 digits" inputMode="tel" maxLength={14} autoFocus ariaLabel="WhatsApp mobile" />
        <ErrorLine error={a.error} />
        <Btn style={{ background: '#128C4A' }} onClick={send} busy={a.busy}><Icon name="message-circle" />Send code on WhatsApp</Btn>
        <div className="row xs" style={{ gap: 6 }}><Icon name="info" size={14} /><span className="sp">Working for RCL? Your mobile in HR is enough – the code comes on WhatsApp.</span></div>
      </Body>
    </Screen>
  );
}

// A code again (a new phone, or 30 days since the last one) – the session alone is not proof of who holds the phone.
export function CodeAgain() {
  const s = useSession();
  const nav = useNavigate();
  const a = useAct();
  const send = () => a.run(async () => {
    const phone = s.session?.user.phone ? '+' + s.session.user.phone.replace(/^\+/, '') : s.me?.mobile;
    if (!phone) throw new Error('No mobile on this sign-in.');
    await s.signOut();
    const { error } = await supabase!.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
    if (error) throw new Error('Wait a minute before asking a new code.');
    setFlow({ mode: 'back', phone });
    nav('/start/code');
  });
  return (
    <Screen>
      <Top title="Is this you?" sub="A new phone, or a month since your last code" />
      <Body style={{ gap: 16 }}>
        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}><div className="av lg plum">{initials(s.me?.full_name)}</div>
          <div className="sp"><b style={{ fontSize: 18 }}>{s.me?.full_name}</b><div className="sm">{maskMobile(s.me?.mobile)}</div></div></div>
        <div className="row sm" style={{ gap: 10 }}><Icon name="shield-check" size={18} /><span className="sp">This phone only suggests who you are. A WhatsApp code proves it.</span></div>
        <ErrorLine error={a.error} />
        <Btn style={{ background: '#128C4A' }} onClick={send} busy={a.busy}><Icon name="message-circle" />Send code on WhatsApp</Btn>
        <Btn kind="ghost" onClick={() => void s.signOut()}>Not me</Btn>
      </Body>
    </Screen>
  );
}

// Where he stands when he may not go on: rejected, suspended, temporary access over.
export function Stopped() {
  const s = useSession();
  const me = s.me;
  const why = me?.state === 'rejected' ? 'Your registration was not accepted' : me?.state === 'suspended' ? 'Your FALCON access is stopped' : 'Your temporary access has ended';
  return (
    <Screen>
      <Body style={{ gap: 16, paddingTop: 60 }}>
        <div className="tile s56 red"><Icon name="lock" size={28} /></div>
        <p className="h1" style={{ fontSize: 25 }}>{why}</p>
        {me?.state_reason && <div className="card sm"><b>Reason: </b>{me.state_reason}</div>}
        <p className="sm">Speak to your Site Admin. When he changes it, open FALCON again.</p>
        <Btn kind="ghost" onClick={() => void s.refresh()}><Icon name="refresh-cw" />Check again</Btn>
        <Btn kind="ghost" onClick={() => void s.signOut()}>Sign out</Btn>
      </Body>
    </Screen>
  );
}

// When a step was opened without the one before it.
function Gone() {
  return <Screen><Top back="/start" title="Start again" /><Body><Failed error="This step has expired – start again." /><Btn kind="leaf" to="/start">Start</Btn></Body></Screen>;
}

// More than one part of FALCON: he chooses (his roles decide what is listed).
export function Choose({ items }: { items: { path: string; label: string; icon: string }[] }) {
  const s = useSession();
  return (
    <Screen>
      <Top left={<div className="av">{initials(s.me?.full_name)}</div>} title={s.me?.full_name || ''} sub="Where do you want to go?" />
      <Body style={{ gap: 12 }}>
        {items.map((i) => (
          <Link key={i.path} to={i.path} className="card lift" style={{ display: 'flex', gap: 14, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
            <div className="tile leaf"><Icon name={i.icon} size={22} /></div><b className="sp" style={{ fontSize: 16 }}>{i.label}</b><Icon name="chevron-right" />
          </Link>
        ))}
        <span className="sp" />
        <Btn kind="ghost" onClick={() => void s.signOut()} style={{ marginBottom: 26 }}><Icon name="log-out" />Sign out</Btn>
      </Body>
    </Screen>
  );
}
