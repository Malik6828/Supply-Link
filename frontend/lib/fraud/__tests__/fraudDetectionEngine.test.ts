import { describe, it, expect, vi } from 'vitest';
import { FraudDetectionEngine } from '../fraudDetectionEngine';
import { AlertSystem } from '../alertSystem';
import type { ProductEvent } from '../fraudDetectionEngine';

const cleanEvents: ProductEvent[] = [
  { eventType: 'HARVEST', timestamp: 0, actor: 'alice', location: 'farm' },
  { eventType: 'PROCESSING', timestamp: 7200, actor: 'bob', location: 'factory' },
  { eventType: 'SHIPPING', timestamp: 90000, actor: 'carol', location: 'port' },
  { eventType: 'RETAIL', timestamp: 200000, actor: 'dave', location: 'warehouse' },
];

const fraudEvents: ProductEvent[] = [
  { eventType: 'HARVEST', timestamp: 0, actor: 'eve' },
  { eventType: 'RETAIL', timestamp: 10, actor: 'eve' }, // 10 seconds, skips everything
];

describe('FraudDetectionEngine.analyzeProduct', () => {
  it('returns correct productId in result', () => {
    const engine = new FraudDetectionEngine();
    const result = engine.analyzeProduct('prod-123', cleanEvents);
    expect(result.productId).toBe('prod-123');
  });

  it('produces low overall risk for clean events', () => {
    const engine = new FraudDetectionEngine();
    const result = engine.analyzeProduct('clean', cleanEvents);
    expect(['low', 'medium']).toContain(result.overallRiskLevel);
  });

  it('produces elevated risk for clearly fraudulent events', () => {
    const engine = new FraudDetectionEngine();
    const result = engine.analyzeProduct('fraud', fraudEvents);
    expect(['medium', 'high', 'critical']).toContain(result.overallRiskLevel);
    expect(result.overallFraudScore).toBeGreaterThan(20);
  });

  it('fraud score is higher for fraud events than clean events', () => {
    const engine = new FraudDetectionEngine();
    const cleanResult = engine.analyzeProduct('clean', cleanEvents);
    const fraudResult = engine.analyzeProduct('fraud', fraudEvents);
    expect(fraudResult.overallFraudScore).toBeGreaterThan(cleanResult.overallFraudScore);
  });

  it('emits alerts for fraud events', () => {
    const alertSystem = new AlertSystem({ speedAnomalyMinSeverity: 'low' });
    const engine = new FraudDetectionEngine({}, alertSystem);
    engine.analyzeProduct('fraud', fraudEvents);
    expect(alertSystem.getAlerts().length).toBeGreaterThan(0);
  });

  it('respects enableSpeedDetection = false', () => {
    const engine = new FraudDetectionEngine({ enableSpeedDetection: false });
    const result = engine.analyzeProduct('test', fraudEvents);
    expect(result.speedAnomalyResult.anomaliesDetected).toBe(0);
  });

  it('respects enablePatternDetection = false', () => {
    const engine = new FraudDetectionEngine({ enablePatternDetection: false });
    const result = engine.analyzeProduct('test', fraudEvents);
    expect(result.patternDetectionResult.patternsDetected).toBe(0);
  });

  it('overallFraudScore is in 0–100 range', () => {
    const engine = new FraudDetectionEngine();
    const result = engine.analyzeProduct('test', fraudEvents);
    expect(result.overallFraudScore).toBeGreaterThanOrEqual(0);
    expect(result.overallFraudScore).toBeLessThanOrEqual(100);
  });

  it('includes analysisTimestamp', () => {
    const engine = new FraudDetectionEngine();
    const result = engine.analyzeProduct('test', cleanEvents);
    expect(result.analysisTimestamp).toBeTruthy();
    expect(new Date(result.analysisTimestamp).toString()).not.toBe('Invalid Date');
  });
});

describe('FraudDetectionEngine.analyzeNetwork', () => {
  it('returns results for all products', () => {
    const engine = new FraudDetectionEngine();
    const allProducts = new Map<string, ProductEvent[]>([
      ['clean', cleanEvents],
      ['fraud', fraudEvents],
    ]);
    const result = engine.analyzeNetwork(allProducts);
    expect(result.productResults.size).toBe(2);
    expect(result.productResults.has('clean')).toBe(true);
    expect(result.productResults.has('fraud')).toBe(true);
  });

  it('includes collaborativeFilterResult with analyzed product count', () => {
    const engine = new FraudDetectionEngine();
    const allProducts = new Map<string, ProductEvent[]>([
      ['p1', cleanEvents],
      ['p2', fraudEvents],
    ]);
    const result = engine.analyzeNetwork(allProducts);
    expect(result.collaborativeFilterResult.analyzedProducts).toBe(2);
  });

  it('networkRiskLevel is elevated when fraud product is in the network', () => {
    const engine = new FraudDetectionEngine();
    const allProducts = new Map<string, ProductEvent[]>([
      ['clean', cleanEvents],
      ['fraud', fraudEvents],
    ]);
    const result = engine.analyzeNetwork(allProducts);
    expect(['medium', 'high', 'critical']).toContain(result.networkRiskLevel);
  });

  it('emits collaborative alerts for high-risk actors across many products', () => {
    const alertSystem = new AlertSystem({ collaborativeRiskThreshold: 1 });
    const engine = new FraudDetectionEngine({ enableCollaborativeFiltering: true }, alertSystem);
    const sharedActor = 'fraud-ring';
    const allProducts = new Map<string, ProductEvent[]>(
      Array.from({ length: 15 }, (_, i) => [
        `p${i}`,
        [
          { eventType: 'HARVEST', timestamp: i * 1000, actor: sharedActor },
          { eventType: 'PROCESSING', timestamp: i * 1000 + 1, actor: sharedActor },
          { eventType: 'SHIPPING', timestamp: i * 1000 + 2, actor: sharedActor },
          { eventType: 'RETAIL', timestamp: i * 1000 + 3, actor: sharedActor },
        ],
      ]),
    );
    engine.analyzeNetwork(allProducts);
    const collabAlerts = alertSystem.getAlerts().filter((a) => a.detectorType === 'collaborative');
    expect(collabAlerts.length).toBeGreaterThan(0);
  });
});
