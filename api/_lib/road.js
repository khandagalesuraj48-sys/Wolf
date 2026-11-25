// (25-11-2026, his word with two pictures – FALCON "5.9 km away", Google Maps 12 km: "direction war click kel 12 km ale he as ka problem
// udya aple live tracking map madhun honar aahe van nighali kuthe aahe employee kuth ahe parcel kase deyche te sagle ani app ase ase fake
// imformation denare tr kahich thik nahi chalnar") THE DISTANCE BY ROAD. The app showed the straight line between the two points
// (both points right) – the road is longer. Google's Routes API (computeRoutes, driving, without live traffic – the "Essentials" kind)
// gives the road's metres and minutes. The key (GOOGLE_ROUTES_KEY, Vercel) never leaves this server.
// What goes to Google: the two points only – his rounded to about 100 m (3 decimals), the mess / section / van to about 1 m. Nothing is
// kept but a short memory of the answer (10 minutes, this server only), so the same way is not asked again.
import { Fail } from './http.js';

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// a point as numbers inside the world; null when it is not one
export function point(p) {
  if (!p || typeof p !== 'object' || p.lat == null || p.lng == null || p.lat === '' || p.lng === '') return null;
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// his place to about 100 m (it is only a start of a road); the other end to about 1 m
export const roundFrom = (p) => ({ lat: Math.round(p.lat * 1e3) / 1e3, lng: Math.round(p.lng * 1e3) / 1e3 });
export const roundTo = (p) => ({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 });

export const body = (from, to) => ({
  origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
  destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
  travelMode: 'DRIVE',
  routingPreference: 'TRAFFIC_UNAWARE',
});

// Google's answer → { metres, seconds }; null when Google found no road
export function answer(j) {
  const r = j && Array.isArray(j.routes) ? j.routes[0] : null;
  if (!r) return null;
  const metres = Number(r.distanceMeters), seconds = r.duration ? Number(String(r.duration).replace(/s$/, '')) : NaN;
  if (!Number.isFinite(metres) || metres < 0) return null;
  return { metres: Math.round(metres), seconds: Number.isFinite(seconds) ? Math.round(seconds) : null };
}

const memory = new Map(); // key → { at, v }
const TEN_MIN = 10 * 60 * 1000;
export const forget = () => memory.clear();

// The road between two points – from memory (10 minutes), else from Google. [key]: GOOGLE_ROUTES_KEY.
export async function road(from, to, key, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!key) throw new Fail(503, 'The distance by road is not connected yet (GOOGLE_ROUTES_KEY in Vercel).', 'settings');
  const a = roundFrom(from), b = roundTo(to), k = a.lat + ',' + a.lng + '>' + b.lat + ',' + b.lng;
  const m = memory.get(k);
  if (m && now - m.at < TEN_MIN) return m.v;
  const res = await fetchImpl(ROUTES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
    body: JSON.stringify(body(a, b)),
  });
  if (!res.ok) throw new Fail(502, 'Google did not give the road just now – the straight line is shown.', 'google');
  const v = answer(await res.json());
  if (memory.size > 2000) memory.clear();
  memory.set(k, { at: now, v });
  return v;
}
