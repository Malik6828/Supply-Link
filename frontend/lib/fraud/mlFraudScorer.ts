/**
 * ML-inspired fraud scoring for supply chain events.
 *
 * Uses weighted feature extraction and a logistic-style scoring model
 * to produce a 0–100 fraud score. No external ML runtime required —
 * all weights are derived from domain heuristics and are configurable.
 */

export interface FraudFeatures {
  /** Mean seconds between consecutive events (lower = more suspicious) */
  avgTimeBetweenEvents: number;
  /** Minimum seconds between any two consecutive events */
  minTimeBetweenEvents: number;
  /** 0–1: proportion of same-actor events across the chain */
  actorConsistencyScore: number;
  /** 0–1: how well stage ordering matches the expected HARVEST→RETAIL flow */
  stageProgressionScore: number;
  /** 0–1: proportion of events sharing the same location cluster */
  locationConsistencyScore: number;
  /** Events per hour over the observed window */
  eventFrequencyPerHour: number;
  /** Count of transitions faster than their stage-specific minimum */
  rapidTransitionCount: number;
  /** Total distinct actors across all events */
  distinctActorCount: number;
  /** Fraction of events with location data */
  locationCoverageRatio: number;
}

export interface FraudScoringResult {
  productId: string;
  /** 0–100: higher means more suspicious */
  fraudScore: number;
  /** 0–1: model confidence based on data completeness */
  confidence: number;
  features: FraudFeatures;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  analysisTimestamp: string;
}

// Stage-minimum transition times in seconds (mirrors speedAnomalyDetector)
const STAGE_MINIMUMS: Record<string, Record<string, number>> = {
  HARVEST: { PROCESSING: 3600, SHIPPING: 86400, RETAIL: 172800 },
  PROCESSING: { SHIPPING: 3600, RETAIL: 86400 },
  SHIPPING: { RETAIL: 3600 },
};

const EXPECTED_STAGE_ORDER = ['HARVEST', 'PROCESSING', 'SHIPPING', 'RETAIL'];

// Feature weights (sum to 1.0)
const WEIGHTS = {
  minTime: 0.25,
  rapidTransitions: 0.2,
  stageProgression: 0.2,
  actorConsistency: 0.15,
  eventFrequency: 0.1,
  locationConsistency: 0.1,
};

