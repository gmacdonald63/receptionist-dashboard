import { describe, it, expect } from 'vitest';
import { haversineMeters, shouldWriteLocation, isSaneSpeed } from '../locationService.js';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(43.6532, -79.3832, 43.6532, -79.3832)).toBe(0);
  });
  it('returns ~111km per degree of latitude', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  it('returns distance between two Toronto-area points (~3-5km)', () => {
    const d = haversineMeters(43.6532, -79.3832, 43.6800, -79.3400);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(5000);
  });
});

describe('shouldWriteLocation', () => {
  it('returns true when no previous location exists', () => {
    expect(shouldWriteLocation(null, null, 43.6532, -79.3832)).toBe(true);
  });
  it('returns true when moved >=50 meters (~5 lat hundredths)', () => {
    expect(shouldWriteLocation(43.6532, -79.3832, 43.6537, -79.3832)).toBe(true);
  });
  it('returns false when moved <50 meters (~1 lat hundredth)', () => {
    expect(shouldWriteLocation(43.6532, -79.3832, 43.6533, -79.3832)).toBe(false);
  });
});

describe('isSaneSpeed', () => {
  it('returns true for null (stationary)', () => { expect(isSaneSpeed(null)).toBe(true); });
  it('returns true for 0 km/h', () => { expect(isSaneSpeed(0)).toBe(true); });
  it('returns true for 120 km/h (highway)', () => { expect(isSaneSpeed(120)).toBe(true); });
  it('returns false for 201 km/h (GPS noise)', () => { expect(isSaneSpeed(201)).toBe(false); });
});
