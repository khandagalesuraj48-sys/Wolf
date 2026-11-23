// The Google map (23-11-2026, his decision: "map lauya" – with the ERP's own Google Maps key, VITE_GOOGLE_MAPS_KEY in Vercel; the
// pictures N2–N5). It shows FALCON's own points: you, the mess, the van, the sections. When the key is not set, Google cannot be
// reached, or no point has a place yet, the drawn road of before is shown instead (`fallback`) – a map never breaks a screen.
// Only the Maps JavaScript API is used (the key's own APIs); distances are straight lines, the road route opens in Google Maps.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Pt } from '../lib/geo';

export type MarkKind = 'you' | 'mess' | 'van' | 'stop' | 'done' | 'mine';
export interface Mark extends Pt { kind: MarkKind; label?: string; title?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G = any;
declare global { interface Window { __falconMaps?: () => void; google?: G } }

const KEY = String(import.meta.env.VITE_GOOGLE_MAPS_KEY || '').trim();
export const mapsOn = () => KEY.length > 20;
let loading: Promise<G | null> | null = null;
function loadMaps(): Promise<G | null> {
  if (!mapsOn()) return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise((res) => {
    if (window.google?.maps?.Map) return res(window.google.maps);
    const done = setTimeout(() => res(null), 15000);                 // no answer: the drawn road
    window.__falconMaps = () => { clearTimeout(done); res(window.google?.maps || null); };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(KEY) + '&v=weekly&loading=async&callback=__falconMaps';
    s.async = true;
    s.onerror = () => { clearTimeout(done); res(null); };
    document.head.appendChild(s);
  });
  return loading;
}

const NIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#1F2A38' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#9AA6B5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1F2A38' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414E' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263C' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];
const LOOK: Record<MarkKind, { fill: string; scale: number }> = {
  you: { fill: '#1A73E8', scale: 8 }, mess: { fill: '#EA4335', scale: 11 }, van: { fill: '#C2560E', scale: 14 },
  stop: { fill: '#0E1B33', scale: 11 }, done: { fill: '#2F7A45', scale: 11 }, mine: { fill: '#C2560E', scale: 12 },
};

export function GMap({ marks, line, ring, height = 240, dark = false, label, fallback, style }: {
  marks: Mark[]; line?: Pt[]; ring?: { center: Pt; metres: number }; height?: number | string; dark?: boolean; label: string; fallback: ReactNode;
  style?: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [g, setG] = useState<G | null | undefined>(mapsOn() && marks.length ? undefined : null);
  const map = useRef<G>(null), drawn = useRef<G[]>([]), fitted = useRef('');
  // drawn again only when a point really changes; the view is fitted again only when the set of points changes (a moving van
  // keeps the zoom the person chose)
  const sig = JSON.stringify([marks, line, ring, dark]);
  const fitKey = marks.map((m) => m.kind + (m.label || '')).join('|') + ':' + (line?.length || 0) + ':' + (ring ? ring.metres : 0);
  useEffect(() => {
    if (!marks.length) { setG(null); return; }
    let gone = false;
    loadMaps().then((m) => { if (!gone) setG(m); });
    return () => { gone = true; };
  }, [marks.length]);
  useEffect(() => {
    if (!g || !box.current) return;
    if (!map.current) {
      map.current = new g.Map(box.current, { disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false,
        styles: dark ? NIGHT : undefined, backgroundColor: dark ? '#1F2A38' : '#EEF0EB' });
    }
    drawn.current.forEach((x) => x.setMap(null)); drawn.current = [];
    const bounds = new g.LatLngBounds();
    if (ring) {
      drawn.current.push(new g.Circle({ map: map.current, center: ring.center, radius: ring.metres, strokeColor: '#2F7A45', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#2F7A45', fillOpacity: 0.12 }));
    }
    if (line && line.length > 1) {
      drawn.current.push(new g.Polyline({ map: map.current, path: line, strokeColor: '#FFFFFF', strokeWeight: 9, strokeOpacity: 1 }));
      drawn.current.push(new g.Polyline({ map: map.current, path: line, strokeColor: dark ? '#4A90F0' : '#1A73E8', strokeWeight: 5, strokeOpacity: 1 }));
      line.forEach((p) => bounds.extend(p));
    }
    marks.forEach((m) => {
      const l = LOOK[m.kind];
      drawn.current.push(new g.Marker({ map: map.current, position: { lat: m.lat, lng: m.lng }, title: m.title || m.label || '',
        icon: { path: g.SymbolPath.CIRCLE, scale: l.scale, fillColor: l.fill, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 3 },
        label: m.label ? { text: m.label.slice(0, 4), color: '#FFFFFF', fontSize: '10px', fontWeight: '700' } : undefined,
        zIndex: m.kind === 'you' || m.kind === 'van' ? 10 : 5 }));
      bounds.extend({ lat: m.lat, lng: m.lng });
    });
    if (fitted.current !== fitKey) {
      fitted.current = fitKey;
      const pts = marks.length + (line?.length || 0);
      if (pts > 1) map.current.fitBounds(bounds, 48);
      else if (marks[0]) { map.current.setCenter({ lat: marks[0].lat, lng: marks[0].lng }); map.current.setZoom(16); }
      if (ring && pts <= 2) { const c = new g.Circle({ center: ring.center, radius: ring.metres * 2.2 }); map.current.fitBounds(c.getBounds(), 8); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, sig]);
  if (g === null) return <>{fallback}</>;
  return <div ref={box} role="img" aria-label={label} style={{ width: '100%', height, background: dark ? '#1F2A38' : '#EEF0EB', ...style }} />;
}

// a place with both numbers, or null
export const pt = (lat: unknown, lng: unknown): Pt | null =>
  lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) ? null : { lat: Number(lat), lng: Number(lng) };
