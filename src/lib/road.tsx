// (25-11-2026, his word with two pictures – FALCON "5.9 km away", Google Maps 12 km: "app ase ase fake imformation denare tr kahich thik
// nahi chalnar") THE DISTANCE BY ROAD, as Google Maps gives it (api/route – Google's Routes API on FALCON's server). The straight line
// between the two points is shown only until the road is there, and then it says so: "5.9 km in a straight line".
// Asked again only when he moved about 100 m or after 5 minutes.
import { useEffect, useState } from 'react';
import { api } from './db';
import { distText, type Pt } from './geo';

export interface Road { metres: number; seconds: number | null }

const memo = new Map<string, { at: number; v: Road | null }>();
const keyOf = (a: Pt, b: Pt) => a.lat.toFixed(3) + ',' + a.lng.toFixed(3) + '>' + b.lat.toFixed(5) + ',' + b.lng.toFixed(5);

export const minutesText = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
};
// "12 km by road · 25 min" – or, without the road yet, "5.9 km in a straight line"
export const roadLabel = (road: Road | null | undefined, straight: number | null) =>
  road ? distText(road.metres) + ' by road' + (road.seconds != null ? ' · ' + minutesText(road.seconds) : '')
    : straight != null ? distText(straight) + ' in a straight line' : '';

export async function roadBetween(from: Pt, to: Pt): Promise<Road | null> {
  const k = keyOf(from, to), m = memo.get(k);
  if (m && Date.now() - m.at < 5 * 60 * 1000) return m.v;
  const r = await api<{ road: Road | null }>('/api/route', { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } });
  memo.set(k, { at: Date.now(), v: r.road });
  return r.road;
}

// the road from → to: undefined while asked (or when it cannot be had – the straight line stays, said as one)
export function useRoad(from: Pt | null, to: Pt | null): Road | null | undefined {
  const [v, setV] = useState<Road | null | undefined>(undefined);
  const k = from && to ? keyOf(from, to) : '';
  useEffect(() => {
    if (!from || !to) { setV(undefined); return; }
    let live = true;
    roadBetween(from, to).then((r) => live && setV(r), () => live && setV(undefined));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return v;
}

// the words, for a list (one road a row)
export function RoadText({ from, to, straight }: { from: Pt | null; to: Pt | null; straight: number | null }) {
  return <>{roadLabel(useRoad(from, to), straight)}</>;
}
