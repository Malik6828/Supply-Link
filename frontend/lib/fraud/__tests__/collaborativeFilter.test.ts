import { describe, it, expect } from 'vitest';
import { detectCrossProductFraud } from '../collaborativeFilter';
import type { ProductEventSummary } from '../collaborativeFilter';

function buildProducts(
  defs: Array<{
    productId: string;
    events: Array<{ eventType: string; timestamp: number; actor?: string }>;
    isSuspicious?: boolean;
  }>,
): Map<string, ProductEventSummary> {
  const map = new Map<string, ProductEventSummary>();
  for (const d of defs) {
    map.set(d.productId, { events: d.events, isSuspicious: d.isSuspicious ?? false });
  }
  return map;
}

describe('detectCrossProductFraud', () => {
  it('returns low risk for a single clean product', () => {
    const products = buildProducts([
      {
        productId: 'p1',
        events: [
          { eventType: 'HARVEST', timestamp: 0, actor: 'alice' },
          { eventType: 'RETAIL', timestamp: 100000, actor: 'bob' },
        ],
      },
    ]);
    const result = detectCrossProductFraud(products);
    expect(result.riskLevel).toBe('low');
    expect(result.highRiskActors.length).toBe(0);
  });

  it('returns correct analyzedProducts count', () => {
    const products = buildProducts([
      { productId: 'p1', events: [] },
      { productId: 'p2', events: [] },
    ]);
    const result = detectCrossProductFraud(products);
    expect(result.analyzedProducts).toBe(2);
  });

  it('flags actor present in many suspicious products', () => {
    const sharedActor = 'fraud-ring-actor';
    const products = buildProducts(
      Array.from({ length: 10 }, (_, i) => ({
        productId: `p${i}`,
        isSuspicious: true,
        events: [
          { eventType: 'HARVEST', timestamp: i * 1000, actor: sharedActor },
          { eventType: 'RETAIL', timestamp: i * 1000 + 100, actor: sharedActor },
        ],
      })),
    );
    const result = detectCrossProductFraud(products);
    const flagged = result.highRiskActors.find((a) => a.actorAddress === sharedActor);
    expect(flagged).toBeDefined();
    expect(flagged!.riskScore).toBeGreaterThan(0);
  });

  it('flags actor operating across all four stages', () => {
    const omnipresent = 'omni-actor';
    const products = buildProducts([
      {
        productId: 'p1',
        isSuspicious: true,
        events: [
          { eventType: 'HARVEST', timestamp: 0, actor: omnipresent },
          { eventType: 'PROCESSING', timestamp: 3600, actor: omnipresent },
          { eventType: 'SHIPPING', timestamp: 7200, actor: omnipresent },
          { eventType: 'RETAIL', timestamp: 100000, actor: omnipresent },
        ],
      },
    ]);
    const result = detectCrossProductFraud(products);
    const flagged = result.highRiskActors.find((a) => a.actorAddress === omnipresent);
    expect(flagged).toBeDefined();
    expect(flagged!.behaviorPatterns.some((p) => p.includes('all supply chain stages'))).toBe(true);
  });

  it('sorts highRiskActors by riskScore descending', () => {
    const omnipresent = 'omni';
    const products = buildProducts(
      Array.from({ length: 15 }, (_, i) => ({
        productId: `p${i}`,
        isSuspicious: i % 2 === 0,
        events: [
          {
            eventType:
              i % 4 === 0
                ? 'HARVEST'
                : i % 4 === 1
                  ? 'PROCESSING'
                  : i % 4 === 2
                    ? 'SHIPPING'
                    : 'RETAIL',
            timestamp: i * 1000,
            actor: omnipresent,
          },
        ],
      })),
    );
    const result = detectCrossProductFraud(products);
    const scores = result.highRiskActors.map((a) => a.riskScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('networkRiskScore equals max actor riskScore when actors exist', () => {
    const omnipresent = 'omni';
    const products = buildProducts(
      Array.from({ length: 20 }, (_, i) => ({
        productId: `p${i}`,
        isSuspicious: true,
        events: [
          { eventType: 'HARVEST', timestamp: i * 10, actor: omnipresent },
          { eventType: 'PROCESSING', timestamp: i * 10 + 5, actor: omnipresent },
          { eventType: 'SHIPPING', timestamp: i * 10 + 8, actor: omnipresent },
          { eventType: 'RETAIL', timestamp: i * 10 + 9, actor: omnipresent },
        ],
      })),
    );
    const result = detectCrossProductFraud(products);
    if (result.highRiskActors.length > 0) {
      const maxScore = Math.max(...result.highRiskActors.map((a) => a.riskScore));
      expect(result.networkRiskScore).toBe(maxScore);
    }
  });

  it('returns low risk and zero actors for empty map', () => {
    const result = detectCrossProductFraud(new Map());
    expect(result.riskLevel).toBe('low');
    expect(result.highRiskActors.length).toBe(0);
    expect(result.networkRiskScore).toBe(0);
  });
});
