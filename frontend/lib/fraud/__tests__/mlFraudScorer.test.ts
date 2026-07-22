import { describe, it, expect } from 'vitest';
import { extractFeatures, scoreFraud } from '../mlFraudScorer';

const cleanEvents = [
  { eventType: 'HARVEST', timestamp: 0, actor: 'alice', location: 'farm' },
  { eventType: 'PROCESSING', timestamp: 7200, actor: 'bob', location: 'factory' },
  { eventType: 'SHIPPING', timestamp: 90000, actor: 'carol', location: 'port' },
  { eventType: 'RETAIL', timestamp: 200000, actor: 'dave', location: 'warehouse' },
];

const suspiciousEvents = [
  { eventType: 'HARVEST', timestamp: 0, actor: 'eve', location: 'farm' },
  { eventType: 'RETAIL', timestamp: 10, actor: 'eve', location: 'warehouse' }, // skips everything, 10s
];

describe('extractFeatures', () => {
  it('returns Infinity for single event', () => {
    const f = extractFeatures([{ eventType: 'HARVEST', timestamp: 1000 }]);
    expect(f.avgTimeBetweenEvents).toBe(Infinity);
    expect(f.minTimeBetweenEvents).toBe(Infinity);
  });

  it('computes correct avgTimeBetweenEvents', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 0 },
      { eventType: 'PROCESSING', timestamp: 100 },
      { eventType: 'SHIPPING', timestamp: 300 },
    ];
    const f = extractFeatures(events);
    expect(f.avgTimeBetweenEvents).toBe(150); // (100 + 200) / 2
  });

  it('computes actorConsistencyScore = 1 when all same actor', () => {
    const events = cleanEvents.map((e) => ({ ...e, actor: 'alice' }));
    const f = extractFeatures(events);
    expect(f.actorConsistencyScore).toBe(1);
  });

  it('computes stageProgressionScore = 1 for perfectly ordered events', () => {
    const f = extractFeatures(cleanEvents);
    expect(f.stageProgressionScore).toBe(1);
  });

  it('computes stageProgressionScore < 1 for regression', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 0 },
      { eventType: 'SHIPPING', timestamp: 100 },
      { eventType: 'PROCESSING', timestamp: 200 }, // regression
    ];
    const f = extractFeatures(events);
    expect(f.stageProgressionScore).toBeLessThan(1);
  });

  it('computes locationCoverageRatio correctly', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 0, location: 'farm' },
      { eventType: 'PROCESSING', timestamp: 100 },
    ];
    const f = extractFeatures(events);
    expect(f.locationCoverageRatio).toBe(0.5);
  });

  it('counts rapid transitions correctly', () => {
    // HARVEST→PROCESSING minimum is 3600s; 10s < 3600
    const events = [
      { eventType: 'HARVEST', timestamp: 0 },
      { eventType: 'PROCESSING', timestamp: 10 },
    ];
    const f = extractFeatures(events);
    expect(f.rapidTransitionCount).toBe(1);
  });
});

describe('scoreFraud', () => {
  it('returns 0–100 fraud score', () => {
    const result = scoreFraud('prod-1', cleanEvents);
    expect(result.fraudScore).toBeGreaterThanOrEqual(0);
    expect(result.fraudScore).toBeLessThanOrEqual(100);
  });

  it('assigns low risk level to clean events', () => {
    const result = scoreFraud('prod-1', cleanEvents);
    expect(['low', 'medium']).toContain(result.riskLevel);
  });

  it('assigns higher fraud score to suspicious events', () => {
    const cleanResult = scoreFraud('prod-1', cleanEvents);
    const suspiciousResult = scoreFraud('prod-2', suspiciousEvents);
    expect(suspiciousResult.fraudScore).toBeGreaterThan(cleanResult.fraudScore);
  });

  it('assigns critical or high risk to extremely suspicious events', () => {
    const result = scoreFraud('prod-2', suspiciousEvents);
    expect(['high', 'critical']).toContain(result.riskLevel);
  });

  it('includes riskFactors when score is elevated', () => {
    const result = scoreFraud('prod-2', suspiciousEvents);
    expect(result.riskFactors.length).toBeGreaterThan(0);
  });

  it('returns confidence in 0–1 range', () => {
    const result = scoreFraud('prod-1', cleanEvents);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns the correct productId', () => {
    const result = scoreFraud('abc-123', cleanEvents);
    expect(result.productId).toBe('abc-123');
  });

  it('handles empty events gracefully', () => {
    const result = scoreFraud('prod-empty', []);
    expect(result.fraudScore).toBeGreaterThanOrEqual(0);
    expect(result.fraudScore).toBeLessThanOrEqual(100);
  });
});
