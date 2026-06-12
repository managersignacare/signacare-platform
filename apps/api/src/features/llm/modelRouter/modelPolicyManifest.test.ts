import { describe, expect, it } from 'vitest';
import { AiTextGenerationModelAliasSchema, type AiModelPromotionRecord } from '@signacare/shared';
import { DEFAULT_AI_MODEL_PROMOTION_THRESHOLDS } from './modelGovernance';
import {
  AI_MODEL_POLICY_MANIFEST,
  assertAliasPromotionAllowedByManifest,
  assertModelPolicyManifestCoversAliases,
  getModelAliasPolicy,
} from './modelPolicyManifest';

function goodPromotionRecord(alias: AiModelPromotionRecord['alias'] = 'best_clinical'): AiModelPromotionRecord {
  return {
    schemaVersion: '1.0',
    alias,
    decision: 'promote',
    policyVersion: 'ai-governance-2026-06',
    fromDeploymentRef: `sig-${alias}-staging@2026-05-01`,
    toDeploymentRef: `sig-${alias}-prod@2026-06-01`,
    evidenceUri: `docs/quality/ai-model-governance/${alias}-20260606.json`,
    shadowEvidenceUri: `docs/quality/ai-model-governance/${alias}-20260606-shadow.json`,
    shadowEvidenceSha256: `sha256:${'d'.repeat(64)}`,
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

describe('modelPolicyManifest', () => {
  it('covers every model alias exactly once', () => {
    expect(() => assertModelPolicyManifestCoversAliases()).not.toThrow();
    expect(AI_MODEL_POLICY_MANIFEST.policies.map((policy) => policy.alias).sort()).toEqual(
      [...AiTextGenerationModelAliasSchema.options].sort(),
    );
  });

  it('declares adapter-preservation policy invariants separately from runtime model aliases', () => {
    for (const policy of AI_MODEL_POLICY_MANIFEST.policies) {
      expect(policy.trainerAdapterDecoupled).toBe(true);
      expect(policy.modelSwapInvalidatesLocalStyleAdapters).toBe(false);
      expect(policy.promotionRequiresGovernanceRecord).toBe(true);
    }
  });

  it('keeps policy manifest scoped to text-generation aliases, not ASR backends', () => {
    expect(AI_MODEL_POLICY_MANIFEST.policies.map((policy) => policy.alias)).not.toContain('asr_default');
    expect(getModelAliasPolicy('fast_clinical').localStyleAdapterAllowed).toBe(true);
    expect(getModelAliasPolicy('court_report_reasoning').localStyleAdapterAllowed).toBe(true);
  });

  it('requires a clean matching governance record before an alias promotion can use the manifest policy', () => {
    expect(
      assertAliasPromotionAllowedByManifest({
        alias: 'best_clinical',
        promotionRecord: goodPromotionRecord('best_clinical'),
      }).alias,
    ).toBe('best_clinical');

    expect(() =>
      assertAliasPromotionAllowedByManifest({
        alias: 'best_clinical',
        promotionRecord: goodPromotionRecord('fast_clinical'),
      }),
    ).toThrow('AI model promotion alias mismatch: policy=best_clinical record=fast_clinical');

    const weakRecord = goodPromotionRecord('best_clinical');
    weakRecord.trainingAdapterReview.compatibleAdapterCount = 0;
    weakRecord.trainingAdapterReview.adaptersRequiringRetrain = ['llama3.2:dr-smith-style'];
    weakRecord.trainingAdapterReview.adapterCompatibility[0].compatibility = 'requires_retrain';

    expect(() =>
      assertAliasPromotionAllowedByManifest({
        alias: 'best_clinical',
        promotionRecord: weakRecord,
      }),
    ).toThrow('AI model promotion blocked');
  });

  it('allows a checked no-change governance record through the alias manifest', () => {
    const record = goodPromotionRecord('best_clinical');
    record.decision = 'no_change';
    record.toDeploymentRef = record.fromDeploymentRef;

    expect(
      assertAliasPromotionAllowedByManifest({
        alias: 'best_clinical',
        promotionRecord: record,
      }).alias,
    ).toBe('best_clinical');
  });
});