function computeActorConsistency(events: Array<{ actor?: string }>): number {
  const actored = events.filter((e) => e.actor);
  if (actored.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const e of actored) counts.set(e.actor!, (counts.get(e.actor!) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  return maxCount / actored.length;
}

function computeStageProgression(events: Array<{ eventType: string }>): number {
  const knownRanks = events
    .map((e) => EXPECTED_STAGE_ORDER.indexOf(e.eventType))
    .filter((r) => r >= 0);

  if (knownRanks.length < 2) return 1;

  let inOrderCount = 0;
  for (let i = 1; i < knownRanks.length; i++) {
    if (knownRanks[i] >= knownRanks[i - 1]) inOrderCount++;
  }
  return inOrderCount / (knownRanks.length - 1);
}

function computeLocationConsistency(events: Array<{ location?: string }>): number {
  const located = events.filter((e) => e.location);
  if (located.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const e of located) {
    const key = e.location!.toLowerCase().trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount / located.length;
}

function countRapidTransitions(sorted: Array<{ eventType: string; timestamp: number }>): number {
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const minTime = STAGE_MINIMUMS[sorted[i - 1].eventType]?.[sorted[i].eventType];
    if (minTime && sorted[i].timestamp - sorted[i - 1].timestamp < minTime) count++;
  }
  return count;
}

export function extractFeatures(
  events: Array<{
    eventType: string;
    timestamp: number;
    actor?: string;
    location?: string;
  }>,
): FraudFeatures {
  if (events.length < 2) {
    return {
      avgTimeBetweenEvents: Infinity,
      minTimeBetweenEvents: Infinity,
      actorConsistencyScore: 1,
      stageProgressionScore: 1,
      locationConsistencyScore: 1,
      eventFrequencyPerHour: 0,
      rapidTransitionCount: 0,
      distinctActorCount: new Set(events.filter((e) => e.actor).map((e) => e.actor)).size,
      locationCoverageRatio: events.filter((e) => e.location).length / Math.max(events.length, 1),
    };
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  }

  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const min = Math.min(...deltas);
  const windowSeconds = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  const freqPerHour = windowSeconds > 0 ? (sorted.length / windowSeconds) * 3600 : 0;

  return {
    avgTimeBetweenEvents: avg,
    minTimeBetweenEvents: min,
    actorConsistencyScore: computeActorConsistency(events),
    stageProgressionScore: computeStageProgression(events),
    locationConsistencyScore: computeLocationConsistency(events),
    eventFrequencyPerHour: freqPerHour,
    rapidTransitionCount: countRapidTransitions(sorted),
    distinctActorCount: new Set(events.filter((e) => e.actor).map((e) => e.actor)).size,
    locationCoverageRatio: events.filter((e) => e.location).length / events.length,
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Map a raw feature value to a 0–1 suspicion score for that feature. */
function scoreMinTime(minTime: number): number {
  if (minTime === Infinity) return 0;
  // Very fast = suspicious; normalize against 3600s (1 hour)
  return Math.max(0, 1 - minTime / 3600);
}

function scoreRapidTransitions(count: number, total: number): number {
  if (total < 2) return 0;
  return Math.min(count / (total - 1), 1);
}

function scoreFrequency(eventsPerHour: number): number {
  // > 10 events/hour is suspicious
  return Math.min(eventsPerHour / 10, 1);
}

export function scoreFraud(
  productId: string,
  events: Array<{
    eventType: string;
    timestamp: number;
    actor?: string;
    location?: string;
  }>,
): FraudScoringResult {
  const features = extractFeatures(events);
  const riskFactors: string[] = [];

  const minTimeScore = scoreMinTime(features.minTimeBetweenEvents);
  const rapidScore = scoreRapidTransitions(features.rapidTransitionCount, events.length);
  const progressionScore = 1 - features.stageProgressionScore;
  const actorScore = 1 - features.actorConsistencyScore;
  const freqScore = scoreFrequency(features.eventFrequencyPerHour);
  const locationScore = 1 - features.locationConsistencyScore;

  const rawScore =
    WEIGHTS.minTime * minTimeScore +
    WEIGHTS.rapidTransitions * rapidScore +
    WEIGHTS.stageProgression * progressionScore +
    WEIGHTS.actorConsistency * actorScore +
    WEIGHTS.eventFrequency * freqScore +
    WEIGHTS.locationConsistency * locationScore;

  const fraudScore = Math.round(sigmoid((rawScore - 0.3) * 10) * 100);

  // Confidence: higher when we have more data and location coverage
  const confidence = Math.min(
    0.4 + Math.min(events.length / 10, 0.3) + features.locationCoverageRatio * 0.3,
    1,
  );

  if (minTimeScore > 0.5) riskFactors.push('Extremely fast stage transitions detected');
  if (rapidScore > 0.3)
    riskFactors.push(`${features.rapidTransitionCount} transition(s) below minimum expected time`);
  if (progressionScore > 0.4)
    riskFactors.push('Stage progression deviates from expected HARVEST→RETAIL order');
  if (actorScore > 0.5)
    riskFactors.push(`High actor diversity: ${features.distinctActorCount} distinct actors`);
  if (freqScore > 0.5)
    riskFactors.push(
      `Unusual event frequency: ${features.eventFrequencyPerHour.toFixed(1)} events/hour`,
    );
  if (locationScore > 0.5)
    riskFactors.push('Events scattered across many locations — no consistent hub');

  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (fraudScore >= 80) riskLevel = 'critical';
  else if (fraudScore >= 60) riskLevel = 'high';
  else if (fraudScore >= 40) riskLevel = 'medium';

  return {
    productId,
    fraudScore,
    confidence,
    features,
    riskLevel,
    riskFactors,
    analysisTimestamp: new Date().toISOString(),
  };
}
