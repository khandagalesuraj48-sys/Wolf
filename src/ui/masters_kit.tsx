// The masters' common parts (pictures M1–M8, approved 23-11-2026): the state of a record, the Active · Removed · All filter,
// Edit · History · Remove on every row, the side panel to edit, the Remove box (from a date, with the reason – it stays in the
// record) and the History of one record (who, when, before → after, why – the database's office_history).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { call, useAct, useLoad } from '../lib/db';
import { stateOf, listed, type Dated } from '../lib/dated';
import { day, today } from '../lib/fmt';
import { Icon } from './Icon';
import { ErrorLine, Loading } from './kit';

export type Shown = 'active' | 'removed' | 'all';
export const shownOf = <T extends Dated>(list: T[], shown: Shown) => list.filter((r) => shown === 'all' || (shown === 'active') === listed(r));

export function StateChip({ r, inUse = 'Active' }: { r: Dated; inUse?: string }) {
  const s = stateOf(r);
  const [cls, text] = s === 'active' ? ['leaf', inUse] : s === 'ending' ? ['amber', 'Till ' + day(r.valid_to)] : s === 'coming' ? ['blue', 'From ' + day(r.valid_from)]
    : s === 'removed' ? ['red', 'Removed'] : s === 'ended' ? ['', 'Ended'] : ['', 'Inactive'];
  return <span className={'chip st ' + cls}>{text}</span>;
}

export function ShowPick<T extends Dated>({ list, value, onChange }: { list: T[]; value: Shown; onChange: (v: Shown) => void }) {
  const on = list.filter((r) => listed(r)).length;
  return (
    <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Show">
      {([['active', 'Active', on], ['removed', 'Removed', list.length - on], ['all', 'All', list.length]] as const).map(([v, label, n]) =>
        <button key={v} type="button" className={'chip' + (value === v ? ' on' : '')} aria-pressed={value === v} onClick={() => onChange(v)}>{label} · {n}</button>)}
    </div>
  );
}

export function Acts({ onEdit, onHistory, onRemove, removeWord = 'Remove', children }: {
  onEdit?: () => void; onHistory?: () => void; onRemove?: () => void; removeWord?: string; children?: ReactNode;
}) {
  return (
    <div className="act">
      {children}
      {onEdit && <button type="button" className="sb" onClick={onEdit}><Icon name="pencil" size={14} />Edit</button>}
      {onHistory && <button type="button" className="sb" onClick={onHistory}><Icon name="history" size={14} />History</button>}
      {onRemove && <button type="button" className="sb del" onClick={onRemove}><Icon name="trash-2" size={14} />{removeWord}</button>}
    </div>
  );
}

export function WField({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return <label className="wfield" style={{ minWidth: 0, ...style }}><span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{label}</span>{children}</label>;
}

// The side panel to edit (M2, M3)
export function Drawer({ title, sub, onClose, children, foot }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="mdim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dh"><div className="sp"><b style={{ fontSize: 18 }}>{title}</b>{sub && <div className="xs">{sub}</div>}</div>
          <button type="button" className="wbtn" aria-label="Close" onClick={onClose} style={{ width: 40, padding: 0, justifyContent: 'center' }}><Icon name="x" size={16} /></button></div>
        <div className="db">{children}</div>
        <div className="df">{foot}</div>
      </aside>
    </>
  );
}

// The foot of a panel: what is kept, Cancel, Save
export function SaveFoot({ onCancel, onSave, busy, disabled, word = 'Save changes' }: { onCancel: () => void; onSave: () => void; busy: boolean; disabled?: boolean; word?: string }) {
  return <><span className="xs sp">Before → after is kept in History.</span><button type="button" className="wbtn" onClick={onCancel}>Cancel</button>
    <button type="button" className="wbtn pri" onClick={onSave} disabled={busy || disabled}><Icon name="check" size={16} />{busy ? 'Saving…' : word}</button></>;
}

export type RemoveKind = 'site' | 'circle' | 'section' | 'mess' | 'contractor' | 'paper' | 'meal_time' | 'rate' | 'penalty' | 'work_order';

// The Remove box (M4): from which date (today or later), the reason – what happens, said before it is done.
export function RemoveBox({ kind, id, name, sub, noDate, word = 'Remove', onClose, onDone }: {
  kind: RemoveKind; id: string; name: string; sub?: string; noDate?: boolean; word?: string; onClose: () => void; onDone: (how: string) => void;
}) {
  const [from, setFrom] = useState(today());
  const [why, setWhy] = useState('');
  const a = useAct();
  const go = () => a.run(async () => {
    const r = await call<{ how: string }>('office_remove', { p_kind: kind, p_id: id, p_from: from, p_reason: why.trim() });
    onDone(r?.how || 'removed');
  });
  return (
    <>
      <div className="mdim" onClick={onClose} />
      <div className="mbox" role="dialog" aria-modal="true" aria-label={word + ' ' + name}>
        <div className="row"><div className="tile red s40"><Icon name="trash-2" /></div><div className="sp"><b style={{ fontSize: 18 }}>{word} {name}?</b>{sub && <div className="xs">{sub}</div>}</div></div>
        {!noDate && <WField label="From which date"><input className="winp" type="date" min={today()} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="xs">Today or later. One that never was in use goes from its first day.</span></WField>}
        <WField label="Reason (must be given)"><textarea className="winp" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={400} placeholder="e.g. made by mistake / closed" /></WField>
        <div className="col" style={{ gap: 8, background: '#F6F7F9', borderRadius: 12, padding: '12px 14px' }}>
          <b style={{ fontSize: 13.5 }}>What happens</b>
          {[noDate ? 'It leaves the list – the phones stop showing it.' : 'From that date it leaves the lists – the phones stop showing it.',
            'Orders, days and bills before that date stay exactly as they are.',
            'It stays in the record: the “Removed” list and History show who, when and the reason.',
            'A new one can be added in its place.'].map((x) =>
            <div key={x} className="row sm" style={{ alignItems: 'flex-start', gap: 8 }}><Icon name="check" size={16} /><span className="sp">{x}</span></div>)}
        </div>
        <ErrorLine error={a.error} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="wbtn" onClick={onClose}>Cancel</button>
          <button type="button" className="wbtn" onClick={go} disabled={a.busy || why.trim().length < 3 || (!noDate && !from)}
            style={{ background: '#B42318', borderColor: '#B42318', color: '#fff' }}><Icon name="trash-2" size={16} />{a.busy ? 'Removing…' : noDate || from === today() ? word : word + ' from ' + day(from)}</button>
        </div>
      </div>
    </>
  );
}

