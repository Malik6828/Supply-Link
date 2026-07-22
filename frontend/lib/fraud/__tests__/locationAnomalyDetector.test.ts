import { describe, it, expect } from 'vitest';
import {
  detectLocationAnomalies,
  haversineDistance,
  resolveLocation,
} from '../locationAnomalyDetector';

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('approximates the New York to London distance', () => {
    const dist = haversineDistance(40.7128, -74.006, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5500);
    expect(dist).toBeLessThan(5600);
  });
});

describe('resolveLocation', () => {
  it('resolves exact known location names', () => {
    const loc = resolveLocation('new york');
    expect(loc).not.toBeNull();
    expect(loc!.name).toBe('New York');
  });

  it('resolves case-insensitive names', () => {
    expect(resolveLocation('LONDON')).not.toBeNull();
    expect(resolveLocation('Tokyo')).not.toBeNull();
  });

  it('parses lat,lng format', () => {
    const loc = resolveLocation('40.7128,-74.006');
    expect(loc).not.toBeNull();
    expect(loc!.lat).toBeCloseTo(40.7128);
    expect(loc!.lng).toBeCloseTo(-74.006);
  });

  it('returns null for completely unknown strings', () => {
    expect(resolveLocation('ZZZ_UNKNOWN_PLACE_XYZ')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveLocation('')).toBeNull();
  });
});

describe('detectLocationAnomalies', () => {
  it('returns no anomalies for single event', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 1000, location: 'new york' },
    ]);
    expect(result.anomaliesDetected).toBe(0);
    expect(result.riskLevel).toBe('low');
  });

  it('returns no anomalies for empty events', () => {
    const result = detectLocationAnomalies('prod-1', []);
    expect(result.anomaliesDetected).toBe(0);
  });

  it('ignores events without location', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 1000, location: '' },
      { eventType: 'PROCESSING', timestamp: 2000, location: '' },
    ]);
    expect(result.anomaliesDetected).toBe(0);
  });

  it('ignores events in the same location', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 1000, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 5000, location: 'new york' },
    ]);
    expect(result.anomaliesDetected).toBe(0);
  });

  it('flags impossible travel between New York and London in 60 seconds', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 0, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 60, location: 'london' },
    ]);
    expect(result.anomaliesDetected).toBeGreaterThan(0);
    expect(['high', 'critical']).toContain(result.riskLevel);
  });

  it('flags an alert with correct structure', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 0, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 60, location: 'london' },
    ]);
    const alert = result.alerts[0];
    expect(alert.fromLocation).toBe('new york');
    expect(alert.toLocation).toBe('london');
    expect(alert.distanceKm).toBeGreaterThan(5000);
    expect(alert.requiredSpeedKph).toBeGreaterThan(950);
  });

  it('allows realistic air travel between NY and London in 10 hours', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 0, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 36000, location: 'london' }, // 10 hours
    ]);
    expect(result.anomaliesDetected).toBe(0);
  });

  it('sets riskLevel to critical for extreme anomaly', () => {
    const result = detectLocationAnomalies('prod-1', [
      { eventType: 'HARVEST', timestamp: 0, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 1, location: 'tokyo' }, // 1 second for ~10,800 km
    ]);
    expect(result.riskLevel).toBe('critical');
  });

  it('returns correct productId and totalEvents', () => {
    const result = detectLocationAnomalies('prod-xyz', [
      { eventType: 'HARVEST', timestamp: 0, location: 'new york' },
      { eventType: 'PROCESSING', timestamp: 10000, location: 'chicago' },
    ]);
    expect(result.productId).toBe('prod-xyz');
    expect(result.totalEvents).toBe(2);
  });
});
