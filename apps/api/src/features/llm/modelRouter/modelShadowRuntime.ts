import type {
  AiLlmBackend,
  AiShadowModePolicy,
  AiShadowRunEligibilityDecision,
  AiShadowRunQualityMetrics,
  RoutedModelExecution,
} from '@signacare/shared';
import { AiLlmBackendSchema, AiTextGenerationModelAliasSchema } from '@signacare/shared';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { logger } from '../../../utils/logger';
import { recordLlmInteraction } from '../../../shared/recordLlmInteraction';
import {
  evaluateShadowRunEligibility,
  scoreShadowCandidate,
} from './modelGovernance';
import type {
  LockedAiRuntimeSelection,
  RoutedTextGenerationRequest,
  RoutedTextGenerationResult,
} from './modelRouter';

export interface ShadowRuntimeOptions {
  clinicianConsentRecorded?: boolean;
  citationScoringAvailable?: boolean;
  citationsRequired?: number;
  citationsWithEvidence?: number;
  hallucinationFlagCount?: number;
  safetyRefusalMismatch?: boolean;
  estimatedAdditionalCostAudToday?: number;
  estimatedRequestCostAud?: number;
  deterministicSampleSeed?: string;
  forceInclude?: boolean;
  userId?: string | null;
  patientId?: string | null;
  episodeId?: string | null;
}

export interface ShadowRuntimeConfig {
  enabled: boolean;
  policy: AiShadowModePolicy;
  challengerBackend: AiLlmBackend;
  challengerLocalModel: string | null;
  estimatedAdditionalLatencyMs: number;
  estimatedRequestCostAud: number;
  estimatedAdditionalCostAudToday: number;
}

export interface ShadowExecutionInput {
  request: RoutedTextGenerationRequest;
  primaryResult: RoutedTextGenerationResult;
  primaryLatencyMs: number;
  config?: ShadowRuntimeConfig;
  runChallenger: (request: RoutedTextGenerationRequest) => Promise<RoutedTextGenerationResult>;
  auditWriter?: (args: ShadowAuditRecord) => Promise<void>;
}

export interface ShadowAuditRecord {
  request: RoutedTextGenerationRequest;
  decision: AiShadowRunEligibilityDecision;
  metrics: AiShadowRunQualityMetrics;
  primaryResult: RoutedTextGenerationResult;
  challengerResult: RoutedTextGenerationResult;
  challengerLatencyMs: number;
}

const DEFAULT_SHADOW_POLICY_VERSION = 'shadow-policy-2026-06';
const DEFAULT_ELIGIBLE_ALIASES = AiTextGenerationModelAliasSchema.options;
const DEFAULT_ELIGIBLE_ACTIONS = [
  'clinical-summary',
  '5p-formulation',
  'ambient',
  'report-insight',
  'handover-summary',
  'medication-adherence',
  'mhrt-report',
  'ect-summary',
  'lifechart-schema',
  'linkages',
];

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  throw new Error(
    `${name} must be one of true,false,1,0,yes,no; received ${process.env[name]}`,
  );
}

function parseNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseCsvEnv(name: string, fallback: readonly string[]): string[] {
  const value = process.env[name]?.trim();
  if (!value) return [...fallback];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stablePromptHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deploymentRef(execution: RoutedModelExecution): string {
  const modelVersion = execution.modelVersion ?? 'unknown';
  if (execution.deployment) return `${execution.deployment}@${modelVersion}`;
  return `${execution.modelName}@${modelVersion}`;
}

function providerFromBackend(backend: AiLlmBackend): 'azure_openai' | 'ollama' {
  return backend === 'azure_openai' ? 'azure_openai' : 'ollama';
}

function errorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => issue.message).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

