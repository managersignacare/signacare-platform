import { z } from 'zod';
import {
  AiTextGenerationModelAliasSchema,
  LocalStyleAdapterModelNameSchema,
  RoutedModelExecutionSchema,
} from './modelRouter.schemas';

export const AI_MODEL_GOVERNANCE_SCHEMA_VERSION = '1.0' as const;
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ACR_DIGEST_IMAGE_RE = /^[a-z0-9][a-z0-9.-]*\.azurecr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;

export const AiModelPromotionDecisionSchema = z.enum(['promote', 'no_change', 'hold', 'reject', 'rollback']);
export type AiModelPromotionDecision = z.infer<typeof AiModelPromotionDecisionSchema>;

export const AiShadowModePolicySchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  enabled: z.boolean(),
  policyVersion: z.string().min(1).max(80),
  eligibleAliases: z.array(AiTextGenerationModelAliasSchema).min(1),
  eligibleActions: z.array(z.string().min(1).max(120)).min(1),
  sampleRatePct: z.number().min(0).max(20),
  maxAdditionalLatencyMs: z.number().int().positive(),
  maxAdditionalCostAudPerDay: z.number().nonnegative(),
  requireCitationScoring: z.boolean(),
  requireClinicianConsent: z.boolean(),
});
export type AiShadowModePolicy = z.infer<typeof AiShadowModePolicySchema>;

export const AiShadowRunEligibilityInputSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  policy: AiShadowModePolicySchema,
  alias: AiTextGenerationModelAliasSchema,
  action: z.string().min(1).max(120),
  clinicianConsentRecorded: z.boolean(),
  citationScoringAvailable: z.boolean(),
  estimatedAdditionalLatencyMs: z.number().int().nonnegative(),
  estimatedAdditionalCostAudToday: z.number().nonnegative(),
  estimatedRequestCostAud: z.number().nonnegative(),
  deterministicSampleSeed: z.string().min(16).max(500),
  forceInclude: z.boolean().default(false),
});
export type AiShadowRunEligibilityInput = z.infer<typeof AiShadowRunEligibilityInputSchema>;

export const AiShadowRunEligibilityDecisionSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  policyVersion: z.string().min(1).max(80),
  alias: AiTextGenerationModelAliasSchema,
  action: z.string().min(1).max(120),
  eligible: z.boolean(),
  sampled: z.boolean(),
  sampleBucket: z.number().int().min(0).max(9999),
  blockers: z.array(z.string().min(1)),
});
export type AiShadowRunEligibilityDecision = z.infer<typeof AiShadowRunEligibilityDecisionSchema>;

export const AiShadowRunQualityMetricsSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  alias: AiTextGenerationModelAliasSchema,
  action: z.string().min(1).max(120),
  primaryExecution: RoutedModelExecutionSchema,
  challengerExecution: RoutedModelExecutionSchema,
  baselineDeploymentRef: z.string().min(1).max(400),
  candidateDeploymentRef: z.string().min(1).max(400),
  editDistanceRatio: z.number().min(0).max(1),
  citationCoverageRatio: z.number().min(0).max(1),
  hallucinationFlagCount: z.number().int().min(0),
  safetyRefusalMismatch: z.boolean(),
  primaryLatencyMs: z.number().int().nonnegative(),
  challengerLatencyMs: z.number().int().nonnegative(),
  primaryEstimatedCostAud: z.number().nonnegative(),
  challengerEstimatedCostAud: z.number().nonnegative(),
  estimatedAdditionalCostAud: z.number().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative().nullable(),
  clinicianAcceptedCandidate: z.boolean().nullable(),
  clinicianRatingDelta: z.number().min(-5).max(5).nullable(),
});
export type AiShadowRunQualityMetrics = z.infer<typeof AiShadowRunQualityMetricsSchema>;

export const AiModelPromotionThresholdsSchema = z.object({
  minShadowSampleSize: z.number().int().positive(),
  maxEditDistanceRatio: z.number().min(0).max(1),
  minCitationCoverageRatio: z.number().min(0).max(1),
  maxHallucinationFlagsPer100Runs: z.number().min(0),
  maxP95LatencyRegressionPct: z.number().min(0).max(200),
  maxEstimatedCostRegressionPct: z.number().min(0).max(500),
});
export type AiModelPromotionThresholds = z.infer<typeof AiModelPromotionThresholdsSchema>;

export const AiModelPromotionAggregateQualitySchema = z.object({
  shadowSampleSize: z.number().int().min(0),
  meanEditDistanceRatio: z.number().min(0).max(1),
  meanCitationCoverageRatio: z.number().min(0).max(1),
  hallucinationFlagsPer100Runs: z.number().min(0),
  safetyRefusalMismatchCount: z.number().int().min(0),
  p95LatencyRegressionPct: z.number(),
  estimatedCostRegressionPct: z.number(),
});
export type AiModelPromotionAggregateQuality = z.infer<typeof AiModelPromotionAggregateQualitySchema>;

export const AiShadowRunEvidenceBundleSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  policyVersion: z.string().min(1).max(80),
  alias: AiTextGenerationModelAliasSchema,
  baselineDeploymentRef: z.string().min(1).max(400),
  candidateDeploymentRef: z.string().min(1).max(400),
  generatedAt: z.string().datetime(),
  metricsSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  metrics: z.array(AiShadowRunQualityMetricsSchema).min(1),
  aggregateQuality: AiModelPromotionAggregateQualitySchema,
});
export type AiShadowRunEvidenceBundle = z.infer<typeof AiShadowRunEvidenceBundleSchema>;

export const AiTrainingAdapterCompatibilitySchema = z.object({
  localStyleAdapterModelName: LocalStyleAdapterModelNameSchema,
  adapterArtifactDigest: z.string().regex(/^sha256:[a-f0-9]{12,64}$/).nullable(),
  trainedBaseModelName: z.string().min(1).max(200),
  trainedBaseModelDigest: z.string().regex(/^sha256:[a-f0-9]{12,64}$/).nullable(),
  compatibleAliases: z.array(AiTextGenerationModelAliasSchema).min(1),
  compatibility: z.enum(['compatible', 'requires_validation', 'requires_retrain', 'incompatible']),
  evidenceUri: z.string().min(1).max(500).nullable(),
});
export type AiTrainingAdapterCompatibility = z.infer<typeof AiTrainingAdapterCompatibilitySchema>;

export const AiTrainingAdapterReviewSchema = z.object({
  reviewed: z.boolean(),
  existingAdapterCount: z.number().int().min(0),
  compatibleAdapterCount: z.number().int().min(0),
  incompatibleAdapterNames: z.array(z.string().min(1).max(200)),
  adaptersRequiringRetrain: z.array(z.string().min(1).max(200)),
  adapterCompatibility: z.array(AiTrainingAdapterCompatibilitySchema),
});
export type AiTrainingAdapterReview = z.infer<typeof AiTrainingAdapterReviewSchema>;

export const SovereignModelArtifactManifestSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  lane: z.literal('sovereign_gpu'),
  backendRuntime: z.enum(['ollama', 'vllm']),
  imageRef: z.string().regex(ACR_DIGEST_IMAGE_RE),
  modelName: z.string().min(1).max(200),
  modelManifestSha256: z.string().regex(SHA256_DIGEST_RE),
  bakedModelPath: z.string().min(1).max(300),
  runtimePullAllowed: z.literal(false),
  inferenceTrainingSeparated: z.literal(true),
  inferencePoolTaint: z.literal('signacare.io/lane=inference:NoSchedule'),
  trainingPoolTaint: z.literal('signacare.io/lane=training:NoSchedule'),
  healthCheckPath: z.string().min(1).max(200),
  builtFromCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
  buildPipelineRunId: z.string().min(1).max(120),
  buildEvidenceUri: z.string().min(1).max(500),
  vulnerabilityScanUri: z.string().min(1).max(500),
  rollbackImageRef: z.string().regex(ACR_DIGEST_IMAGE_RE),
  trainingAdapterReview: AiTrainingAdapterReviewSchema,
  approvedByUserId: z.string().uuid(),
  approvedAt: z.string().datetime(),
});
export type SovereignModelArtifactManifest = z.infer<typeof SovereignModelArtifactManifestSchema>;

export const AiModelPromotionRecordSchema = z.object({
  schemaVersion: z.literal(AI_MODEL_GOVERNANCE_SCHEMA_VERSION),
  alias: AiTextGenerationModelAliasSchema,
  decision: AiModelPromotionDecisionSchema,
  policyVersion: z.string().min(1).max(80),
  fromDeploymentRef: z.string().min(1).max(400),
  toDeploymentRef: z.string().min(1).max(400),
  evidenceUri: z.string().min(1).max(500),
  shadowEvidenceUri: z.string().min(1).max(500),
  shadowEvidenceSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  approvedByUserId: z.string().uuid(),
  approvedAt: z.string().datetime(),
  rollbackPlanUri: z.string().min(1).max(500),
  thresholds: AiModelPromotionThresholdsSchema,
  aggregateQuality: AiModelPromotionAggregateQualitySchema,
  trainingAdapterReview: AiTrainingAdapterReviewSchema,
});
export type AiModelPromotionRecord = z.infer<typeof AiModelPromotionRecordSchema>;
