// Opened from HR (23-11-2026, picture N8): what HR said for today – his first punch-in – and whether the "Signed in through RCL HR"
// banner is still shown. Kept for this visit only.
export interface HrInfo { day: string; in: string | null; banner: boolean }
export function readHr(): HrInfo | null {
  try { const v = JSON.parse(sessionStorage.getItem('falcon.hr') || 'null'); return v && typeof v.day === 'string' ? v : null; } catch { return null; }
}
export function keepHr(v: HrInfo) { try { sessionStorage.setItem('falcon.hr', JSON.stringify(v)); } catch { /* this visit only */ } }
export function closeHrBanner(): HrInfo | null { const v = readHr(); if (v) { v.banner = false; keepHr(v); } return v; }
