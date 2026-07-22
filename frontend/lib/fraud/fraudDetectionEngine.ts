/**
 * Fraud Detection Engine — orchestrates all fraud detectors in parallel and
 * produces a unified risk assessment per product (and optionally across a
 * network of products via collaborative filtering).
 */

import { detectSpeedAnomalies, type AnomalyDetectionResult } from './speedAnomalyDetector';
import { detectLocationAnomalies, type LocationAnomalyResult } from './locationAnomalyDetector';
import { detectSuspiciousPatterns, type PatternDetectionResult } from './patternDetector';
import { scoreFraud, type FraudScoringResult } from './mlFraudScorer';
import {
  detectCrossProductFraud,
  type CollaborativeFilterResult,
  type ProductEventSummary,
} from './collaborativeFilter';
import { AlertSystem, defaultAlertSystem, type AlertThresholds } from './alertSystem';

export interface ProductEvent {
  eventType: string;
  timestamp: number;
  actor?: string;
  location?: string;
}

export interface FraudDetectionEngineConfig {
  enableSpeedDetection: boolean;
  enableLocationDetection: boolean;
  enablePatternDetection: boolean;
  enableMlScoring: boolean;
  enableCollaborativeFiltering: boolean;
  alertThresholds: Partial<AlertThresholds>;
}

export interface ComprehensiveFraudResult {
  productId: string;
  /** Composite 0–100 score, weighted average of all active detectors */
  overallFraudScore: number;
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  speedAnomalyResult: AnomalyDetectionResult;
  locationAnomalyResult: LocationAnomalyResult;
  patternDetectionResult: PatternDetectionResult;
  mlScoringResult: FraudScoringResult;
  /** Number of alerts emitted to the alert system for this analysis */
  alertsEmitted: number;
  analysisTimestamp: string;
}

