import {
  AI_MODEL_GOVERNANCE_SCHEMA_VERSION,
  AiModelPromotionAggregateQualitySchema,
  AiModelPromotionRecordSchema,
  AiShadowRunEvidenceBundleSchema,
  AiShadowRunEligibilityDecisionSchema,
  AiShadowRunEligibilityInputSchema,
  AiShadowRunQualityMetricsSchema,
  type AiTextGenerationModelAlias,
  type AiModelPromotionAggregateQuality,
  type AiModelPromotionRecord,
  type AiModelPromotionThresholds,
  type AiShadowModePolicy,
  type AiShadowRunEvidenceBundle,
  type AiShadowRunEligibilityDecision,
  type AiShadowRunEligibilityInput,
  type AiShadowRunQualityMetrics,
  type RoutedModelExecution,
} from '@signacare/shared';
import { createHash } from 'node:crypto';

export const DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS: AiModelPromotionThresholds = {
  minShadowSampleSize: 30,
  maxEditDistanceRatio: 0.35,
  minCitationCoverageRatio: 0.9,
  maxHallucinationFlagsPer100Runs: 0,
  maxP95LatencyRegressionPct: 25,
  maxEstimatedCostRegressionPct: 50,
};

export interface ShadowCandidateScoreInput {
  alias: AiTextGenerationModelAlias;
  action: string;
  primaryExecution: RoutedModelExecution;
  challengerExecution: RoutedModelExecution;
  baselineDeploymentRef: string;
  candidateDeploymentRef: string;
  primaryOutput: string;
  challengerOutput: string;
  citationsRequired: number;
  citationsWithEvidence: number;
  hallucinationFlagCount?: number;
  safetyRefusalMismatch?: boolean;
  primaryLatencyMs: number;
  challengerLatencyMs: number;
  primaryEstimatedCostAud: number;
  challengerEstimatedCostAud: number;
  estimatedAdditionalCostAud: number;
  cachedPromptTokens?: number | null;
  clinicianAcceptedCandidate?: boolean | null;
  clinicianRatingDelta?: number | null;
}

export interface PromotionEvaluation {
  allowed: boolean;
  blockers: string[];
}

export interface ShadowRunEvidenceBundleInput {
  policyVersion: string;
  alias: AiTextGenerationModelAlias;
  baselineDeploymentRef: string;
  candidateDeploymentRef: string;
  generatedAt: string;
  metrics: readonly AiShadowRunQualityMetrics[];
}

