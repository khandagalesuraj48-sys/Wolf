// (25-11-2026, his word: FALCON said 5.9 km, Google Maps 12 km by road) the distance by road – made-up places only
import { describe, expect, it, beforeEach } from 'vitest';
import { answer, body, forget, point, road, roundFrom, roundTo, ROUTES_URL } from './road.js';
import { tooMany } from '../route.js';

const from = { lat: 19.29871, lng: 73.05432 }, to = { lat: 19.30219, lng: 73.11876 };
function google(json, ok = true) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok, json: async () => json }; };
  return { f, calls };
}

describe('the distance by road', () => {
  beforeEach(() => forget());
  it('asks Google for the road (driving, no live traffic) with only the two points – his to about 100 m', async () => {
    const g = google({ routes: [{ distanceMeters: 12034, duration: '1820s' }] });
    expect(await road(from, to, 'k', { fetchImpl: g.f })).toEqual({ metres: 12034, seconds: 1820 });
    expect(g.calls[0].url).toBe(ROUTES_URL);
    expect(g.calls[0].init.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    const sent = JSON.parse(g.calls[0].init.body);
    expect(sent.origin.location.latLng).toEqual({ latitude: 19.299, longitude: 73.054 });
    expect(sent.destination.location.latLng).toEqual({ latitude: 19.30219, longitude: 73.11876 });
    expect([sent.travelMode, sent.routingPreference]).toEqual(['DRIVE', 'TRAFFIC_UNAWARE']);
  });
  it('the same way within 10 minutes is not asked again; after it is', async () => {
    const g = google({ routes: [{ distanceMeters: 100, duration: '20s' }] });
    await road(from, to, 'k', { fetchImpl: g.f, now: 0 });
    await road({ lat: 19.2989, lng: 73.0541 }, to, 'k', { fetchImpl: g.f, now: 60000 });
    expect(g.calls.length).toBe(1);
    await road(from, to, 'k', { fetchImpl: g.f, now: 11 * 60000 });
    expect(g.calls.length).toBe(2);
  });
  it('no key: said plainly; Google refused: said; no road: null', async () => {
    await expect(road(from, to, '')).rejects.toThrow(/GOOGLE_ROUTES_KEY/);
    await expect(road(from, to, 'k', { fetchImpl: google({}, false).f })).rejects.toThrow(/straight line/);
    expect(await road(from, to, 'k', { fetchImpl: google({}).f })).toBeNull();
    expect(answer({ routes: [{ distanceMeters: 5 }] })).toEqual({ metres: 5, seconds: null });
  });
  it('a place must be a place; rounding; the body', () => {
    expect(point({ lat: '19.1', lng: 73 })).toEqual({ lat: 19.1, lng: 73 });
    expect([point({ lat: 91, lng: 0 }), point({}), point(null)]).toEqual([null, null, null]);
    expect(roundFrom({ lat: 19.29871, lng: 73.05432 })).toEqual({ lat: 19.299, lng: 73.054 });
    expect(roundTo({ lat: 19.302191, lng: 73.118761 })).toEqual({ lat: 19.30219, lng: 73.11876 });
    expect(body(from, to).travelMode).toBe('DRIVE');
  });
  it('at most 60 questions a person in 10 minutes', () => {
    for (let i = 0; i < 60; i++) expect(tooMany('p1', 1000 + i)).toBe(false);
    expect(tooMany('p1', 2000)).toBe(true);
    expect(tooMany('p2', 2000)).toBe(false);
    expect(tooMany('p1', 1000 + 11 * 60000)).toBe(false);
  });
});
