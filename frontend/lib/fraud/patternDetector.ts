/**
 * Pattern recognition for suspicious event sequences in supply chain tracking.
 * Identifies fraud vectors like stage regression, actor switching, rapid cycling,
 * duplicate events, and missing mandatory intermediate stages.
 */

export type SuspiciousPatternType =
  | 'duplicate_event'
  | 'stage_regression'
  | 'missing_stage'
  | 'rapid_cycling'
  | 'actor_switch'
  | 'out_of_order'
  | 'excessive_events';

export interface SuspiciousPattern {
  type: SuspiciousPatternType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  eventIndices: number[];
  message: string;
  metadata?: Record<string, unknown>;
}

export interface PatternDetectionResult {
  productId: string;
  totalEvents: number;
  patternsDetected: number;
  patterns: SuspiciousPattern[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: string;
}

// Expected linear progression for supply chain stages
const STAGE_ORDER = ['HARVEST', 'PROCESSING', 'SHIPPING', 'RETAIL'];
const STAGE_RANK: Record<string, number> = {
  HARVEST: 0,
  PROCESSING: 1,
  SHIPPING: 2,
  RETAIL: 3,
};

// How many times a stage should appear at most
const MAX_STAGE_OCCURRENCES: Record<string, number> = {
  HARVEST: 1,
  PROCESSING: 3,
  SHIPPING: 5,
  RETAIL: 1,
};

// Minimum seconds between same-stage repeat events
const RAPID_CYCLE_THRESHOLD_SECONDS = 300; // 5 minutes

export function detectSuspiciousPatterns(
  productId: string,
  events: Array<{
    eventType: string;
    timestamp: number;
    actor?: string;
    location?: string;
  }>,
): PatternDetectionResult {
  const patterns: SuspiciousPattern[] = [];

  if (events.length === 0) {
    return {
      productId,
      totalEvents: 0,
      patternsDetected: 0,
      patterns: [],
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };
  }

  const sorted = [...events]
    .map((e, originalIndex) => ({ ...e, originalIndex }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // ── 1. Duplicate events ──────────────────────────────────────────────────────
  const seen = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const key = `${sorted[i].eventType}:${sorted[i].timestamp}`;
    if (seen.has(key)) {
      patterns.push({
        type: 'duplicate_event',
        severity: 'high',
        eventIndices: [seen.get(key)!, i],
        message: `Duplicate ${sorted[i].eventType} event at timestamp ${sorted[i].timestamp}`,
      });
    } else {
      seen.set(key, i);
    }
  }

  // ── 2. Stage regression ──────────────────────────────────────────────────────
  let highWaterMark = -1;
  for (let i = 0; i < sorted.length; i++) {
    const rank = STAGE_RANK[sorted[i].eventType];
    if (rank === undefined) continue;
    if (rank < highWaterMark) {
      patterns.push({
        type: 'stage_regression',
        severity: 'high',
        eventIndices: [i],
        message: `Stage regression: ${sorted[i].eventType} (rank ${rank}) after reaching rank ${highWaterMark}`,
        metadata: { regressedTo: sorted[i].eventType, highWaterMark },
      });
    }
    highWaterMark = Math.max(highWaterMark, rank);
  }

  // ── 3. Missing mandatory intermediate stage ──────────────────────────────────
  const observedStages = new Set(sorted.map((e) => e.eventType));
  if (observedStages.has('RETAIL') && !observedStages.has('HARVEST')) {
    patterns.push({
      type: 'missing_stage',
      severity: 'critical',
      eventIndices: [],
      message: 'Product reached RETAIL without any HARVEST event — provenance unverifiable',
    });
  }
  if (observedStages.has('RETAIL') && !observedStages.has('SHIPPING')) {
    patterns.push({
      type: 'missing_stage',
      severity: 'high',
      eventIndices: [],
      message: 'Product reached RETAIL without any SHIPPING event',
    });
  }
  if (
    observedStages.has('SHIPPING') &&
    !observedStages.has('HARVEST') &&
    !observedStages.has('PROCESSING')
  ) {
    patterns.push({
      type: 'missing_stage',
      severity: 'medium',
      eventIndices: [],
      message: 'SHIPPING event present with no upstream HARVEST or PROCESSING events',
    });
  }

  // ── 4. Rapid cycling (same stage repeated too quickly) ───────────────────────
  const lastSeen = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const { eventType, timestamp } = sorted[i];
    const prev = lastSeen.get(eventType);
    if (prev !== undefined) {
      const delta = timestamp - sorted[prev].timestamp;
      if (delta < RAPID_CYCLE_THRESHOLD_SECONDS) {
        patterns.push({
          type: 'rapid_cycling',
          severity: delta < 60 ? 'critical' : 'medium',
          eventIndices: [prev, i],
          message: `Rapid ${eventType} re-occurrence: only ${delta}s between events (threshold: ${RAPID_CYCLE_THRESHOLD_SECONDS}s)`,
          metadata: { deltaSeconds: delta },
        });
      }
    }
    lastSeen.set(eventType, i);
  }

  // ── 5. Actor switching mid-chain ─────────────────────────────────────────────
  const actorsByStage = new Map<string, Set<string>>();
  for (const ev of sorted) {
    if (!ev.actor) continue;
    if (!actorsByStage.has(ev.eventType)) actorsByStage.set(ev.eventType, new Set());
    actorsByStage.get(ev.eventType)!.add(ev.actor);
  }
  for (const [stage, actors] of actorsByStage) {
    if (actors.size > 3) {
      patterns.push({
        type: 'actor_switch',
        severity: 'medium',
        eventIndices: [],
        message: `${actors.size} distinct actors recorded for ${stage} stage — unusual for a single product batch`,
        metadata: { stage, actorCount: actors.size },
      });
    }
  }

  // ── 6. Excessive total events ────────────────────────────────────────────────
  for (const [stage, maxCount] of Object.entries(MAX_STAGE_OCCURRENCES)) {
    const count = sorted.filter((e) => e.eventType === stage).length;
    if (count > maxCount) {
      patterns.push({
        type: 'excessive_events',
        severity: count > maxCount * 2 ? 'high' : 'low',
        eventIndices: [],
        message: `${stage} event appears ${count} times (expected at most ${maxCount})`,
        metadata: { stage, count, maxCount },
      });
    }
  }

  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (patterns.some((p) => p.severity === 'critical')) riskLevel = 'critical';
  else if (patterns.some((p) => p.severity === 'high')) riskLevel = 'high';
  else if (patterns.some((p) => p.severity === 'medium')) riskLevel = 'medium';

  return {
    productId,
    totalEvents: sorted.length,
    patternsDetected: patterns.length,
    patterns,
    riskLevel,
    analysisTimestamp: new Date().toISOString(),
  };
}
