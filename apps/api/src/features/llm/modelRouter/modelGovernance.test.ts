import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { AiModelPromotionRecord, AiShadowModePolicy, RoutedModelExecution } from '@signacare/shared';
import {
  DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS,
  aggregateShadowRunQualityMetrics,
  assertModelPromotionAllowed,
  assertModelPromotionEvidenceBundleAllowed,
  buildShadowRunEvidenceBundle,
  calculateEditDistanceRatio,
  evaluateShadowRunEligibility,
  evaluateModelPromotionEvidenceBundle,
  evaluateModelPromotionRecord,
  hashShadowRunMetrics,
  scoreShadowCandidate,
} from './modelGovernance';

const EXECUTION_PRIMARY: RoutedModelExecution = {
  alias: 'best_clinical',
  backend: 'azure_openai',
  modelName: 'gpt-clinical-current',
  modelVersion: '2026-05-01',
  deployment: 'sig-best-clinical-staging',
  localStyleAdapterModelName: null,
};

const EXECUTION_CHALLENGER: RoutedModelExecution = {
  alias: 'best_clinical',
  backend: 'azure_openai',
  modelName: 'gpt-clinical-candidate',
  modelVersion: '2026-06-01',
  deployment: 'sig-best-clinical-candidate',
  localStyleAdapterModelName: null,
};

const SHADOW_POLICY: AiShadowModePolicy = {
  schemaVersion: '1.0',
  enabled: true,
  policyVersion: 'shadow-policy-2026-06',
  eligibleAliases: ['best_clinical', 'fast_clinical'],
  eligibleActions: ['clinical-summary', '5p-formulation'],
  sampleRatePct: 10,
  maxAdditionalLatencyMs: 5000,
  maxAdditionalCostAudPerDay: 20,
  requireCitationScoring: true,
  requireClinicianConsent: true,
};

