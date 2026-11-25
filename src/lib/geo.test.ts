import { describe, expect, it } from 'vitest';
import { sectionAt } from './geo';

// (0017) the phone finds the section by the same rule as the server (public.section_at) – made-up places only
const secs = [
  { id: 'a1', code: 'A1', lat: 19.01, lng: 73, radius_m: 700 },
  { id: 'mjw', code: 'MJW', lat: 19.02, lng: 73, radius_m: 500 },
  { id: 'none', code: 'NOAREA', lat: 19.05, lng: 73, radius_m: null },
  { id: 'noplace', code: 'X', lat: null, lng: null, radius_m: 300 },
];

describe('the section of a point', () => {
  it('a point inside a section is that section', () => {
    expect(sectionAt({ lat: 19.0205, lng: 73 }, secs)?.id).toBe('mjw');
    expect(sectionAt({ lat: 19.0105, lng: 73 }, secs)?.id).toBe('a1');
  });
  it('inside two areas: the nearest', () => {
    expect(sectionAt({ lat: 19.016, lng: 73 }, secs)?.id).toBe('mjw');
  });
  it('a section without its metres or its place is never found by a point', () => {
    expect(sectionAt({ lat: 19.05, lng: 73 }, secs)).toBeNull();
  });
  it('outside every section: none – the order brings the location', () => {
    expect(sectionAt({ lat: 19.1, lng: 73 }, secs)).toBeNull();
  });
});

// (25-11-2026, his words: "20 km lamb hoto but app sangat hote 5 km … ekdm perfect"; "outside … at the mess option band … parcel")
import { isExact, placeMode, placeTakes, PLACE_EXACT } from './geo';
describe('the place: exact readings only; outside the mess – Parcel only', () => {
  it('a reading is exact within 100 m; a tower reading (kilometres) is not', () => {
    expect(PLACE_EXACT).toBe(100);
    expect(isExact({ state: 'ok', lat: 19, lng: 73, acc: 12 })).toBe(true);
    expect(isExact({ state: 'ok', lat: 19, lng: 73, acc: 3000 })).toBe(false);
    expect(isExact({ state: 'asking' })).toBe(false);
  });
  it('a rough reading does not push out an exact one of the last 30 s', () => {
    expect(placeTakes(false, 0, 3000, 1000)).toBe(true);
    expect(placeTakes(true, 0, 3000, 5000)).toBe(false);
    expect(placeTakes(true, 0, 12, 5000)).toBe(true);
    expect(placeTakes(true, 0, 3000, 31000)).toBe(true);
  });
  it('outside: Parcel whatever was chosen; at the mess: the mess unless Parcel; not known: the choice', () => {
    expect([placeMode(null, false), placeMode('mess', false)]).toEqual(['parcel', 'parcel']);
    expect([placeMode(null, true), placeMode('parcel', true)]).toEqual(['mess', 'parcel']);
    expect([placeMode(null, null), placeMode('mess', null)]).toEqual([null, 'mess']);
  });
});
