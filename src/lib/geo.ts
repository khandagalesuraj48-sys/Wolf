// Where the person is (23-11-2026, his word: "app swata check krel user kuthe aahe – mess location madhe to asel tr mess ch auto yeil,
// mess pasun lamb asel tr mess che direction kiti lamb te dakhwel ani auto parcel"). The phone's own location, read only while a
// screen that needs it is open; it never leaves the phone (nothing of it is saved or sent).
import { useEffect, useState } from 'react';

export interface Pt { lat: number; lng: number }
export interface Place extends Pt { acc: number }
export type PlaceState = { state: 'asking' } | { state: 'off'; why: 'denied' | 'none' } | ({ state: 'ok' } & Place);

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

// Google Maps' own directions page – opens the Maps app on a phone; no key and nothing of the person is sent but the mess's point.
export const directionsUrl = (p: Pt) => 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6);

export function usePlace(on = true): PlaceState & { ask: () => void } {
  const [st, setSt] = useState<PlaceState>({ state: 'asking' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setSt({ state: 'off', why: 'none' }); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => setSt({ state: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
      (e) => setSt({ state: 'off', why: e.code === 1 ? 'denied' : 'none' }),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [on, tick]);
  return { ...st, ask: () => { setSt({ state: 'asking' }); setTick((x) => x + 1); } };
}
