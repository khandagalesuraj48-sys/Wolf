// The web's billing: w08 the month's bill (verified quantity × the day's approved rate; GST, TDS and deductions from Accounts'
// dated rules) · w09 the contractor's invoice against the system, line by line · w10 the approvals, the ERP posting and the
// payment – each step by a different person, send back and hold with the reason. Every step is the database's own function.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { call, db, one, rows, useAct, useLoad } from '../../lib/db';
import { useSession } from '../../lib/session';
import { day, inr, monthName, num, time, today } from '../../lib/fmt';
import { Icon } from '../../ui/Icon';
import { ErrorLine, Failed, Input, Loading } from '../../ui/kit';
import { Kpi, Tbl, Web } from '../../ui/web';

interface Line { item: string; name: string; qty: number; amount: number; rates: { rate: number }[] }
interface Bill {
  id: string; code: string; site_id: string; mess_id: string; work_order_id: string; month: string; state: string; held_at_state: string | null;
  lines: Line[]; not_billable: { not_confirmed?: number; failed?: number; cancelled_after_accept?: number }; taxable: number;
  gst_rate: number | null; gst_amount: number; tds_section: string | null; tds_rate: number | null; tds_amount: number; retention: number;
  advance_recovery: number; penalties: number; penalty_lines: { what: string; amount: number }[]; net_payable: number;
  invoice_number: string | null; invoice_path: string | null; invoice_amount: number | null; invoice_lines: { item: string; qty: number; rate: number }[] | null;
  recon: { lines: Recon[]; duplicates: string[]; checked_at: string } | null; erp_ref: string | null; built_at: string | null;
  sites?: { code: string } | null; messes?: { name: string } | null; work_orders?: { number: string; retention_pct: number; advance_recovery_pct: number; contractors: { name: string; kind: string } | null } | null;
}
interface Recon { item: string; name: string | null; system_qty: number | null; invoice_qty: number | null; contract_rate: number | null; invoice_rate: number | null; difference: number; why: string }

const SEL = '*,sites(code),messes(name),work_orders(number,retention_pct,advance_recovery_pct,contractors(name,kind))';
const CHAIN: { key: string; label: string }[] = [
  { key: 'draft', label: 'Month total' }, { key: 'invoice_uploaded', label: 'Invoice uploaded' }, { key: 'checked', label: 'System check' },
  { key: 'site_admin_ok', label: 'Site Admin' }, { key: 'accounts_ok', label: 'Accounts' }, { key: 'management_ok', label: 'Management' },
  { key: 'posted', label: 'ERP posting' }, { key: 'paid', label: 'Paid' }];
const AT: Record<string, string> = { draft: 'Waiting for the invoice', invoice_uploaded: 'Waiting for the check', checked: 'Site Admin', site_admin_ok: 'Accounts',
  accounts_ok: 'Management', management_ok: 'ERP posting', posted: 'Payment', paid: 'Paid', sent_back: 'Sent back', on_hold: 'On hold' };
const where = (b: Bill) => b.state === 'on_hold' ? 'On hold at ' + AT[b.held_at_state || ''] : AT[b.state];
const lastMonth = () => { const d = new Date(today() + 'T12:00:00+05:30'); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

function Chain({ b }: { b: Bill }) {
  const cur = b.state === 'on_hold' ? b.held_at_state || 'draft' : b.state === 'sent_back' ? 'draft' : b.state;
  const n = CHAIN.findIndex((c) => c.key === cur);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="chip leaf"><Icon name="check" size={14} />Days locked</span>
      {CHAIN.map((c, i) => <span key={c.key} className="row" style={{ gap: 6 }}><span style={{ color: 'var(--faint)', display: 'inline-flex' }}><Icon name="chevron-right" size={14} /></span>
        <span className={'chip ' + (i < n || (i === n && cur === 'paid') ? 'leaf' : i === n + 1 ? 'amber' : '')}>{i < n || (i === n && cur === 'paid') ? <Icon name="check" size={14} /> : null}{c.label}</span></span>)}
      {b.state === 'sent_back' && <span className="chip red">Sent back – make it again</span>}
      {b.state === 'on_hold' && <span className="chip red">On hold</span>}
    </div>
  );
}