function goodPromotionRecord(): AiModelPromotionRecord {
  return {
    schemaVersion: '1.0',
    alias: 'best_clinical',
    decision: 'promote',
    policyVersion: 'ai-governance-2026-06',
    fromDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
    toDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
    evidenceUri: 'docs/quality/ai-model-governance/best-clinical-20260606.json',
    shadowEvidenceUri: 'docs/quality/ai-model-governance/best-clinical-20260606-shadow.json',
    shadowEvidenceSha256: `sha256:${'c'.repeat(64)}`,
    approvedByUserId: '11111111-1111-1111-1111-111111111111',
    approvedAt: '2026-06-06T01:00:00.000Z',
    rollbackPlanUri: 'docs/operations/runbooks/ai-model-rollback.md',
    thresholds: DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS,
    aggregateQuality: {
      shadowSampleSize: 42,
      meanEditDistanceRatio: 0.12,
      meanCitationCoverageRatio: 0.96,
      hallucinationFlagsPer100Runs: 0,
      safetyRefusalMismatchCount: 0,
      p95LatencyRegressionPct: 11,
      estimatedCostRegressionPct: 18,
    },
    trainingAdapterReview: {
      reviewed: true,
      existingAdapterCount: 1,
      compatibleAdapterCount: 1,
      incompatibleAdapterNames: [],
      adaptersRequiringRetrain: [],
      adapterCompatibility: [
        {
          localStyleAdapterModelName: 'llama3.2:dr-smith-style',
          adapterArtifactDigest: 'sha256:1234567890abcdef',
          trainedBaseModelName: 'llama3.2',
          trainedBaseModelDigest: 'sha256:abcdef1234567890',
          compatibleAliases: ['best_clinical', 'fast_clinical'],
          compatibility: 'compatible',
          evidenceUri: 'docs/quality/ai-model-governance/dr-smith-style-compat.json',
        },
      ],
    },
  };
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function cleanShadowMetric(index: number) {
  return scoreShadowCandidate({
    alias: 'best_clinical',
    action: 'clinical-summary',
    primaryExecution: EXECUTION_PRIMARY,
    challengerExecution: EXECUTION_CHALLENGER,
    baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
    candidateDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
    primaryOutput: `Mood low. Thought form linear. No psychosis elicited. Evidence ${index}.`,
    challengerOutput: `Mood low. Thought form linear. No psychosis elicited. Evidence ${index}.`,
    citationsRequired: 3,
    citationsWithEvidence: 3,
    primaryLatencyMs: 1000,
    challengerLatencyMs: 1100,
    primaryEstimatedCostAud: 0.05,
    challengerEstimatedCostAud: 0.055,
    estimatedAdditionalCostAud: 0.005,
    cachedPromptTokens: 1024,
  });
}

function cleanNoChangeShadowMetric(index: number) {
  return scoreShadowCandidate({
    alias: 'best_clinical',
    action: 'clinical-summary',
    primaryExecution: EXECUTION_PRIMARY,
    challengerExecution: EXECUTION_PRIMARY,
    baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
    candidateDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
    primaryOutput: `Mood low. Thought form linear. No psychosis elicited. Evidence ${index}.`,
    challengerOutput: `Mood low. Thought form linear. No psychosis elicited. Evidence ${index}.`,
    citationsRequired: 3,
    citationsWithEvidence: 3,
    primaryLatencyMs: 1000,
    challengerLatencyMs: 1000,
    primaryEstimatedCostAud: 0.05,
    challengerEstimatedCostAud: 0.05,
    estimatedAdditionalCostAud: 0,
    cachedPromptTokens: 1024,
  });
}

describe('modelGovernance — shadow scoring', () => {
  it('calculates bounded edit-distance and citation coverage metrics', () => {
    const metrics = scoreShadowCandidate({
      alias: 'best_clinical',
      action: 'clinical-summary',
      primaryExecution: EXECUTION_PRIMARY,
      challengerExecution: EXECUTION_CHALLENGER,
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-candidate@2026-06-01',
      primaryOutput: 'Mental state: mood low, thought form linear, no psychosis elicited.',
      challengerOutput: 'Mental state: mood was low, thought form linear, no psychosis was elicited.',
      citationsRequired: 4,
      citationsWithEvidence: 3,
      primaryLatencyMs: 1200,
      challengerLatencyMs: 1320,
      primaryEstimatedCostAud: 0.04,
      challengerEstimatedCostAud: 0.07,
      estimatedAdditionalCostAud: 0.03,
      cachedPromptTokens: 1024,
    });

    expect(metrics.schemaVersion).toBe('1.0');
    expect(metrics.editDistanceRatio).toBeGreaterThan(0);
    expect(metrics.editDistanceRatio).toBeLessThan(0.35);
    expect(metrics.citationCoverageRatio).toBe(0.75);
    expect(metrics.cachedPromptTokens).toBe(1024);
  });

  it('treats identical clinical text as zero edit distance', () => {
    expect(calculateEditDistanceRatio('No acute risk identified.', 'No acute risk identified.')).toBe(0);
  });
});

describe('modelGovernance — shadow eligibility gate', () => {
  it('allows an explicitly included shadow run when policy, consent, latency, cost, and citations are clean', () => {
    const decision = evaluateShadowRunEligibility({
      schemaVersion: '1.0',
      policy: SHADOW_POLICY,
      alias: 'best_clinical',
      action: 'clinical-summary',
      clinicianConsentRecorded: true,
      citationScoringAvailable: true,
      estimatedAdditionalLatencyMs: 1200,
      estimatedAdditionalCostAudToday: 4,
      estimatedRequestCostAud: 0.08,
      deterministicSampleSeed: 'patient-session-20260606-0001',
      forceInclude: true,
    });

    expect(decision.eligible).toBe(true);
    expect(decision.sampled).toBe(true);
    expect(decision.blockers).toEqual([]);
  });

  it('blocks shadow runs that exceed clinical governance policy', () => {
    const decision = evaluateShadowRunEligibility({
      schemaVersion: '1.0',
      policy: SHADOW_POLICY,
      alias: 'court_report_reasoning',
      action: 'mhrt-report',
      clinicianConsentRecorded: false,
      citationScoringAvailable: false,
      estimatedAdditionalLatencyMs: 8000,
      estimatedAdditionalCostAudToday: 19.99,
      estimatedRequestCostAud: 0.5,
      deterministicSampleSeed: 'patient-session-20260606-0002',
      forceInclude: true,
    });

    expect(decision.eligible).toBe(false);
    expect(decision.blockers.join('\n')).toContain('alias court_report_reasoning is not eligible');
    expect(decision.blockers.join('\n')).toContain('action mhrt-report is not eligible');
    expect(decision.blockers.join('\n')).toContain('clinician consent is required');
    expect(decision.blockers.join('\n')).toContain('citation scoring is required');
    expect(decision.blockers.join('\n')).toContain('estimated additional latency 8000ms exceeds 5000ms');
    expect(decision.blockers.join('\n')).toContain('projected daily shadow cost 20.4900 AUD exceeds 20.0000 AUD');
  });

  it('uses deterministic sampling so repeated shadow decisions are stable', () => {
    const input = {
      schemaVersion: '1.0' as const,
      policy: { ...SHADOW_POLICY, sampleRatePct: 0 },
      alias: 'best_clinical' as const,
      action: 'clinical-summary',
      clinicianConsentRecorded: true,
      citationScoringAvailable: true,
      estimatedAdditionalLatencyMs: 100,
      estimatedAdditionalCostAudToday: 0,
      estimatedRequestCostAud: 0.01,
      deterministicSampleSeed: 'same-session-same-job-0000000001',
      forceInclude: false,
    };

    const first = evaluateShadowRunEligibility(input);
    const second = evaluateShadowRunEligibility(input);

    expect(first.sampleBucket).toBe(second.sampleBucket);
    expect(first.eligible).toBe(false);
    expect(first.blockers.join('\n')).toContain('outside deterministic shadow sample bucket');
  });
});

describe('modelGovernance — shadow aggregation', () => {
  it('builds promotion-quality aggregate evidence from scored shadow runs', () => {
    const first = scoreShadowCandidate({
      alias: 'best_clinical',
      action: 'clinical-summary',
      primaryExecution: EXECUTION_PRIMARY,
      challengerExecution: EXECUTION_CHALLENGER,
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-candidate@2026-06-01',
      primaryOutput: 'Mood low. No psychosis elicited.',
      challengerOutput: 'Mood low. No psychotic symptoms elicited.',
      citationsRequired: 2,
      citationsWithEvidence: 2,
      primaryLatencyMs: 1000,
      challengerLatencyMs: 1200,
      primaryEstimatedCostAud: 0.05,
      challengerEstimatedCostAud: 0.06,
      estimatedAdditionalCostAud: 0.01,
    });
    const second = scoreShadowCandidate({
      alias: 'best_clinical',
      action: 'clinical-summary',
      primaryExecution: EXECUTION_PRIMARY,
      challengerExecution: EXECUTION_CHALLENGER,
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-candidate@2026-06-01',
      primaryOutput: 'Risk to self denied. Safety plan reviewed.',
      challengerOutput: 'Risk to self denied. Safety plan was reviewed.',
      citationsRequired: 2,
      citationsWithEvidence: 1,
      primaryLatencyMs: 1100,
      challengerLatencyMs: 1210,
      primaryEstimatedCostAud: 0.05,
      challengerEstimatedCostAud: 0.055,
      estimatedAdditionalCostAud: 0.005,
      safetyRefusalMismatch: true,
    });

    const aggregate = aggregateShadowRunQualityMetrics([first, second]);

    expect(aggregate.shadowSampleSize).toBe(2);
    expect(aggregate.meanCitationCoverageRatio).toBe(0.75);
    expect(aggregate.safetyRefusalMismatchCount).toBe(1);
    expect(aggregate.p95LatencyRegressionPct).toBe(20);
    expect(aggregate.estimatedCostRegressionPct).toBe(15);
  });

  it('builds a hash-bound shadow evidence bundle from per-run metrics', () => {
    const metrics = [cleanShadowMetric(1), cleanShadowMetric(2)];
    const bundle = buildShadowRunEvidenceBundle({
      policyVersion: 'ai-governance-2026-06',
      alias: 'best_clinical',
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
      generatedAt: '2026-06-06T02:00:00.000Z',
      metrics,
    });

    expect(bundle.metricsSha256).toBe(hashShadowRunMetrics(metrics));
    expect(bundle.aggregateQuality).toEqual(aggregateShadowRunQualityMetrics(metrics));
  });
});

describe('modelGovernance — promotion evaluation', () => {
  it('allows a promotion only when quality, safety, cost, latency, and adapter review are clean', () => {
    const record = goodPromotionRecord();
    const result = evaluateModelPromotionRecord(record);
    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(() => assertModelPromotionAllowed(record)).not.toThrow();
  });

  it('allows a no-change production attestation only when the deployment remains pinned', () => {
    const record = goodPromotionRecord();
    record.decision = 'no_change';
    record.toDeploymentRef = record.fromDeploymentRef;

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(() => assertModelPromotionAllowed(record)).not.toThrow();
  });

  it('blocks no-change attestations that move the model deployment', () => {
    const record = goodPromotionRecord();
    record.decision = 'no_change';

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(false);
    expect(result.blockers.join('\n')).toContain(
      'no_change records must keep fromDeploymentRef and toDeploymentRef identical',
    );
  });

  it('blocks weak quality evidence', () => {
    const record = goodPromotionRecord();
    record.aggregateQuality.shadowSampleSize = 3;
    record.aggregateQuality.meanCitationCoverageRatio = 0.5;
    record.aggregateQuality.hallucinationFlagsPer100Runs = 4;

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(false);
    expect(result.blockers.join('\n')).toContain('shadow sample size 3 is below minimum 30');
    expect(result.blockers.join('\n')).toContain('citation coverage 0.5 is below 0.9');
    expect(result.blockers.join('\n')).toContain('hallucination flags per 100 runs 4 exceeds 0');
  });

  it('blocks model swaps that would invalidate clinician training adapters', () => {
    const record = goodPromotionRecord();
    record.trainingAdapterReview.compatibleAdapterCount = 0;
    record.trainingAdapterReview.adaptersRequiringRetrain = ['llama3.2:dr-smith-style'];
    record.trainingAdapterReview.adapterCompatibility[0].compatibility = 'requires_retrain';

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(false);
    expect(result.blockers.join('\n')).toContain('only 0/1 training adapters are compatible');
    expect(result.blockers.join('\n')).toContain('training adapters requiring retrain: llama3.2:dr-smith-style');
    expect(result.blockers.join('\n')).toContain('adapter llama3.2:dr-smith-style is requires_retrain');
  });

  it('blocks compatible adapter claims without target alias and digest-backed evidence', () => {
    const record = goodPromotionRecord();
    record.trainingAdapterReview.adapterCompatibility[0].compatibleAliases = ['fast_clinical'];
    record.trainingAdapterReview.adapterCompatibility[0].adapterArtifactDigest = null;
    record.trainingAdapterReview.adapterCompatibility[0].trainedBaseModelDigest = null;
    record.trainingAdapterReview.adapterCompatibility[0].evidenceUri = null;

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(false);
    expect(result.blockers.join('\n')).toContain(
      'adapter llama3.2:dr-smith-style is not compatible with alias best_clinical',
    );
    expect(result.blockers.join('\n')).toContain('adapter llama3.2:dr-smith-style is missing an artifact digest');
    expect(result.blockers.join('\n')).toContain(
      'adapter llama3.2:dr-smith-style is missing a trained base-model digest',
    );
    expect(result.blockers.join('\n')).toContain('adapter llama3.2:dr-smith-style is missing compatibility evidence');
  });

  it('blocks incomplete adapter compatibility evidence even when counts claim compatibility', () => {
    const record = goodPromotionRecord();
    record.trainingAdapterReview.existingAdapterCount = 2;
    record.trainingAdapterReview.compatibleAdapterCount = 2;

    const result = evaluateModelPromotionRecord(record);

    expect(result.allowed).toBe(false);
    expect(result.blockers.join('\n')).toContain('adapter compatibility evidence covers 1/2 existing adapters');
  });

  it('blocks promotion records without a rollback plan or approval identity at schema boundary', () => {
    const record = goodPromotionRecord();
    record.rollbackPlanUri = '';
    record.approvedByUserId = 'not-a-uuid';

    expect(() => evaluateModelPromotionRecord(record)).toThrow();
  });

  it('allows promotion evidence only when record aggregate matches raw shadow-run metrics', () => {
    const metrics = Array.from(
      { length: DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS.minShadowSampleSize },
      (_, index) => cleanShadowMetric(index),
    );
    const bundle = buildShadowRunEvidenceBundle({
      policyVersion: 'ai-governance-2026-06',
      alias: 'best_clinical',
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
      generatedAt: '2026-06-06T02:00:00.000Z',
      metrics,
    });
    const evidenceSha256 = sha256Json(bundle);
    const record = goodPromotionRecord();
    record.aggregateQuality = bundle.aggregateQuality;
    record.shadowEvidenceSha256 = evidenceSha256;

    const evaluation = evaluateModelPromotionEvidenceBundle({
      promotionRecord: record,
      evidenceBundle: bundle,
      evidenceSha256,
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.blockers).toEqual([]);
    expect(() => assertModelPromotionEvidenceBundleAllowed({
      promotionRecord: record,
      evidenceBundle: bundle,
      evidenceSha256,
    })).not.toThrow();
  });

  it('blocks promotion evidence when aggregate metrics drift from raw shadow-run metrics', () => {
    const metrics = Array.from(
      { length: DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS.minShadowSampleSize },
      (_, index) => cleanShadowMetric(index),
    );
    const bundle = buildShadowRunEvidenceBundle({
      policyVersion: 'ai-governance-2026-06',
      alias: 'best_clinical',
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
      generatedAt: '2026-06-06T02:00:00.000Z',
      metrics,
    });
    const record = goodPromotionRecord();
    record.aggregateQuality = {
      ...bundle.aggregateQuality,
      meanCitationCoverageRatio: 0.5,
    };
    record.shadowEvidenceSha256 = sha256Json(bundle);

    const evaluation = evaluateModelPromotionEvidenceBundle({
      promotionRecord: record,
      evidenceBundle: bundle,
      evidenceSha256: record.shadowEvidenceSha256,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.blockers.join('\n')).toContain(
      'promotion record aggregateQuality does not match recomputed shadow evidence aggregate',
    );
  });

  it('blocks promotion evidence when raw shadow metrics belong to another alias or deployment', () => {
    const metrics = Array.from(
      { length: DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS.minShadowSampleSize },
      (_, index) => cleanShadowMetric(index),
    );
    metrics[0] = {
      ...metrics[0],
      alias: 'fast_clinical',
      baselineDeploymentRef: 'sig-fast-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-fast-clinical-prod@2026-06-01',
    };
    const bundle = buildShadowRunEvidenceBundle({
      policyVersion: 'ai-governance-2026-06',
      alias: 'best_clinical',
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-prod@2026-06-01',
      generatedAt: '2026-06-06T02:00:00.000Z',
      metrics,
    });
    const record = goodPromotionRecord();
    record.aggregateQuality = bundle.aggregateQuality;
    record.shadowEvidenceSha256 = sha256Json(bundle);

    const evaluation = evaluateModelPromotionEvidenceBundle({
      promotionRecord: record,
      evidenceBundle: bundle,
      evidenceSha256: record.shadowEvidenceSha256,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.blockers.join('\n')).toContain(
      'shadow metric 0 alias fast_clinical does not match promotion record best_clinical',
    );
    expect(evaluation.blockers.join('\n')).toContain(
      'shadow metric 0 baseline deployment does not match promotion record',
    );
    expect(evaluation.blockers.join('\n')).toContain(
      'shadow metric 0 candidate deployment does not match promotion record',
    );
  });

  it('allows no-change evidence only when raw shadow metrics stay on the pinned deployment', () => {
    const metrics = Array.from(
      { length: DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS.minShadowSampleSize },
      (_, index) => cleanNoChangeShadowMetric(index),
    );
    const bundle = buildShadowRunEvidenceBundle({
      policyVersion: 'ai-governance-2026-06',
      alias: 'best_clinical',
      baselineDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      candidateDeploymentRef: 'sig-best-clinical-staging@2026-05-01',
      generatedAt: '2026-06-06T02:00:00.000Z',
      metrics,
    });
    const record = goodPromotionRecord();
    record.decision = 'no_change';
    record.toDeploymentRef = record.fromDeploymentRef;
    record.aggregateQuality = bundle.aggregateQuality;
    record.shadowEvidenceSha256 = sha256Json(bundle);

    const evaluation = evaluateModelPromotionEvidenceBundle({
      promotionRecord: record,
      evidenceBundle: bundle,
      evidenceSha256: record.shadowEvidenceSha256,
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.blockers).toEqual([]);
  });
});
