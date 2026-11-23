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