function useBills() {
  return useLoad(() => rows<Bill>(db().from('monthly_bills').select(SEL).order('month', { ascending: false }).limit(200)), [], ['monthly_bills']);
}

// ── w08 · the month's bill ──
export function Billing() {
  const s = useSession();
  const wos = useLoad(() => rows<{ id: string; number: string; site_id: string; messes: { name: string } | null; contractors: { name: string } | null }>(db().from('work_orders').select('id,number,site_id,messes(name),contractors(name)').order('valid_from', { ascending: false })), []);
  const [wo, setWo] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const w = (wos.data || []).find((x) => x.id === wo) || wos.data?.[0];
  const bill = useLoad(() => w ? one<Bill>(db().from('monthly_bills').select(SEL).eq('work_order_id', w.id).eq('month', month + '-01')) : Promise.resolve(null), [w?.id, month], ['monthly_bills']);
  const a = useAct();
  const b = bill.data;
  const maker = w && (s.has('accounts') || s.has('site_admin', w.site_id));
  const canMake = maker && (!b || ['draft', 'invoice_uploaded', 'checked', 'sent_back'].includes(b.state));
  const make = () => a.run(async () => { await call('build_bill', { p_wo: w!.id, p_month: month + '-01' }); bill.reload(); });
  const k = b?.work_orders?.contractors;
  return (
    <Web title={b ? monthName(b.month) + ' · ' + (b.sites?.code || '') + ' · ' + (k?.name || '') : 'Monthly billing'} roles={['system_admin', 'accounts', 'site_admin', 'management']}
      actions={<>
        <select className="wbtn" value={w?.id || ''} onChange={(e) => setWo(e.target.value)} aria-label="Work order">{(wos.data || []).map((x) => <option key={x.id} value={x.id}>{x.number} · {x.messes?.name}</option>)}</select>
        <input className="wbtn" type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        {b && <span className={'chip ' + (b.state === 'paid' ? 'leaf' : ['sent_back', 'on_hold'].includes(b.state) ? 'red' : 'amber')} style={{ height: 30 }}>{where(b)}</span>}
        {canMake && <button className="wbtn pri" onClick={make} disabled={a.busy}><Icon name="receipt" size={16} />{b ? 'Make it again' : 'Make the bill'}</button>}
        {b && <Link className="wbtn" to={'/admin/reconciliation?bill=' + b.id}><Icon name="scale" size={16} />Check against invoice</Link>}</>}>
      <ErrorLine error={a.error} />
      {wos.loading && !wos.data ? <Loading /> : wos.error ? <Failed error={wos.error} retry={wos.reload} />
        : !w ? <div className="wcard sm">No work order yet – Accounts adds it under Work orders and rates.</div>
        : bill.loading && !bill.data ? <Loading /> : !b ? <div className="wcard sm">No bill for {monthName(month + '-01')} yet. It is made after the month is over and every day of it is locked – only confirmed meals of locked days count.</div>
        : <>
          <Chain b={b} />
          <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
            <div className="wcard"><h3>Verified quantity × contract rate</h3>
              <Tbl head={['Category', 'Qty', 'Rate', 'Amount ₹']} right={[1, 2, 3]}
                rows={[...b.lines.map((l) => [l.name, num(l.qty), l.rates.length === 1 ? num(l.rates[0].rate) : l.rates.map((r) => num(r.rate)).join(' / '), num(l.amount)]),
                  [<b>Taxable value</b>, '', '', <b>{num(b.taxable)}</b>]]} hl={(i) => i === b.lines.length} />
              <div className="xs" style={{ marginTop: 8 }}>Not billed: {b.not_billable.not_confirmed || 0} not confirmed · {b.not_billable.failed || 0} failed · {b.not_billable.cancelled_after_accept || 0} cancelled after the kitchen accepted. Made {b.built_at ? day(b.built_at) + ' ' + time(b.built_at) : ''}.</div>
            </div>
            <div className="wcard"><h3>GST, TDS and deductions</h3>
              <div className="col" style={{ gap: 10 }}>
                <div className="row sm"><span className="sp">Taxable value</span><b style={{ color: 'var(--ink)' }}>{num(b.taxable)}</b></div>
                <div className="row sm"><span className="sp">GST · {num(b.gst_rate)}% <span className="tag">set by Accounts</span></span><b style={{ color: 'var(--ink)' }}>+ {num(b.gst_amount)}</b></div>
                <div className="hr" />
                <div className="row sm"><span className="sp">TDS {b.tds_section || ''} · {num(b.tds_rate)}% <span className="tag">{k?.kind}</span></span><b style={{ color: 'var(--ink)' }}>− {num(b.tds_amount)}</b></div>
                <div className="row sm"><span className="sp">Retention {num(b.work_orders?.retention_pct)}%</span><b style={{ color: 'var(--ink)' }}>− {num(b.retention)}</b></div>
                <div className="row sm"><span className="sp">Advance back ({num(b.work_orders?.advance_recovery_pct)}%)</span><b style={{ color: 'var(--ink)' }}>− {num(b.advance_recovery)}</b></div>
                <div className="row sm"><span className="sp">Penalties{b.penalty_lines.length ? ' · ' + b.penalty_lines.map((p) => p.what).join(', ') : ''}</span><b style={{ color: 'var(--ink)' }}>− {num(b.penalties)}</b></div>
                <div className="hr" />
                <div className="row"><b className="sp" style={{ fontSize: 16 }}>Net payable</b><b style={{ fontSize: 22 }}>{inr(b.net_payable)}</b></div>
                <div className="row xs" style={{ gap: 6 }}><Icon name="info" size={14} /><span className="sp">Rates of GST and TDS are dated settings checked by the CA – none is written in the program.</span></div>
              </div>
            </div>
          </div>
        </>}
    </Web>
  );
}