export function resolveShadowRuntimeConfigFromEnv(): ShadowRuntimeConfig {
  const enabled = parseBooleanEnv('AI_SHADOW_MODE_ENABLED', false);
  const challengerBackend = AiLlmBackendSchema.parse(
    process.env.AI_SHADOW_MODE_CHALLENGER_BACKEND?.trim() || 'local_ollama',
  );
  const eligibleAliases = parseCsvEnv('AI_SHADOW_MODE_ELIGIBLE_ALIASES', DEFAULT_ELIGIBLE_ALIASES)
    .map((alias) => AiTextGenerationModelAliasSchema.parse(alias));

  return {
    enabled,
    challengerBackend,
    challengerLocalModel: process.env.AI_SHADOW_MODE_CHALLENGER_LOCAL_MODEL?.trim() || null,
    estimatedAdditionalLatencyMs: Math.trunc(parseNumberEnv('AI_SHADOW_MODE_ESTIMATED_LATENCY_MS', 2_000)),
    estimatedRequestCostAud: parseNumberEnv('AI_SHADOW_MODE_ESTIMATED_REQUEST_COST_AUD', 0.01),
    estimatedAdditionalCostAudToday: parseNumberEnv('AI_SHADOW_MODE_ESTIMATED_COST_AUD_TODAY', 0),
    policy: {
      schemaVersion: '1.0',
      enabled,
      policyVersion: process.env.AI_SHADOW_MODE_POLICY_VERSION?.trim() || DEFAULT_SHADOW_POLICY_VERSION,
      eligibleAliases,
      eligibleActions: parseCsvEnv('AI_SHADOW_MODE_ELIGIBLE_ACTIONS', DEFAULT_ELIGIBLE_ACTIONS),
      sampleRatePct: Math.min(parseNumberEnv('AI_SHADOW_MODE_SAMPLE_RATE_PCT', 0), 20),
      maxAdditionalLatencyMs: Math.max(
        1,
        Math.trunc(parseNumberEnv('AI_SHADOW_MODE_MAX_ADDITIONAL_LATENCY_MS', 5_000)),
      ),
      maxAdditionalCostAudPerDay: parseNumberEnv('AI_SHADOW_MODE_MAX_ADDITIONAL_COST_AUD_PER_DAY', 20),
      requireCitationScoring: parseBooleanEnv('AI_SHADOW_MODE_REQUIRE_CITATION_SCORING', true),
      requireClinicianConsent: parseBooleanEnv('AI_SHADOW_MODE_REQUIRE_CLINICIAN_CONSENT', true),
    },
  };
}

function assertChallengerIdentityConfigured(config: ShadowRuntimeConfig): void {
  if (config.challengerBackend !== 'local_ollama') return;
  if (!config.challengerLocalModel) {
    throw new Error('AI shadow-mode local challenger requires AI_SHADOW_MODE_CHALLENGER_LOCAL_MODEL');
  }
}

function buildShadowSeed(request: RoutedTextGenerationRequest, primaryResult: RoutedTextGenerationResult): string {
  const suppliedSeed = request.shadowMode?.deterministicSampleSeed?.trim();
  if (suppliedSeed && suppliedSeed.length >= 16) return suppliedSeed;
  return [
    request.clinicId ?? 'no-clinic',
    request.alias,
    request.action ?? 'clinical-action',
    primaryResult.promptPrefixHash ?? stablePromptHash(request.prompt),
    stablePromptHash(request.prompt),
  ].join('|');
}

function buildChallengerRequest(
  request: RoutedTextGenerationRequest,
  config: ShadowRuntimeConfig,
): RoutedTextGenerationRequest {
  const runtimeSelection: LockedAiRuntimeSelection = {
    clinicId: request.clinicId ?? null,
    backend: config.challengerBackend,
    localStyleAdapterModelName:
      config.challengerBackend === 'local_ollama'
        ? config.challengerLocalModel
        : null,
  };

  return {
    ...request,
    runtimeSelection,
    requestedModel:
      config.challengerBackend === 'local_ollama'
        ? config.challengerLocalModel ?? undefined
        : undefined,
    allowLocalStyleAdapter: false,
    shadowMode: null,
  };
}

export async function writeShadowAuditRecord(args: ShadowAuditRecord): Promise<void> {
  const { request, decision, metrics, primaryResult, challengerResult, challengerLatencyMs } = args;
  if (!request.clinicId) return;

  await recordLlmInteraction({
    clinicId: request.clinicId,
    userId: request.shadowMode?.userId ?? undefined,
    patientId: request.shadowMode?.patientId ?? null,
    episodeId: request.shadowMode?.episodeId ?? null,
    feature: `shadow:${request.action ?? 'clinical-action'}`,
    modelName: challengerResult.execution.modelName,
    modelVersion: challengerResult.execution.modelVersion ?? undefined,
    modelProvider: providerFromBackend(challengerResult.execution.backend),
    promptTokens: challengerResult.promptTokens ?? undefined,
    completionTokens: challengerResult.completionTokens ?? undefined,
    totalTokens:
      (challengerResult.promptTokens ?? 0) + (challengerResult.completionTokens ?? 0) || undefined,
    latencyMs: challengerLatencyMs,
    success: true,
    metadata: {
      shadowMode: true,
      policyVersion: decision.policyVersion,
      alias: decision.alias,
      action: decision.action,
      sampleBucket: decision.sampleBucket,
      primaryBackend: primaryResult.execution.backend,
      challengerBackend: challengerResult.execution.backend,
      baselineDeploymentRef: metrics.baselineDeploymentRef,
      candidateDeploymentRef: metrics.candidateDeploymentRef,
      editDistanceRatio: metrics.editDistanceRatio,
      citationCoverageRatio: metrics.citationCoverageRatio,
      hallucinationFlagCount: metrics.hallucinationFlagCount,
      safetyRefusalMismatch: metrics.safetyRefusalMismatch,
      primaryLatencyMs: metrics.primaryLatencyMs,
      challengerLatencyMs: metrics.challengerLatencyMs,
      estimatedAdditionalCostAud: metrics.estimatedAdditionalCostAud,
      cachedPromptTokens: metrics.cachedPromptTokens,
      promptPrefixHash: challengerResult.promptPrefixHash,
    },
  });
}