export interface NetworkAnalysisResult {
  productResults: Map<string, ComprehensiveFraudResult>;
  collaborativeFilterResult: CollaborativeFilterResult;
  networkRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

const DEFAULT_CONFIG: FraudDetectionEngineConfig = {
  enableSpeedDetection: true,
  enableLocationDetection: true,
  enablePatternDetection: true,
  enableMlScoring: true,
  enableCollaborativeFiltering: true,
  alertThresholds: {},
};

const RISK_LEVEL_SCORE: Record<string, number> = {
  low: 10,
  medium: 40,
  high: 70,
  critical: 90,
};

function riskLevelFromScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export class FraudDetectionEngine {
  private config: FraudDetectionEngineConfig;
  private alertSystem: AlertSystem;

  constructor(
    config: Partial<FraudDetectionEngineConfig> = {},
    alertSystem: AlertSystem = defaultAlertSystem,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.alertSystem = alertSystem;
    if (Object.keys(this.config.alertThresholds).length > 0) {
      this.alertSystem.updateThresholds(this.config.alertThresholds);
    }
  }

  analyzeProduct(productId: string, events: ProductEvent[]): ComprehensiveFraudResult {
    const {
      enableSpeedDetection,
      enableLocationDetection,
      enablePatternDetection,
      enableMlScoring,
    } = this.config;

    // Run all enabled detectors
    const speedResult = enableSpeedDetection
      ? detectSpeedAnomalies(productId, events)
      : this.emptySpeedResult(productId, events.length);

    const locationResult = enableLocationDetection
      ? detectLocationAnomalies(
          productId,
          events.filter((e): e is typeof e & { location: string } => !!e.location),
        )
      : this.emptyLocationResult(productId, events.length);

    const patternResult = enablePatternDetection
      ? detectSuspiciousPatterns(productId, events)
      : this.emptyPatternResult(productId, events.length);

    const mlResult = enableMlScoring
      ? scoreFraud(productId, events)
      : this.emptyMlResult(productId);

    // Emit alerts
    let alertsEmitted = 0;

    for (const alert of speedResult.alerts) {
      const emitted = this.alertSystem.emit({
        productId,
        severity: alert.severity,
        detectorType: 'speed',
        message: alert.message,
        metadata: { alert },
      });
      if (emitted) alertsEmitted++;
    }

    for (const alert of locationResult.alerts) {
      const emitted = this.alertSystem.emit({
        productId,
        severity: alert.severity,
        detectorType: 'location',
        message: alert.message,
        metadata: { alert },
      });
      if (emitted) alertsEmitted++;
    }

    for (const pattern of patternResult.patterns) {
      const emitted = this.alertSystem.emit({
        productId,
        severity: pattern.severity,
        detectorType: 'pattern',
        message: pattern.message,
        metadata: { pattern },
      });
      if (emitted) alertsEmitted++;
    }

    if (mlResult.fraudScore >= 40) {
      const emitted = this.alertSystem.emit({
        productId,
        severity: mlResult.riskLevel,
        detectorType: 'ml_score',
        message: `ML fraud score: ${mlResult.fraudScore}/100 — ${mlResult.riskFactors.join('; ')}`,
        metadata: { fraudScore: mlResult.fraudScore, riskFactors: mlResult.riskFactors },
      });
      if (emitted) alertsEmitted++;
    }

    // Compute composite score
    const activeScores: number[] = [];
    if (enableSpeedDetection) activeScores.push(RISK_LEVEL_SCORE[speedResult.riskLevel]);
    if (enableLocationDetection) activeScores.push(RISK_LEVEL_SCORE[locationResult.riskLevel]);
    if (enablePatternDetection) activeScores.push(RISK_LEVEL_SCORE[patternResult.riskLevel]);
    if (enableMlScoring) activeScores.push(mlResult.fraudScore);

    const overallFraudScore =
      activeScores.length > 0
        ? Math.round(activeScores.reduce((s, v) => s + v, 0) / activeScores.length)
        : 0;

    return {
      productId,
      overallFraudScore,
      overallRiskLevel: riskLevelFromScore(overallFraudScore),
      speedAnomalyResult: speedResult,
      locationAnomalyResult: locationResult,
      patternDetectionResult: patternResult,
      mlScoringResult: mlResult,
      alertsEmitted,
      analysisTimestamp: new Date().toISOString(),
    };
  }

  analyzeNetwork(allProductEvents: Map<string, ProductEvent[]>): NetworkAnalysisResult {
    const productResults = new Map<string, ComprehensiveFraudResult>();

    for (const [productId, events] of allProductEvents) {
      productResults.set(productId, this.analyzeProduct(productId, events));
    }

    let collaborativeFilterResult: CollaborativeFilterResult = {
      analyzedProducts: allProductEvents.size,
      analyzedActors: 0,
      highRiskActors: [],
      networkRiskScore: 0,
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };

    if (this.config.enableCollaborativeFiltering) {
      const summaries = new Map<string, ProductEventSummary>();
      for (const [productId, events] of allProductEvents) {
        const result = productResults.get(productId)!;
        summaries.set(productId, {
          events,
          isSuspicious:
            result.overallRiskLevel === 'high' || result.overallRiskLevel === 'critical',
        });
      }
      collaborativeFilterResult = detectCrossProductFraud(summaries);

      for (const actor of collaborativeFilterResult.highRiskActors) {
        this.alertSystem.emit({
          productId: actor.flaggedProductIds[0] ?? 'network',
          severity: actor.severity,
          detectorType: 'collaborative',
          message: `Cross-product fraud ring detected — actor ${actor.actorAddress.slice(0, 12)}... scored ${actor.riskScore}/100`,
          metadata: { riskScore: actor.riskScore, actor: actor.actorAddress },
        });
      }
    }

    const maxProductScore = Math.max(
      ...[...productResults.values()].map((r) => r.overallFraudScore),
      0,
    );
    const networkScore = Math.max(maxProductScore, collaborativeFilterResult.networkRiskScore);

    return {
      productResults,
      collaborativeFilterResult,
      networkRiskLevel: riskLevelFromScore(networkScore),
    };
  }

  getAlertSystem(): AlertSystem {
    return this.alertSystem;
  }

  // ── Empty result helpers (when a detector is disabled) ─────────────────────

  private emptySpeedResult(productId: string, totalEvents: number): AnomalyDetectionResult {
    return {
      productId,
      totalEvents,
      anomaliesDetected: 0,
      alerts: [],
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };
  }

  private emptyLocationResult(productId: string, totalEvents: number): LocationAnomalyResult {
    return {
      productId,
      totalEvents,
      anomaliesDetected: 0,
      alerts: [],
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };
  }

  private emptyPatternResult(productId: string, totalEvents: number): PatternDetectionResult {
    return {
      productId,
      totalEvents,
      patternsDetected: 0,
      patterns: [],
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };
  }

  private emptyMlResult(productId: string): FraudScoringResult {
    return {
      productId,
      fraudScore: 0,
      confidence: 0,
      features: {
        avgTimeBetweenEvents: Infinity,
        minTimeBetweenEvents: Infinity,
        actorConsistencyScore: 1,
        stageProgressionScore: 1,
        locationConsistencyScore: 1,
        eventFrequencyPerHour: 0,
        rapidTransitionCount: 0,
        distinctActorCount: 0,
        locationCoverageRatio: 0,
      },
      riskLevel: 'low',
      riskFactors: [],
      analysisTimestamp: new Date().toISOString(),
    };
  }
}

export const defaultFraudEngine = new FraudDetectionEngine();