// ── w09 · the invoice against the system ──
export function Reconciliation() {
  const s = useSession();
  const nav = useNavigate();
  const [q] = useSearchParams();
  const bills = useBills();
  const [sel, setSel] = useState(q.get('bill') || '');
  const b = (bills.data || []).find((x) => x.id === sel) || (bills.data || []).find((x) => ['invoice_uploaded', 'checked', 'draft'].includes(x.state)) || bills.data?.[0];
  const [inv, setInv] = useState({ number: '', amount: '' });
  const [lines, setLines] = useState<Record<string, { qty: string; rate: string }>>({});
  const [file, setFile] = useState<File | null>(null);
  const a = useAct();
  const open = b && ['draft', 'invoice_uploaded', 'checked'].includes(b.state);
  const checker = b && (s.has('accounts') || s.has('site_admin', b.site_id));
  const rec = b?.recon?.lines || [];
  const diff = rec.filter((r) => r.why !== 'matches');
  const upload = () => a.run(async () => {
    let path: string | null = b!.invoice_path;
    if (file) { path = s.me!.company_id + '/' + b!.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_'); const r = await supabase!.storage.from('invoices').upload(path, file, { contentType: file.type }); if (r.error) throw new Error('The file could not be sent.'); }
    const ls = b!.lines.map((l) => ({ item: l.item, qty: Number(lines[l.item]?.qty ?? l.qty), rate: Number(lines[l.item]?.rate ?? (l.rates[0]?.rate || 0)) }));
    await call('upload_invoice', { p_bill: b!.id, p_number: inv.number, p_path: path, p_amount: Number(inv.amount), p_lines: ls }); bills.reload();
  });
  const check = () => a.run(async () => { await call('check_invoice', { p_bill: b!.id }); bills.reload(); });
  const pdf = async () => { if (!b?.invoice_path) return; const r = await supabase!.storage.from('invoices').createSignedUrl(b.invoice_path, 300); if (r.data) window.open(r.data.signedUrl, '_blank'); };
  return (
    <Web title={b ? (b.invoice_number || b.code) + ' against the system · ' + monthName(b.month) : 'Reconciliation'} roles={['accounts', 'site_admin', 'system_admin']}
      actions={<>
        <select className="wbtn" value={b?.id || ''} onChange={(e) => setSel(e.target.value)} aria-label="Bill">{(bills.data || []).map((x) => <option key={x.id} value={x.id}>{x.code} · {where(x)}</option>)}</select>
        {b?.invoice_path && <button className="wbtn" onClick={() => void pdf()}><Icon name="eye" size={16} />Invoice PDF</button>}
        {b && b.invoice_lines && open && checker && <button className="wbtn" onClick={check} disabled={a.busy}><Icon name="scale" size={16} />Check against the system</button>}
        {b?.state === 'checked' && <button className="wbtn pri" onClick={() => nav('/admin/approvals?bill=' + b.id)}><Icon name="check" size={16} />Pass system values</button>}</>}>
      <ErrorLine error={a.error} />
      {bills.loading && !bills.data ? <Loading /> : bills.error ? <Failed error={bills.error} retry={bills.reload} /> : !b ? <div className="wcard sm">No bill yet – make the month's bill first.</div> : <>
        <div className="kpis">
          <Kpi label="Invoice · before GST" value={b.invoice_amount != null ? inr(b.invoice_amount) : '–'} note={b.invoice_number ? 'invoice ' + b.invoice_number : 'not uploaded yet'} tone="muted" />
          <Kpi label="System · verified" value={inr(b.taxable)} note="only locked days" tone="leaf" />
          <Kpi label="Difference" value={b.invoice_amount != null ? inr(Math.abs(b.invoice_amount - b.taxable)) : '–'} note={b.recon ? diff.length + ' lines' : 'not checked yet'} tone={diff.length ? 'red' : 'leaf'} />
          <Kpi label="Checked" value={b.recon ? day(b.recon.checked_at) : '–'} note={b.recon ? (b.recon.duplicates.length ? b.recon.duplicates.length + ' duplicate lines' : 'no duplicate lines') : ''} tone={b.recon?.duplicates.length ? 'red' : 'muted'} />
        </div>
        {b.recon ? <div className="wcard" style={{ padding: '8px 8px 0' }}>
          <Tbl head={['Line', 'System qty', 'Invoice qty', 'Contract rate', 'Invoice rate', 'Difference ₹', 'Why']} right={[1, 2, 3, 4, 5]} hl={(i) => rec[i]?.why !== 'matches'}
            rows={[...rec.map((r) => [r.why === 'matches' ? r.name || r.item : <b>{r.name || r.item}</b>, num(r.system_qty), num(r.invoice_qty), num(r.contract_rate), num(r.invoice_rate),
              r.difference ? <b style={{ color: 'var(--red)' }}>{num(r.difference)}</b> : '0', <span className={'chip ' + (r.why === 'matches' ? 'leaf' : 'red')} style={{ height: 24 }}>{r.why === 'matches' ? 'Matches' : r.why}</span>]),
              ['Duplicate lines', '–', '–', '–', '–', '0', <span className={'chip ' + (b.recon.duplicates.length ? 'red' : 'leaf')} style={{ height: 24 }}>{b.recon.duplicates.length ? b.recon.duplicates.join(', ') : 'None found'}</span>]]} />
        </div> : <div className="wcard sm">{b.invoice_lines ? 'The invoice is in – check it against the system.' : 'The contractor\'s invoice is not in yet. The mess owner uploads it from his app, or Accounts enters it here.'}</div>}
        {open && s.has('accounts') && <div className="wcard"><h3>Enter the contractor's invoice</h3>
          <div className="row wrap" style={{ gap: 8 }}><Input value={inv.number} onChange={(v) => setInv({ ...inv, number: v })} placeholder="Invoice number" /><Input value={inv.amount} onChange={(v) => setInv({ ...inv, amount: v })} placeholder="Amount before GST ₹" inputMode="numeric" />
            <label className="wbtn" style={{ cursor: 'pointer' }}><Icon name="upload" size={16} />{file ? file.name : 'Invoice PDF'}<input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label></div>
          <Tbl head={['Line', 'Qty on the invoice', 'Rate on the invoice']} rows={b.lines.map((l) => [l.name,
            <input className="winp" style={{ width: 110 }} inputMode="numeric" value={lines[l.item]?.qty ?? String(l.qty)} onChange={(e) => setLines({ ...lines, [l.item]: { qty: e.target.value, rate: lines[l.item]?.rate ?? String(l.rates[0]?.rate || 0) } })} aria-label={l.name + ' quantity'} />,
            <input className="winp" style={{ width: 90 }} inputMode="numeric" value={lines[l.item]?.rate ?? String(l.rates[0]?.rate || 0)} onChange={(e) => setLines({ ...lines, [l.item]: { rate: e.target.value, qty: lines[l.item]?.qty ?? String(l.qty) } })} aria-label={l.name + ' rate'} />])} />
          <button className="wbtn pri" style={{ marginTop: 10 }} onClick={upload} disabled={!inv.number || !inv.amount || a.busy}><Icon name="upload" size={16} />Save the invoice</button></div>}
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Only what was served, delivered and confirmed is paid. The system's values are the ones passed on.</span></div>
      </>}
    </Web>
  );
}

// ── w10 · approvals and payments ──
export function Approvals() {
  const s = useSession();
  const [q] = useSearchParams();
  const bills = useBills();
  const [sel, setSel] = useState(q.get('bill') || '');
  const list = bills.data || [];
  const b = list.find((x) => x.id === sel) || list.find((x) => ['checked', 'site_admin_ok', 'accounts_ok', 'management_ok', 'posted', 'on_hold'].includes(x.state)) || list[0];
  const steps = useLoad(() => b ? rows<{ id: string; step: string; decision: string; at: string; reason: string | null; people: { full_name: string } | null }>(db().from('bill_steps').select('id,step,decision,at,reason,people(full_name)').eq('bill_id', b.id).order('at')) : Promise.resolve([]), [b?.id, b?.state]);
  const pay = useLoad(() => b ? one<{ amount: number; utr: string; paid_on: string }>(db().from('payments').select('amount,utr,paid_on').eq('bill_id', b.id)) : Promise.resolve(null), [b?.id, b?.state]);
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const [p, setP] = useState({ utr: '', on: today() });
  const a = useAct();
  const cur = b ? (b.state === 'on_hold' ? b.held_at_state : b.state) : null;
  const mine = b && ((cur === 'checked' && s.has('site_admin', b.site_id)) || ((cur === 'site_admin_ok' || cur === 'management_ok') && s.has('accounts')) || (cur === 'accounts_ok' && s.has('management')));
  const step = (d: string) => a.run(async () => {
    if (d !== 'approve' && !reason.trim()) throw new Error('Send back and Hold need the reason.');
    await call('bill_step', { p_bill: b!.id, p_decision: d, p_reason: reason.trim() || null, p_ref: cur === 'management_ok' ? ref.trim() : null }); setReason(''); setRef(''); bills.reload();
  });
  const paid = () => a.run(async () => { await call('record_payment', { p_bill: b!.id, p_amount: b!.net_payable, p_utr: p.utr.trim(), p_paid_on: p.on }); bills.reload(); });
  const paidNow = useLoad(() => rows<{ amount: number }>(db().from('payments').select('amount').gte('paid_on', today().slice(0, 7) + '-01')), [], ['payments']);
  const at =(st: string) => list.filter((x) => (x.state === 'on_hold' ? x.held_at_state : x.state) === st);
  const label: Record<string, string> = { site_admin: 'Site Admin', accounts: 'Accounts', management: 'Management', posting: 'Posted in the ERP' };
  return (
    <Web title="Approvals and payments" roles={['accounts', 'site_admin', 'management', 'system_admin']}>
      {bills.loading && !bills.data ? <Loading /> : bills.error ? <Failed error={bills.error} retry={bills.reload} /> : <>
        <div className="kpis">
          <Kpi label="Waiting at Accounts" value={at('site_admin_ok').length + at('management_ok').length} note={inr(at('site_admin_ok').concat(at('management_ok')).reduce((t, x) => t + Number(x.net_payable), 0))} tone="amber" />
          <Kpi label="Waiting at Management" value={at('accounts_ok').length} note={inr(at('accounts_ok').reduce((t, x) => t + Number(x.net_payable), 0))} tone="amber" />
          <Kpi label="Paid this month" value={inr((paidNow.data || []).reduce((t, x) => t + Number(x.amount), 0))} note={(paidNow.data || []).length + ' bills'} tone="leaf" />
          <Kpi label="Retention held" value={inr(list.filter((x) => x.state !== 'sent_back').reduce((t, x) => t + Number(x.retention), 0))} note="back at the end of the work order" />
        </div>
        <div className="g2" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
          <div className="wcard" style={{ padding: '8px 8px 0' }}>
            <Tbl head={['Bill', 'Site · contractor', 'Month', 'Net ₹', 'Where it is']} right={[3]} hl={(i) => list[i]?.id === b?.id}
              rows={list.map((x) => [<button className="chip" style={{ border: 0, background: 'none', padding: 0 }} onClick={() => setSel(x.id)}><b>{x.code}</b></button>, (x.sites?.code || '') + ' · ' + (x.work_orders?.contractors?.name || ''), monthName(x.month), num(x.net_payable),
                <span className={'chip ' + (x.state === 'paid' ? 'leaf' : ['sent_back', 'on_hold'].includes(x.state) ? 'red' : 'amber')} style={{ height: 24 }}>{where(x)}</span>])} empty="No bill yet" />
          </div>
          {b && <div className="wcard"><h3>{b.code} · its steps</h3>
            <div className="tl">
              <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>The month's days locked</b><small>made {b.built_at ? day(b.built_at) : ''}</small></div></div>
              <div className={'st ' + (b.recon ? 'done' : 'now')}><span className="k">{b.recon ? <Icon name="check" size={14} /> : <Icon name="clock" size={14} />}</span><div><b>Invoice checked against the system</b><small>{b.recon ? day(b.recon.checked_at) + ' · ' + b.recon.lines.filter((r) => r.why !== 'matches').length + ' lines differ' : 'not yet'}</small></div></div>
              {(steps.data || []).map((x) => <div key={x.id} className={'st ' + (x.decision === 'approve' ? 'done' : 'now')}><span className="k">{x.decision === 'approve' ? <Icon name="check" size={14} /> : <Icon name={x.decision === 'hold' ? 'lock' : 'rotate-ccw'} size={14} />}</span>
                <div><b>{label[x.step]}{x.decision !== 'approve' ? ' · ' + (x.decision === 'hold' ? 'held' : 'sent back') : ''}</b><small>{x.people?.full_name} · {day(x.at)} {time(x.at)}{x.reason ? ' · ' + x.reason : ''}</small></div></div>)}
              {b.erp_ref && <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>ERP entry</b><small>{b.erp_ref}</small></div></div>}
              {pay.data ? <div className="st done"><span className="k"><Icon name="check" size={14} /></span><div><b>Paid {inr(pay.data.amount)}</b><small>{day(pay.data.paid_on)} · UTR …{pay.data.utr.slice(-4)}</small></div></div>
                : <div className="st"><span className="k" /><div><b style={{ color: 'var(--muted)' }}>{where(b)}</b><small>{b.state === 'posted' ? 'Accounts enters the UTR' : 'next step'}</small></div></div>}
            </div>
            {mine && b.state !== 'paid' && <div className="col" style={{ gap: 8, marginTop: 6 }}>
              {cur === 'management_ok' && <Input value={ref} onChange={setRef} placeholder="ERP entry reference" />}
              <Input value={reason} onChange={setReason} placeholder="Reason (needed to send back or hold)" />
              <div className="row" style={{ gap: 10 }}><button className="wbtn pri" onClick={() => step('approve')} disabled={a.busy}><Icon name="check" size={16} />{cur === 'management_ok' ? 'Posted' : 'Approve'}</button>
                <button className="wbtn" onClick={() => step('send_back')} disabled={a.busy}><Icon name="rotate-ccw" size={16} />Send back</button>
                <button className="wbtn" onClick={() => step('hold')} disabled={a.busy || b.state === 'on_hold'}><Icon name="lock" size={16} />Hold</button></div></div>}
            {b.state === 'posted' && s.has('accounts') && <div className="col" style={{ gap: 8, marginTop: 6 }}>
              <div className="row sm"><span className="sp">Amount</span><b style={{ color: 'var(--ink)' }}>{inr(b.net_payable)}</b></div>
              <Input value={p.utr} onChange={(v) => setP({ ...p, utr: v })} placeholder="UTR" /><input className="winp" type="date" value={p.on} max={today()} onChange={(e) => setP({ ...p, on: e.target.value })} aria-label="Paid on" />
              <button className="wbtn pri" onClick={paid} disabled={!p.utr || a.busy}><Icon name="wallet" size={16} />Enter the payment</button></div>}
            <ErrorLine error={a.error} />
          </div>}
        </div>
        <div className="row xs" style={{ gap: 8 }}><Icon name="info" size={14} /><span className="sp">Each step is done by a different person – nobody approves his own entry. Send back and Hold always need the reason.</span></div>
      </>}
    </Web>
  );
}