function tokenizeClinicalText(value: string): string[] {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = current[j - 1] + 1;
      const deletion = previous[j] + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function calculateEditDistanceRatio(primaryOutput: string, challengerOutput: string): number {
  const primary = tokenizeClinicalText(primaryOutput);
  const challenger = tokenizeClinicalText(challengerOutput);
  const denominator = Math.max(primary.length, challenger.length, 1);
  return round4(levenshteinDistance(primary, challenger) / denominator);
}

function citationCoverageRatio(required: number, withEvidence: number): number {
  if (required <= 0) return 1;
  return round4(Math.max(0, Math.min(withEvidence, required)) / required);
}

export function scoreShadowCandidate(input: ShadowCandidateScoreInput): AiShadowRunQualityMetrics {
  return AiShadowRunQualityMetricsSchema.parse({
    schemaVersion: AI_MODEL_GOVERNANCE_SCHEMA_VERSION,
    alias: input.alias,
    action: input.action,
    primaryExecution: input.primaryExecution,
    challengerExecution: input.challengerExecution,
    baselineDeploymentRef: input.baselineDeploymentRef,
    candidateDeploymentRef: input.candidateDeploymentRef,
    editDistanceRatio: calculateEditDistanceRatio(input.primaryOutput, input.challengerOutput),
    citationCoverageRatio: citationCoverageRatio(input.citationsRequired, input.citationsWithEvidence),
    hallucinationFlagCount: input.hallucinationFlagCount ?? 0,
    safetyRefusalMismatch: input.safetyRefusalMismatch ?? false,
    primaryLatencyMs: input.primaryLatencyMs,
    challengerLatencyMs: input.challengerLatencyMs,
    primaryEstimatedCostAud: input.primaryEstimatedCostAud,
    challengerEstimatedCostAud: input.challengerEstimatedCostAud,
    estimatedAdditionalCostAud: input.estimatedAdditionalCostAud,
    cachedPromptTokens: input.cachedPromptTokens ?? null,
    clinicianAcceptedCandidate: input.clinicianAcceptedCandidate ?? null,
    clinicianRatingDelta: input.clinicianRatingDelta ?? null,
  });
}

function deterministicShadowSampleBucket(policy: AiShadowModePolicy, input: AiShadowRunEligibilityInput): number {
  const digest = createHash('sha256')
    .update([
      policy.policyVersion,
      input.alias,
      input.action,
      input.deterministicSampleSeed,
    ].join('|'))
    .digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 10_000;
}

export function evaluateShadowRunEligibility(input: AiShadowRunEligibilityInput): AiShadowRunEligibilityDecision {
  const parsed = AiShadowRunEligibilityInputSchema.parse(input);
  const { policy } = parsed;
  const blockers: string[] = [];
  const sampleBucket = deterministicShadowSampleBucket(policy, parsed);
  const thresholdBucket = Math.floor(policy.sampleRatePct * 100);
  const sampled = parsed.forceInclude || sampleBucket < thresholdBucket;

  if (!policy.enabled) {
    blockers.push(`shadow policy ${policy.policyVersion} is disabled`);
  }

  if (!policy.eligibleAliases.includes(parsed.alias)) {
    blockers.push(`alias ${parsed.alias} is not eligible for shadow policy ${policy.policyVersion}`);
  }

  if (!policy.eligibleActions.includes(parsed.action)) {
    blockers.push(`action ${parsed.action} is not eligible for shadow policy ${policy.policyVersion}`);
  }

  if (policy.requireClinicianConsent && !parsed.clinicianConsentRecorded) {
    blockers.push('clinician consent is required for shadow-mode sampling');
  }

  if (policy.requireCitationScoring && !parsed.citationScoringAvailable) {
    blockers.push('citation scoring is required for this shadow policy');
  }

  if (parsed.estimatedAdditionalLatencyMs > policy.maxAdditionalLatencyMs) {
    blockers.push(
      `estimated additional latency ${parsed.estimatedAdditionalLatencyMs}ms exceeds ${policy.maxAdditionalLatencyMs}ms`,
    );
  }

  const projectedCostAud = parsed.estimatedAdditionalCostAudToday + parsed.estimatedRequestCostAud;
  if (projectedCostAud > policy.maxAdditionalCostAudPerDay) {
    blockers.push(
      `projected daily shadow cost ${projectedCostAud.toFixed(4)} AUD exceeds ${policy.maxAdditionalCostAudPerDay.toFixed(4)} AUD`,
    );
  }

  if (!sampled) {
    blockers.push(`outside deterministic shadow sample bucket ${sampleBucket}/${thresholdBucket}`);
  }

  return AiShadowRunEligibilityDecisionSchema.parse({
    schemaVersion: AI_MODEL_GOVERNANCE_SCHEMA_VERSION,
    policyVersion: policy.policyVersion,
    alias: parsed.alias,
    action: parsed.action,
    eligible: blockers.length === 0,
    sampled,
    sampleBucket,
    blockers,
  });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function regressionPct(baseline: number, candidate: number): number {
  if (baseline <= 0) return candidate > 0 ? 100 : 0;
  return ((candidate - baseline) / baseline) * 100;
}

export function aggregateShadowRunQualityMetrics(
  metrics: readonly AiShadowRunQualityMetrics[],
): AiModelPromotionAggregateQuality {
  const parsedMetrics = metrics.map((metric) => AiShadowRunQualityMetricsSchema.parse(metric));
  const sampleSize = parsedMetrics.length;
  const hallucinationFlags = parsedMetrics.reduce((sum, metric) => sum + metric.hallucinationFlagCount, 0);
  const safetyRefusalMismatchCount = parsedMetrics.filter((metric) => metric.safetyRefusalMismatch).length;
  const latencyRegressions = parsedMetrics.map((metric) => regressionPct(metric.primaryLatencyMs, metric.challengerLatencyMs));
  const baselineCost = parsedMetrics.reduce((sum, metric) => sum + metric.primaryEstimatedCostAud, 0);
  const candidateCost = parsedMetrics.reduce((sum, metric) => sum + metric.challengerEstimatedCostAud, 0);

  return AiModelPromotionAggregateQualitySchema.parse({
    shadowSampleSize: sampleSize,
    meanEditDistanceRatio: round4(mean(parsedMetrics.map((metric) => metric.editDistanceRatio))),
    meanCitationCoverageRatio: round4(mean(parsedMetrics.map((metric) => metric.citationCoverageRatio))),
    hallucinationFlagsPer100Runs: sampleSize === 0 ? 0 : round4((hallucinationFlags / sampleSize) * 100),
    safetyRefusalMismatchCount,
    p95LatencyRegressionPct: round4(percentile(latencyRegressions, 95)),
    estimatedCostRegressionPct: round4(regressionPct(baselineCost, candidateCost)),
  });
}

export function hashShadowRunMetrics(metrics: readonly AiShadowRunQualityMetrics[]): string {
  const parsedMetrics = metrics.map((metric) => AiShadowRunQualityMetricsSchema.parse(metric));
  return `sha256:${createHash('sha256').update(JSON.stringify(parsedMetrics)).digest('hex')}`;
}

export function buildShadowRunEvidenceBundle(input: ShadowRunEvidenceBundleInput): AiShadowRunEvidenceBundle {
  const metrics = input.metrics.map((metric) => AiShadowRunQualityMetricsSchema.parse(metric));
  return AiShadowRunEvidenceBundleSchema.parse({
    schemaVersion: AI_MODEL_GOVERNANCE_SCHEMA_VERSION,
    policyVersion: input.policyVersion,
    alias: input.alias,
    baselineDeploymentRef: input.baselineDeploymentRef,
    candidateDeploymentRef: input.candidateDeploymentRef,
    generatedAt: input.generatedAt,
    metricsSha256: hashShadowRunMetrics(metrics),
    metrics,
    aggregateQuality: aggregateShadowRunQualityMetrics(metrics),
  });
}

export function evaluateModelPromotionEvidenceBundle(args: {
  promotionRecord: AiModelPromotionRecord;
  evidenceBundle: AiShadowRunEvidenceBundle;
  evidenceSha256: string;
}): PromotionEvaluation {
  const record = AiModelPromotionRecordSchema.parse(args.promotionRecord);
  const bundle = AiShadowRunEvidenceBundleSchema.parse(args.evidenceBundle);
  const blockers: string[] = [];
  const recomputedMetricsSha256 = hashShadowRunMetrics(bundle.metrics);
  const recomputedAggregate = aggregateShadowRunQualityMetrics(bundle.metrics);

  if (args.evidenceSha256 !== record.shadowEvidenceSha256) {
    blockers.push(`shadow evidence hash mismatch: record=${record.shadowEvidenceSha256} actual=${args.evidenceSha256}`);
  }
  if (bundle.metricsSha256 !== recomputedMetricsSha256) {
    blockers.push(`shadow metrics hash mismatch: bundle=${bundle.metricsSha256} actual=${recomputedMetricsSha256}`);
  }
  if (bundle.policyVersion !== record.policyVersion) {
    blockers.push(`shadow evidence policy version ${bundle.policyVersion} does not match record ${record.policyVersion}`);
  }
  if (bundle.alias !== record.alias) {
    blockers.push(`shadow evidence alias ${bundle.alias} does not match record ${record.alias}`);
  }
  if (bundle.baselineDeploymentRef !== record.fromDeploymentRef) {
    blockers.push('shadow evidence baseline deployment does not match promotion record');
  }
  if (bundle.candidateDeploymentRef !== record.toDeploymentRef) {
    blockers.push('shadow evidence candidate deployment does not match promotion record');
  }
  if (JSON.stringify(bundle.aggregateQuality) !== JSON.stringify(recomputedAggregate)) {
    blockers.push('shadow evidence aggregateQuality does not match recomputed metrics aggregate');
  }
  if (JSON.stringify(record.aggregateQuality) !== JSON.stringify(recomputedAggregate)) {
    blockers.push('promotion record aggregateQuality does not match recomputed shadow evidence aggregate');
  }
  for (const [index, metric] of bundle.metrics.entries()) {
    const metricRef = `shadow metric ${index}`;
    if (metric.alias !== record.alias) {
      blockers.push(`${metricRef} alias ${metric.alias} does not match promotion record ${record.alias}`);
    }
    if (metric.baselineDeploymentRef !== record.fromDeploymentRef) {
      blockers.push(`${metricRef} baseline deployment does not match promotion record`);
    }
    if (metric.candidateDeploymentRef !== record.toDeploymentRef) {
      blockers.push(`${metricRef} candidate deployment does not match promotion record`);
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

export function evaluateModelPromotionRecord(input: AiModelPromotionRecord): PromotionEvaluation {
  const record = AiModelPromotionRecordSchema.parse(input);
  const blockers: string[] = [];
  const { thresholds, aggregateQuality, trainingAdapterReview } = record;
  const isNoChangeAttestation = record.decision === 'no_change';

  if (record.decision !== 'promote' && !isNoChangeAttestation) {
    blockers.push(`promotion decision is "${record.decision}", not "promote" or "no_change"`);
  }

  if (isNoChangeAttestation && record.fromDeploymentRef !== record.toDeploymentRef) {
    blockers.push('no_change records must keep fromDeploymentRef and toDeploymentRef identical');
  }

  if (!isNoChangeAttestation && record.fromDeploymentRef === record.toDeploymentRef) {
    blockers.push('candidate deployment must differ from baseline deployment');
  }

  if (aggregateQuality.shadowSampleSize < thresholds.minShadowSampleSize) {
    blockers.push(
      `shadow sample size ${aggregateQuality.shadowSampleSize} is below minimum ${thresholds.minShadowSampleSize}`,
    );
  }

  if (aggregateQuality.meanEditDistanceRatio > thresholds.maxEditDistanceRatio) {
    blockers.push(
      `mean edit-distance ratio ${aggregateQuality.meanEditDistanceRatio} exceeds ${thresholds.maxEditDistanceRatio}`,
    );
  }

  if (aggregateQuality.meanCitationCoverageRatio < thresholds.minCitationCoverageRatio) {
    blockers.push(
      `citation coverage ${aggregateQuality.meanCitationCoverageRatio} is below ${thresholds.minCitationCoverageRatio}`,
    );
  }

  if (aggregateQuality.hallucinationFlagsPer100Runs > thresholds.maxHallucinationFlagsPer100Runs) {
    blockers.push(
      `hallucination flags per 100 runs ${aggregateQuality.hallucinationFlagsPer100Runs} exceeds ${thresholds.maxHallucinationFlagsPer100Runs}`,
    );
  }

  if (aggregateQuality.safetyRefusalMismatchCount > 0) {
    blockers.push(`safety refusal mismatch count must be zero, got ${aggregateQuality.safetyRefusalMismatchCount}`);
  }

  if (aggregateQuality.p95LatencyRegressionPct > thresholds.maxP95LatencyRegressionPct) {
    blockers.push(
      `p95 latency regression ${aggregateQuality.p95LatencyRegressionPct}% exceeds ${thresholds.maxP95LatencyRegressionPct}%`,
    );
  }

  if (aggregateQuality.estimatedCostRegressionPct > thresholds.maxEstimatedCostRegressionPct) {
    blockers.push(
      `cost regression ${aggregateQuality.estimatedCostRegressionPct}% exceeds ${thresholds.maxEstimatedCostRegressionPct}%`,
    );
  }

  if (!trainingAdapterReview.reviewed) {
    blockers.push('training adapter compatibility review is missing');
  }

  if (trainingAdapterReview.compatibleAdapterCount !== trainingAdapterReview.existingAdapterCount) {
    blockers.push(
      `only ${trainingAdapterReview.compatibleAdapterCount}/${trainingAdapterReview.existingAdapterCount} training adapters are compatible`,
    );
  }

  if (trainingAdapterReview.incompatibleAdapterNames.length > 0) {
    blockers.push(`incompatible training adapters: ${trainingAdapterReview.incompatibleAdapterNames.join(', ')}`);
  }

  if (trainingAdapterReview.adaptersRequiringRetrain.length > 0) {
    blockers.push(`training adapters requiring retrain: ${trainingAdapterReview.adaptersRequiringRetrain.join(', ')}`);
  }

  if (trainingAdapterReview.adapterCompatibility.length !== trainingAdapterReview.existingAdapterCount) {
    blockers.push(
      `adapter compatibility evidence covers ${trainingAdapterReview.adapterCompatibility.length}/${trainingAdapterReview.existingAdapterCount} existing adapters`,
    );
  }

  for (const adapter of trainingAdapterReview.adapterCompatibility) {
    if (adapter.compatibility !== 'compatible') {
      blockers.push(
        `adapter ${adapter.localStyleAdapterModelName ?? '<null>'} is ${adapter.compatibility}`,
      );
    }
    if (!adapter.compatibleAliases.includes(record.alias)) {
      blockers.push(
        `adapter ${adapter.localStyleAdapterModelName ?? '<null>'} is not compatible with alias ${record.alias}`,
      );
    }
    if (!adapter.adapterArtifactDigest) {
      blockers.push(`adapter ${adapter.localStyleAdapterModelName ?? '<null>'} is missing an artifact digest`);
    }
    if (!adapter.trainedBaseModelDigest) {
      blockers.push(`adapter ${adapter.localStyleAdapterModelName ?? '<null>'} is missing a trained base-model digest`);
    }
    if (!adapter.evidenceUri) {
      blockers.push(`adapter ${adapter.localStyleAdapterModelName ?? '<null>'} is missing compatibility evidence`);
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

export function assertModelPromotionAllowed(input: AiModelPromotionRecord): AiModelPromotionRecord {
  const record = AiModelPromotionRecordSchema.parse(input);
  const evaluation = evaluateModelPromotionRecord(record);
  if (!evaluation.allowed) {
    throw new Error(`AI model promotion blocked: ${evaluation.blockers.join('; ')}`);
  }
  return record;
}

export function assertModelPromotionEvidenceBundleAllowed(args: {
  promotionRecord: AiModelPromotionRecord;
  evidenceBundle: AiShadowRunEvidenceBundle;
  evidenceSha256: string;
}): AiShadowRunEvidenceBundle {
  const evaluation = evaluateModelPromotionEvidenceBundle(args);
  if (!evaluation.allowed) {
    throw new Error(`AI model promotion shadow evidence blocked: ${evaluation.blockers.join('; ')}`);
  }
  return AiShadowRunEvidenceBundleSchema.parse(args.evidenceBundle);
}