// ── History (M8) ──
type Line = { at: string; who: string | null; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; how: string | null; reason: string | null };
const SKIP = new Set(['id', 'company_id', 'created_at', 'updated_at', 'set_at', 'asked_at', 'decided_at', 'removed_at', 'removed_by', 'verified_at', 'asked_by', 'decided_by', 'verified_by', 'set_by', 'created_by']);
const WORD: Record<string, string> = {
  name: 'Name', code: 'Code', site_id: 'Site', circle_id: 'Circle', contractor_id: 'Contractor', counters: 'Counters with QR', lat: 'Latitude', lng: 'Longitude',
  radius_m: 'Metres around it', valid_from: 'From', valid_to: 'Till', removed_reason: 'Removed – why', active: 'Active', km: 'Km', km_from: 'Km from', km_to: 'Km to',
  place: 'Drop point', serve_from: 'Served from', serve_to: 'Served till', order_by: 'Parcel order by', change_minutes: 'Change window (min)', meal: 'Meal',
  kind: 'Type', contact_name: 'Contact', contact_mobile: 'Mobile', gstin: 'GSTIN', pan: 'PAN', udyam: 'Udyam', address: 'Address', login_code: 'Sign-in code',
  number: 'Number', file_path: 'File', state: 'State', rate: 'Rate', item_id: 'Item', what: 'What', amount: 'Amount', per: 'Per', qty: 'Quantity', note: 'Note',
  payment_days: 'Payment days', advance_amount: 'Advance', advance_recovery_pct: 'Advance back %', security_deposit: 'Security deposit', retention_pct: 'Retention %',
  mess_id: 'Mess', work_order_id: 'Work order', title: 'Title', reason: 'Reason', till: 'Till',
};
function show(k: string, v: unknown, names: Record<string, string>): string {
  if (v == null || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = String(v);
  if (names[s]) return names[s];
  if (k === 'file_path') return 'a file';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return day(s);
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return 'changed';
  return s;
}

export function HistoryBox({ entity, id, name, names = {}, onClose }: { entity: string; id: string; name: string; names?: Record<string, string>; onClose: () => void }) {
  const h = useLoad(() => call<Line[]>('office_history', { p_entity: entity, p_id: id }).then((x) => x || []), [entity, id]);
  return (
    <Drawer title={'History · ' + name} sub="Newest first. History is never changed or deleted." onClose={onClose}
      foot={<><span className="xs sp">The whole company's record: Audit log.</span><a className="wbtn" href="/admin/audit"><Icon name="history" size={16} />Audit log</a></>}>
      {h.loading && !h.data ? <Loading /> : h.error ? <ErrorLine error={h.error} /> : (h.data || []).length === 0 ? <div className="sm">Nothing changed yet.</div> :
        <div className="col" style={{ gap: 0 }}>{(h.data || []).map((x, i) => {
          const at = new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
          const b = x.before || {}, af = x.after || {};
          const keys = x.action === 'update' ? Object.keys(af).filter((k) => !SKIP.has(k) && JSON.stringify(b[k]) !== JSON.stringify(af[k])) : [];
          const head = x.action === 'insert' ? 'Made' : x.action === 'update' ? (keys.includes('removed_reason') && af.removed_reason ? 'Removed' : 'Changed')
            : x.action === 'reason' ? 'Why' : x.action === 'end' ? 'Ended' : x.action === 'delete' ? 'Deleted' : x.action.replace(/_/g, ' ');
          return (
            <div key={i} className="ev"><span className="dot" style={{ background: x.action === 'insert' ? 'var(--faint)' : x.action === 'reason' ? 'var(--blue)' : undefined }} />
              <div className="col sp" style={{ gap: 4 }}>
                <span className="xs">{at} · {x.who || 'FALCON'}</span>
                <b style={{ fontSize: 14 }}>{head}</b>
                {x.action === 'insert' && <span className="sm">{['name', 'code', 'meal', 'rate', 'number', 'what'].filter((k) => af[k] != null).map((k) => WORD[k] + ': ' + show(k, af[k], names)).join(' · ')}</span>}
                {keys.map((k) => <span key={k} className="sm">{WORD[k] || k}: <span className="was">{show(k, b[k], names)}</span> → <b style={{ color: 'var(--ink)' }}>{show(k, af[k], names)}</b></span>)}
                {x.action === 'end' && <span className="sm">In use till {show('till', af.till, names)}</span>}
                {x.reason && <span className="xs">Reason: {x.reason}</span>}
                {x.action === 'update' && keys.length === 0 && !x.reason && <span className="xs">Saved again – nothing of it changed.</span>}
              </div>
            </div>
          );
        })}</div>}
    </Drawer>
  );
}

// the phone's place, once (for "Use my location")
export function here(): Promise<{ lat: number; lng: number }> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This browser does not give its place.'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => rej(new Error(e.code === 1 ? 'Allow the location for this page, then try again.' : 'The place could not be read – try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}
