// Where the person is (23-11-2026, his word: "app swata check krel user kuthe aahe – mess location madhe to asel tr mess ch auto yeil,
// mess pasun lamb asel tr mess che direction kiti lamb te dakhwel ani auto parcel"). The phone's own location, read only while a
// screen that needs it is open. It leaves the phone only with a van order (23-11-2026, his word: "only section … section che baheun
// koni kel asel tr … location direction he sagle hot jail"): the server finds the section whose area holds it, and keeps the point
// with that order only when it is inside no section – for the kitchen's and the driver's directions. Nothing else of it is sent.
import { useEffect, useRef, useState } from 'react';

export interface Pt { lat: number; lng: number }
export interface Place extends Pt { acc: number }
export type PlaceState = { state: 'asking' } | { state: 'off'; why: 'denied' | 'none' } | ({ state: 'ok' } & Place);

// (25-11-2026, his word: "kal pahile mess pasun 20 km lamb hoto but app sangat hote 5 km … ekdm perfect") a reading is EXACT within this
// many metres – a reading by the mobile towers alone (indoors, no GPS yet) can be kilometres off. Only an exact reading tells how far the
// mess is, whether he is at it, his section or the van's point; a rough one only says "finding your exact place (± …)". As the phone app.
export const PLACE_EXACT = 100;
export const isExact = (p: PlaceState): boolean => p.state === 'ok' && p.acc >= 0 && p.acc <= PLACE_EXACT;

// A new reading of [acc] m is taken – unless the one there is exact and of the last 30 s and the new one is not exact.
export const placeTakes = (wasExact: boolean, atMs: number, acc: number, nowMs: number) => !wasExact || (acc >= 0 && acc <= PLACE_EXACT) || nowMs - atMs > 30000;

// (25-11-2026, his word: "jar mi outside asel mess pasun at the mess option band asel tyala parcel gheyla lagel") "At the mess" or
// "Parcel": outside the mess area (an exact reading) Parcel only, whatever he chose; at it, the mess unless he chose Parcel.
export const placeMode = (pick: 'mess' | 'parcel' | null, here: boolean | null): 'mess' | 'parcel' | null =>
  here === false ? 'parcel' : pick || (here === true ? 'mess' : null);

// metres between two points (the straight line – the road may be longer)
export function metres(a: Pt, b: Pt): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
export const distText = (m: number) => (m < 1000 ? m + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km');

// At the mess: inside its area (the metres the Site Admin set), the phone's own uncertainty counted up to 50 m.
export function atMess(me: Place, mess: { lat: number | null; lng: number | null; radius_m: number | null }): boolean | null {
  if (mess.lat == null || mess.lng == null) return null;
  return metres(me, { lat: Number(mess.lat), lng: Number(mess.lng) }) - Math.min(me.acc || 0, 50) <= (mess.radius_m || 100);
}

// The section whose area holds the point – the nearest when two do; null: inside no section (the server's own rule:
// public.section_at). A section without its place or its metres is never found by a point.
export interface Area { id: string; lat: number | null; lng: number | null; radius_m: number | null; code: string }
export function sectionAt<T extends Area>(me: Pt, secs: T[]): T | null {
  let best: T | null = null, bd = Infinity;
  for (const x of secs) {
    if (x.lat == null || x.lng == null || x.radius_m == null) continue;
    const d = metres(me, { lat: Number(x.lat), lng: Number(x.lng) });
    if (d <= x.radius_m && (d < bd || (d === bd && best && x.code < best.code))) { best = x; bd = d; }
  }
  return best;
}

// Google Maps' own directions page – opens the Maps app on a phone; no key and nothing of the person is sent but the point it goes to.
export const directionsUrl = (p: Pt) => 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6);

export function usePlace(on = true): PlaceState & { ask: () => void } {
  const [st, setSt] = useState<PlaceState>({ state: 'asking' });
  const [tick, setTick] = useState(0);
  const last = useRef({ exact: false, at: 0 });
  useEffect(() => {
    if (!on) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setSt({ state: 'off', why: 'none' }); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const acc = Math.round(p.coords.accuracy || 0), now = Date.now();
        // (25-11-2026) a rough reading does not push out an exact one of the last 30 s
        if (!placeTakes(last.current.exact, last.current.at, acc, now)) return;
        last.current = { exact: acc >= 0 && acc <= PLACE_EXACT, at: now };
        setSt({ state: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, acc });
      },
      (e) => setSt({ state: 'off', why: e.code === 1 ? 'denied' : 'none' }),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [on, tick]);
  return { ...st, ask: () => { setSt({ state: 'asking' }); setTick((x) => x + 1); } };
}
