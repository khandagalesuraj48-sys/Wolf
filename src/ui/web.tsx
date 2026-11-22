import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession, type Role } from '../lib/session';
import { Icon } from './Icon';
import { Denied, Offline } from './kit';

// The web's frame (boards w01–w17): the navy sidebar – only the pages his roles may open – and the page.
const OFFICE: Role[] = ['system_admin', 'management', 'accounts', 'site_admin', 'mess_supervisor'];
export const NAV: { grp: string; items: { to: string; icon: string; label: string; roles: Role[] }[] }[] = [
  { grp: 'Operations', items: [
    { to: '/admin', icon: 'layout-grid', label: 'Dashboard', roles: OFFICE },
    { to: '/admin/consumption', icon: 'utensils', label: 'Daily consumption', roles: ['system_admin', 'management', 'accounts', 'site_admin', 'mess_supervisor'] },
    { to: '/admin/complaints', icon: 'message-square-warning', label: 'Complaints', roles: ['system_admin', 'management', 'site_admin', 'mess_supervisor'] }] },
  { grp: 'Masters', items: [
    { to: '/admin/sites', icon: 'map', label: 'Sites and sections', roles: ['system_admin', 'site_admin'] },
    { to: '/admin/mess', icon: 'store', label: 'Mess and contractors', roles: ['system_admin', 'site_admin', 'accounts'] },
    { to: '/admin/work-orders', icon: 'file-text', label: 'Work orders and rates', roles: ['system_admin', 'site_admin', 'accounts', 'management'] }] },
  { grp: 'Billing', items: [
    { to: '/admin/billing', icon: 'receipt', label: 'Monthly billing', roles: ['system_admin', 'accounts', 'site_admin', 'management'] },
    { to: '/admin/reconciliation', icon: 'scale', label: 'Reconciliation', roles: ['accounts', 'site_admin', 'system_admin'] },
    { to: '/admin/approvals', icon: 'wallet', label: 'Approvals and payments', roles: ['accounts', 'site_admin', 'management', 'system_admin'] }] },
  { grp: 'Insight', items: [
    { to: '/admin/reports', icon: 'download', label: 'Reports', roles: OFFICE },
    { to: '/admin/analytics', icon: 'chart-line', label: 'Analytics', roles: ['system_admin', 'management', 'site_admin', 'accounts'] }] },
  { grp: 'People and control', items: [
    { to: '/admin/registrations', icon: 'user-plus', label: 'Registrations', roles: ['system_admin', 'site_admin', 'management'] },
    { to: '/admin/guests', icon: 'users', label: 'Guests', roles: ['system_admin', 'site_admin', 'management', 'accounts'] },
    { to: '/admin/people', icon: 'user-check', label: 'People and roles', roles: ['system_admin', 'site_admin'] },
    { to: '/admin/settings', icon: 'settings', label: 'Settings', roles: ['system_admin', 'accounts'] },
    { to: '/admin/audit', icon: 'history', label: 'Audit log', roles: ['system_admin', 'management', 'site_admin'] }] },
];

export function Web({ title, actions, children, roles }: { title: ReactNode; actions?: ReactNode; children: ReactNode; roles?: Role[] }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const ok = !roles || s.has(roles);
  return (
    <div className="web f" style={{ minHeight: '100dvh' }}>
      <nav className={'side' + (open ? ' open' : '')} aria-label="FALCON">
        <div className="brand"><div className="tile s40 navy" style={{ background: '#172A4C' }}><Icon name="utensils" /></div><div><b>FALCON</b><small>Food &amp; Site Operations</small></div></div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => s.has(i.roles));
          if (!items.length) return null;
          return <div key={g.grp}><span className="grp">{g.grp}</span>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className={({ isActive }) => (isActive ? 'on' : '')} onClick={() => setOpen(false)}><Icon name={i.icon} size={18} />{i.label}</NavLink>)}</div>;
        })}
        <span className="grp">{s.me?.full_name}</span>
        <a href="#" onClick={(e) => { e.preventDefault(); void s.signOut(); }}><Icon name="log-out" size={18} />Sign out</a>
      </nav>
      <main className="main">
        <Offline />
        <div className="wtop"><button className="wbtn menu-btn" aria-label="Menu" onClick={() => setOpen((x) => !x)}><Icon name="list" size={16} /></button><h1>{title}</h1>{ok && actions}</div>
        {ok ? children : <Denied />}
      </main>
    </div>
  );
}

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'leaf' | 'red' | 'amber' | 'muted' }) {
  const c = tone === 'leaf' ? 'var(--leafD)' : tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--muted)';
  return <div className="kpi"><small>{label}</small><b>{value}</b>{note != null && <em style={{ color: c }}>{note}</em>}</div>;
}

export function Tbl({ head, rows, right = [], empty = 'Nothing yet', hl }: { head: string[]; rows: ReactNode[][]; right?: number[]; empty?: string; hl?: (i: number) => boolean }) {
  return (
    <div className="tbox"><table className="tbl">
      <thead><tr>{head.map((h, i) => <th key={i} className={right.includes(i) ? 'r' : ''}>{h}</th>)}</tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={head.length} className="xs" style={{ textAlign: 'center', padding: 16 }}>{empty}</td></tr>
        : rows.map((r, i) => <tr key={i} className={hl?.(i) ? 'hl' : ''}>{r.map((c, j) => <td key={j} className={right.includes(j) ? 'r' : ''}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

// "Excel" – a CSV file Excel opens; "PDF" – the browser's print to PDF of the page.
export function csv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.csv'; a.click(); URL.revokeObjectURL(a.href);
}

export function SitePick({ value, onChange, all }: { value: string; onChange: (v: string) => void; all?: boolean }) {
  const s = useSession();
  const mine = s.sites.filter((x) => s.has(OFFICE, x.id));
  return <select className="wbtn" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Site">{all && <option value="">All sites</option>}{mine.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select>;
}
