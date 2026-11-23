// How numbers, money, days and times are shown – India, the site's clock.
const TZ = 'Asia/Kolkata';

export const inr = (n: number | null | undefined, sign = true) =>
  n == null ? '–' : (sign ? '₹' : '') + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const num = (n: number | null | undefined) => (n == null ? '–' : Number(n).toLocaleString('en-IN'));

export const time = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '–';
export const day = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00+05:30' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ }) : '–';
export const dayLong = (d: string | Date) =>
  new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00+05:30' : d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
export const monthName = (d: string) => new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TZ });

// (23-11-2026, his word: "day night auto select asel server time asel") the SERVER's clock, not the phone's: the difference is
// taken once from the server (GET /api/start) and every "now" below follows it – a phone with a wrong time still sees the right meal.
let skew = 0;
export const serverNow = () => Date.now() + skew;
export function setSkew(serverMs: number, sentAt: number, gotAt: number) {
  if (!Number.isFinite(serverMs) || gotAt < sentAt) return;
  skew = Math.round(serverMs + (gotAt - sentAt) / 2 - gotAt);
}
export async function syncClock(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const sent = Date.now();
    const r = await fetchImpl('/api/start', { method: 'GET', cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    if (j && typeof j.now === 'string') setSkew(new Date(j.now).getTime(), sent, Date.now());
  } catch { /* no answer: the phone's own clock until the next try */ }
}

// Today on the site's clock, as YYYY-MM-DD.
export function today(offsetDays = 0): string {
  const d = new Date(serverNow() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
export const nowHM = () => new Date(serverNow()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

export function greeting(): string {
  const h = Number(new Date(serverNow()).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const initials = (name: string | null | undefined) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
export const firstName = (name: string | null | undefined) => (name || '').split(/\s+/)[0] || '';

export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type Meal = (typeof MEALS)[number];
export const mealName = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
export const mealIcon: Record<string, string> = { breakfast: 'coffee', lunch: 'soup', snacks: 'cookie', dinner: 'moon' };

export const minutesLeft = (ts: string) => Math.round((new Date(ts).getTime() - serverNow()) / 60000);
export const leftText = (ts: string) => {
  const m = minutesLeft(ts);
  if (m < 0) return 'late by ' + (m > -60 ? -m + ' min' : Math.round(-m / 60) + ' h');
  return m < 60 ? m + ' min left' : Math.round(m / 60) + ' h left';
};

export const maskMobile = (m: string | null | undefined) => (m ? m.slice(0, 3) + ' ' + m.slice(3, 5) + 'XXX XX' + m.slice(-3) : '–');
