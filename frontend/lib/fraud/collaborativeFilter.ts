/**
 * Collaborative filtering for cross-product fraud detection.
 *
 * Builds actor behaviour profiles across all tracked products and flags
 * actors / actor networks whose aggregated behaviour exceeds risk thresholds.
 * Useful for catching fraud rings that look clean on a single product but
 * leave traces across many products.
 */

export interface ActorBehaviorProfile {
  actor: string;
  /** Products this actor has appeared in */
  productIds: string[];
  totalEvents: number;
  /** How many of those products were individually flagged as suspicious */
  suspiciousProductCount: number;
  /** 0–100 aggregate suspicion score */
  suspicionScore: number;
  firstSeenTimestamp: number;
  lastSeenTimestamp: number;
  /** Stages the actor has been seen operating in */
  operatedStages: string[];
}

export interface CrossProductRisk {
  actorAddress: string;
  /** 0–100 */
  riskScore: number;
  flaggedProductIds: string[];
  behaviorPatterns: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface CollaborativeFilterResult {
  analyzedProducts: number;
  analyzedActors: number;
  highRiskActors: CrossProductRisk[];
  /** 0–100 aggregate network risk (max of individual actor scores) */
  networkRiskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: string;
}

export interface ProductEventSummary {
  events: Array<{
    eventType: string;
    timestamp: number;
    actor?: string;
    location?: string;
  }>;
  /** Whether this product was flagged as suspicious by another detector */
  isSuspicious?: boolean;
}

const RISK_SCORE_THRESHOLDS = { medium: 30, high: 55, critical: 75 };

function buildActorProfiles(
  allProducts: Map<string, ProductEventSummary>,
): Map<string, ActorBehaviorProfile> {
  const profiles = new Map<string, ActorBehaviorProfile>();

  for (const [productId, summary] of allProducts) {
    for (const ev of summary.events) {
      if (!ev.actor) continue;

      let profile = profiles.get(ev.actor);
      if (!profile) {
        profile = {
          actor: ev.actor,
          productIds: [],
          totalEvents: 0,
          suspiciousProductCount: 0,
          suspicionScore: 0,
          firstSeenTimestamp: ev.timestamp,
          lastSeenTimestamp: ev.timestamp,
          operatedStages: [],
        };
        profiles.set(ev.actor, profile);
      }

      profile.totalEvents++;
      profile.firstSeenTimestamp = Math.min(profile.firstSeenTimestamp, ev.timestamp);
      profile.lastSeenTimestamp = Math.max(profile.lastSeenTimestamp, ev.timestamp);

      if (!profile.productIds.includes(productId)) {
        profile.productIds.push(productId);
        if (summary.isSuspicious) profile.suspiciousProductCount++;
      }

      if (!profile.operatedStages.includes(ev.eventType)) {
        profile.operatedStages.push(ev.eventType);
      }
    }
  }

  return profiles;
}

function scoreActor(profile: ActorBehaviorProfile): { score: number; patterns: string[] } {
  const patterns: string[] = [];
  let score = 0;

  // Factor 1: ratio of suspicious products
  const suspiciousRatio =
    profile.productIds.length > 0 ? profile.suspiciousProductCount / profile.productIds.length : 0;
  if (suspiciousRatio > 0) {
    score += suspiciousRatio * 40;
    patterns.push(
      `Involved in ${profile.suspiciousProductCount}/${profile.productIds.length} flagged products`,
    );
  }

  // Factor 2: unusually high product count for one actor (potential data-stuffing)
  if (profile.productIds.length > 20) {
    score += Math.min((profile.productIds.length - 20) * 0.5, 20);
    patterns.push(`Actor appears across ${profile.productIds.length} products — unusually broad`);
  }

  // Factor 3: operating in every stage (a single actor should not span HARVEST to RETAIL)
  if (profile.operatedStages.length >= 4) {
    score += 20;
    patterns.push(
      'Actor operates across all supply chain stages — unusual single-entity behaviour',
    );
  } else if (profile.operatedStages.length === 3) {
    score += 10;
  }

  // Factor 4: event velocity — many events in a short window
  const windowSeconds = profile.lastSeenTimestamp - profile.firstSeenTimestamp;
  if (windowSeconds > 0) {
    const eventsPerHour = (profile.totalEvents / windowSeconds) * 3600;
    if (eventsPerHour > 20) {
      score += Math.min((eventsPerHour - 20) * 0.5, 20);
      patterns.push(`High event rate: ${eventsPerHour.toFixed(1)} events/hour`);
    }
  }

  return { score: Math.min(Math.round(score), 100), patterns };
}

export function detectCrossProductFraud(
  allProducts: Map<string, ProductEventSummary>,
): CollaborativeFilterResult {
  const profiles = buildActorProfiles(allProducts);
  const highRiskActors: CrossProductRisk[] = [];

  for (const profile of profiles.values()) {
    const { score, patterns } = scoreActor(profile);
    if (score < RISK_SCORE_THRESHOLDS.medium) continue;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (score >= RISK_SCORE_THRESHOLDS.critical) severity = 'critical';
    else if (score >= RISK_SCORE_THRESHOLDS.high) severity = 'high';

    highRiskActors.push({
      actorAddress: profile.actor,
      riskScore: score,
      flaggedProductIds: profile.productIds.filter((id) => allProducts.get(id)?.isSuspicious),
      behaviorPatterns: patterns,
      severity,
    });
  }

  highRiskActors.sort((a, b) => b.riskScore - a.riskScore);

  const networkRiskScore =
    highRiskActors.length > 0 ? Math.max(...highRiskActors.map((a) => a.riskScore)) : 0;

  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (networkRiskScore >= RISK_SCORE_THRESHOLDS.critical) riskLevel = 'critical';
  else if (networkRiskScore >= RISK_SCORE_THRESHOLDS.high) riskLevel = 'high';
  else if (networkRiskScore >= RISK_SCORE_THRESHOLDS.medium) riskLevel = 'medium';

  return {
    analyzedProducts: allProducts.size,
    analyzedActors: profiles.size,
    highRiskActors,
    networkRiskScore,
    riskLevel,
    analysisTimestamp: new Date().toISOString(),
  };
}
