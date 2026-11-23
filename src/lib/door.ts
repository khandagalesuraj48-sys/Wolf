// The first screen's code, kept on this phone / browser (his decision of 23-11-2026: the company code first – the app then knows
// where the person comes from; a mess contractor has his own code). Only the code and the names the server gave are kept.
export interface Door { kind: 'company' | 'contractor'; code: string; name: string; company: string; company_name: string }

const KEY = 'falcon.door';
export function getDoor(): Door | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null') as Door | null;
    return d && (d.kind === 'company' || d.kind === 'contractor') && /^[A-Z0-9]{2,12}$/.test(d.code) ? d : null;
  } catch { return null; }
}
export function setDoor(d: Door | null) {
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* this visit only */ }
}
// FALCON's own company when no code was typed (a sign-in of before); never shown.
const OWN = (import.meta.env.VITE_FALCON_COMPANY_CODE as string | undefined)?.trim().toUpperCase() || 'RCL';
export const doorCompany = () => getDoor()?.company || OWN;
// What the server is told: the code typed (a company's, or a contractor's – the server finds its company).
export const doorCode = () => getDoor()?.code;