export async function runShadowTextGenerationOnce(
  input: ShadowExecutionInput,
): Promise<AiShadowRunEligibilityDecision> {
  const config = input.config ?? resolveShadowRuntimeConfigFromEnv();
  const request = input.request;
  const shadowMode = request.shadowMode ?? {};
  const decision = evaluateShadowRunEligibility({
    schemaVersion: '1.0',
    policy: config.policy,
    alias: request.alias,
    action: request.action ?? 'clinical-action',
    clinicianConsentRecorded: shadowMode.clinicianConsentRecorded ?? false,
    citationScoringAvailable: shadowMode.citationScoringAvailable ?? false,
    estimatedAdditionalLatencyMs: config.estimatedAdditionalLatencyMs,
    estimatedAdditionalCostAudToday:
      shadowMode.estimatedAdditionalCostAudToday ?? config.estimatedAdditionalCostAudToday,
    estimatedRequestCostAud: shadowMode.estimatedRequestCostAud ?? config.estimatedRequestCostAud,
    deterministicSampleSeed: buildShadowSeed(request, input.primaryResult),
    forceInclude: shadowMode.forceInclude ?? false,
  });

  if (!decision.eligible) {
    logger.debug({
      action: 'ai_shadow_mode_skipped',
      alias: request.alias,
      clinicalAction: request.action ?? null,
      policyVersion: decision.policyVersion,
      blockers: decision.blockers,
    });
    return decision;
  }

  assertChallengerIdentityConfigured(config);
  const challengerRequest = buildChallengerRequest(request, config);
  const startedAt = Date.now();
  const challengerResult = await input.runChallenger(challengerRequest);
  const challengerLatencyMs = Date.now() - startedAt;

  if (challengerResult.fallbackFromModelName) {
    throw new Error(
      `AI shadow-mode challenger fell back from ${challengerResult.fallbackFromModelName}; fallback evidence is not promotable`,
    );
  }

  const metrics = scoreShadowCandidate({
    alias: request.alias,
    action: request.action ?? 'clinical-action',
    primaryExecution: input.primaryResult.execution,
    challengerExecution: challengerResult.execution,
    baselineDeploymentRef: deploymentRef(input.primaryResult.execution),
    candidateDeploymentRef: deploymentRef(challengerResult.execution),
    primaryOutput: input.primaryResult.text,
    challengerOutput: challengerResult.text,
    citationsRequired: shadowMode.citationsRequired ?? 0,
    citationsWithEvidence: shadowMode.citationsWithEvidence ?? 0,
    hallucinationFlagCount: shadowMode.hallucinationFlagCount ?? 0,
    safetyRefusalMismatch: shadowMode.safetyRefusalMismatch ?? false,
    primaryLatencyMs: input.primaryLatencyMs,
    challengerLatencyMs,
    primaryEstimatedCostAud: 0,
    challengerEstimatedCostAud: shadowMode.estimatedRequestCostAud ?? config.estimatedRequestCostAud,
    estimatedAdditionalCostAud: shadowMode.estimatedRequestCostAud ?? config.estimatedRequestCostAud,
    cachedPromptTokens: challengerResult.cachedPromptTokens,
  });

  await (input.auditWriter ?? writeShadowAuditRecord)({
    request,
    decision,
    metrics,
    primaryResult: input.primaryResult,
    challengerResult,
    challengerLatencyMs,
  });

  return decision;
}

export function scheduleShadowTextGeneration(input: ShadowExecutionInput): void {
  let config: ShadowRuntimeConfig;
  try {
    config = input.config ?? resolveShadowRuntimeConfigFromEnv();
  } catch (err) {
    logger.warn(
      {
        shadowConfigError: errorMessage(err),
        alias: input.request.alias,
        clinicalAction: input.request.action ?? null,
      },
      'AI shadow-mode configuration invalid; primary output preserved and challenger skipped',
    );
    return;
  }

  if (!config.enabled || !input.request.clinicId) return;

  setImmediate(() => {
    runShadowTextGenerationOnce({ ...input, config }).catch((err) => {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          alias: input.request.alias,
          clinicalAction: input.request.action ?? null,
          policyVersion: config.policy.policyVersion,
        },
        'AI shadow-mode challenger failed after primary output completed',
      );
    });
  });
}
