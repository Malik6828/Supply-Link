import { describe, it, expect } from 'vitest';
import { detectSuspiciousPatterns } from '../patternDetector';

describe('detectSuspiciousPatterns', () => {
  it('returns no patterns for empty event list', () => {
    const result = detectSuspiciousPatterns('prod-1', []);
    expect(result.patternsDetected).toBe(0);
    expect(result.riskLevel).toBe('low');
  });

  it('returns no patterns for a clean linear chain', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000, actor: 'alice' },
      { eventType: 'PROCESSING', timestamp: 10000, actor: 'bob' },
      { eventType: 'SHIPPING', timestamp: 100000, actor: 'carol' },
      { eventType: 'RETAIL', timestamp: 200000, actor: 'dave' },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    expect(result.patternsDetected).toBe(0);
  });

  it('detects duplicate events', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000 },
      { eventType: 'HARVEST', timestamp: 1000 }, // exact duplicate
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const dup = result.patterns.find((p) => p.type === 'duplicate_event');
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe('high');
  });

  it('detects stage regression', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000 },
      { eventType: 'SHIPPING', timestamp: 5000 },
      { eventType: 'PROCESSING', timestamp: 10000 }, // regression
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const reg = result.patterns.find((p) => p.type === 'stage_regression');
    expect(reg).toBeDefined();
    expect(reg!.severity).toBe('high');
  });

  it('detects RETAIL without HARVEST as critical missing_stage', () => {
    const events = [
      { eventType: 'SHIPPING', timestamp: 5000 },
      { eventType: 'RETAIL', timestamp: 10000 },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const missing = result.patterns.find(
      (p) => p.type === 'missing_stage' && p.severity === 'critical',
    );
    expect(missing).toBeDefined();
    expect(result.riskLevel).toBe('critical');
  });

  it('detects RETAIL without SHIPPING as high missing_stage', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000 },
      { eventType: 'RETAIL', timestamp: 5000 },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const missing = result.patterns.find(
      (p) => p.type === 'missing_stage' && p.severity === 'high',
    );
    expect(missing).toBeDefined();
  });

  it('detects rapid cycling — same stage within threshold', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000 },
      { eventType: 'PROCESSING', timestamp: 5000 },
      { eventType: 'PROCESSING', timestamp: 5010 }, // 10s apart — rapid cycling
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const rapid = result.patterns.find((p) => p.type === 'rapid_cycling');
    expect(rapid).toBeDefined();
    expect(rapid!.severity).toBe('critical'); // < 60s
  });

  it('flags actor_switch when many actors in one stage', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      eventType: 'HARVEST',
      timestamp: 1000 + i * 1000,
      actor: `actor-${i}`,
    }));
    const result = detectSuspiciousPatterns('prod-1', events);
    const actorSwitch = result.patterns.find((p) => p.type === 'actor_switch');
    expect(actorSwitch).toBeDefined();
  });

  it('flags excessive events for a stage', () => {
    const events = [
      { eventType: 'HARVEST', timestamp: 1000 },
      { eventType: 'HARVEST', timestamp: 2000 },
      { eventType: 'HARVEST', timestamp: 3000 },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const excessive = result.patterns.find((p) => p.type === 'excessive_events');
    expect(excessive).toBeDefined();
  });

  it('sets riskLevel to the highest severity among patterns', () => {
    const events = [
      { eventType: 'SHIPPING', timestamp: 5000 },
      { eventType: 'RETAIL', timestamp: 10000 },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    expect(result.riskLevel).toBe('critical');
  });

  it('populates metadata on rapid_cycling pattern', () => {
    const events = [
      { eventType: 'PROCESSING', timestamp: 1000 },
      { eventType: 'PROCESSING', timestamp: 1030 },
    ];
    const result = detectSuspiciousPatterns('prod-1', events);
    const rapid = result.patterns.find((p) => p.type === 'rapid_cycling');
    expect(rapid?.metadata?.deltaSeconds).toBe(30);
  });
});
