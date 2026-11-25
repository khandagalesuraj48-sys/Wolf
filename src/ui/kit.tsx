import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

// The approved look's building blocks (src/styles/design.css). Each screen is built from these and the design's own classes.

export function Screen({ dark, children, style }: { dark?: boolean; children: ReactNode; style?: CSSProperties }) {
  return <div className={'scr f' + (dark ? ' dark' : '')} style={style}><Offline />{children}</div>;
}

export function Top({ title, sub, back, right, left }: { title: ReactNode; sub?: ReactNode; back?: string | true; right?: ReactNode; left?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="top">
      {back ? <button className="ib" aria-label="Back" onClick={() => (back === true ? nav(-1) : nav(back))}><Icon name="chevron-left" /></button> : left}
      <div className="t"><b>{title}</b>{sub != null && <small>{sub}</small>}</div>
      {right}
    </div>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="body" style={style}>{children}</div>;
}

export function Foot({ children }: { children: ReactNode }) {
  return <div style={{ padding: '12px 20px calc(24px + env(safe-area-inset-bottom))', background: '#fff', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}

export function Steps({ n, of, last }: { n: number; of: number; last?: string }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < n ? (i === of - 1 && last ? last : 'var(--leaf)') : '#E7E1D3' }} />
      ))}
    </div>
  );
}

export type Tab = { to: string; icon: string; label: string; plus?: boolean; end?: boolean };
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) =>
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (t.plus ? 'plus' : isActive ? 'on' : '')} aria-label={t.label}>
          {({ isActive }) => <><Icon name={t.icon} size={t.plus ? 24 : 20} />{isActive && !t.plus ? t.label : null}</>}
        </NavLink>)}
    </nav>
  );
}

export function Btn({ kind = '', onClick, busy, disabled, children, to, style, type = 'button' }: {
  kind?: string; onClick?: () => void; busy?: boolean; disabled?: boolean; children: ReactNode; to?: string; style?: CSSProperties; type?: 'button' | 'submit';
}) {
  if (to) return <Link className={'btn ' + kind} to={to} style={style}>{children}</Link>;
  return (
    <button type={type} className={'btn ' + kind} onClick={onClick} disabled={busy || disabled} aria-busy={busy}
      style={{ ...style, opacity: busy || disabled ? 0.6 : 1, cursor: busy || disabled ? 'default' : 'pointer' }}>
      {busy ? <Icon name="loader" /> : null}{children}
    </button>
  );
}

// ── the states every screen has ──
export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="row sm" style={{ justifyContent: 'center', padding: 24 }} role="status"><Icon name="loader" size={18} />{what}…</div>;
}
export function Failed({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card" role="alert" style={{ borderColor: '#E8A49B', background: '#FFF6F4', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name="triangle-alert" size={18} />
      <div className="sp sm" style={{ color: '#7A1F1F' }}>{error}</div>
      {retry && <button className="chip" onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({ icon = 'info', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 24 }}>
      <div className="tile cream"><Icon name={icon} size={22} /></div>
      <b style={{ fontSize: 15 }}>{title}</b>
      {text && <div className="sm">{text}</div>}
      {action}
    </div>
  );
}
export function Denied({ text = 'This page is not part of your work in FALCON.' }: { text?: string }) {
  return <Empty icon="lock" title="Not open to you" text={text} action={<Link className="chip" to="/">Go to your start page</Link>} />;
}
export function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="row xs" role="alert" style={{ color: '#9B1C1C', gap: 6 }}><Icon name="triangle-alert" size={14} /><span className="sp">{error}</span></div> : null;
}

export function Offline() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => setOff(false), offf = () => setOff(true);
    window.addEventListener('online', on); window.addEventListener('offline', offf);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', offf); };
  }, []);
  if (!off) return null;
  return <div role="status" style={{ background: 'var(--amberS)', color: 'var(--amber)', fontSize: 13, fontWeight: 600, padding: '8px 16px', textAlign: 'center' }}>No network – what you see may be old; nothing is sent until you are online.</div>;
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} style={{ position: 'fixed', zIndex: 20 }} />
      <div className="sheet" role="dialog" aria-modal="true" style={{ position: 'fixed', zIndex: 21, maxWidth: 480, margin: '0 auto' }}>{children}</div>
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="fld"><span className="lbl" style={{ fontSize: 13 }}>{label}</span>{children}</label>;
}

// A text box drawn as the design's input
export function Input(p: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'numeric' | 'tel' | 'text';
  maxLength?: number; autoFocus?: boolean; style?: CSSProperties; big?: boolean; icon?: string; ariaLabel?: string }) {
  return (
    <div className={'inp' + (p.value ? ' on' : '')} style={{ height: p.big ? 64 : 46, ...(p.big ? { fontSize: 24, fontWeight: 700, letterSpacing: '.08em' } : {}), ...p.style }}>
      {p.icon && <Icon name={p.icon} size={p.big ? 24 : 18} />}
      <input value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder={p.placeholder} type={p.type || 'text'} inputMode={p.inputMode}
        maxLength={p.maxLength} autoFocus={p.autoFocus} aria-label={p.ariaLabel || p.placeholder}
        style={{ border: 0, outline: 0, background: 'transparent', font: 'inherit', color: 'inherit', flex: 1, minWidth: 0, letterSpacing: 'inherit' }} />
    </div>
  );
}

// The six boxes of a WhatsApp code (board r04)
export function CodeBoxes({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  return (
    <label className="row" style={{ gap: 8, position: 'relative' }}>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))} inputMode="numeric" autoComplete="one-time-code"
        aria-label="The code" autoFocus style={{ position: 'absolute', inset: 0, opacity: 0, fontSize: 16 }} />
      {Array.from({ length }, (_, i) => (
        <span key={i} style={{ flex: 1, height: 60, borderRadius: 14, border: i < value.length ? '2px solid #128C4A' : '1.5px solid var(--line2)', background: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 700 }}>{value[i] || ''}</span>
      ))}
    </label>
  );
}

// (25-11-2026) [off]: the values that cannot be chosen now – dim, a touch does nothing
export function Seg<T extends string>({ value, options, onChange, off = [] }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; off?: T[] }) {
  return <div className="seg" role="tablist">{options.map((o) => {
    const no = off.includes(o.v);
    return <span key={o.v} role="tab" aria-selected={o.v === value} aria-disabled={no || undefined} tabIndex={no ? -1 : 0} className={o.v === value ? 'on' : ''}
      onClick={() => !no && onChange(o.v)} onKeyDown={(e) => !no && e.key === 'Enter' && onChange(o.v)} style={{ cursor: no ? 'default' : 'pointer', opacity: no ? 0.4 : 1 }}>{o.label}</span>;
  })}</div>;
}

export function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="step">
      <span role="button" aria-label="Less" tabIndex={0} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={16} /></span>
      <b>{value}</b>
      <span role="button" aria-label="More" tabIndex={0} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={16} /></span>
    </div>
  );
}
