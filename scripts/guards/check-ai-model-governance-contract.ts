#!/usr/bin/env tsx
/**
 * Phase 9 model-governance contract.
 *
 * Pins the non-negotiables for shadow-mode promotion:
 *   - promotion records are typed shared contracts,
 *   - challenger quality includes citations, hallucination flags, cost,
 *     latency, and safety-refusal mismatch checks,
 *   - clinician style/training adapters are reviewed separately from the
 *     runtime model alias, so a model swap cannot silently invalidate them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{
  path: string;
  patterns: Array<[RegExp | string, string]>;
  forbiddenPatterns?: Array<[RegExp | string, string]>;
}> = [
  {
    path: 'packages/shared/src/aiModelGovernance.schemas.ts',
    patterns: [
      ['AiShadowModePolicySchema', 'shadow-mode policy must be a shared contract'],
      ['AiShadowRunEligibilityInputSchema', 'shadow-run eligibility input must be a shared contract'],
      ['AiShadowRunEligibilityDecisionSchema', 'shadow-run eligibility decisions must be a shared contract'],
      ['AiShadowRunQualityMetricsSchema', 'shadow-run quality metrics must be a shared contract'],
      ['AiShadowRunEvidenceBundleSchema', 'shadow-run evidence bundle must be a shared contract'],
      ['AiModelPromotionAggregateQualitySchema', 'promotion aggregate quality must be a shared contract'],
      ['AiModelPromotionRecordSchema', 'model-promotion records must be a shared contract'],
      ['no_change', 'model-governance records must support explicit no-change attestations'],
      ['shadowEvidenceSha256', 'promotion records must bind to shadow-run evidence hash'],
      ['AiTrainingAdapterCompatibilitySchema', 'training adapter compatibility must be reviewed explicitly'],
      ['AiTrainingAdapterReviewSchema', 'promotion records must include a trainer/adapter review'],
      ['maxAdditionalCostAudPerDay', 'shadow policy must cap additional cost'],
      ['citationCoverageRatio', 'quality metrics must score citation coverage'],
      ['hallucinationFlagCount', 'quality metrics must record hallucination flags'],
      ['safetyRefusalMismatch', 'quality metrics must record safety refusal mismatch'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelGovernance.ts',
    patterns: [
      ['scoreShadowCandidate', 'API must expose a pure shadow-run scoring function'],
      ['evaluateShadowRunEligibility', 'API must expose a pure shadow-run eligibility gate'],
      ['deterministicShadowSampleBucket', 'shadow sampling must be deterministic and auditable'],
      ['aggregateShadowRunQualityMetrics', 'API must aggregate shadow-run quality evidence'],
      ['buildShadowRunEvidenceBundle', 'API must build hash-bound shadow-run evidence bundles'],
      ['hashShadowRunMetrics', 'API must hash raw shadow metrics deterministically'],
      ['evaluateModelPromotionEvidenceBundle', 'API must verify promotion records against raw shadow evidence'],
      ['assertModelPromotionEvidenceBundleAllowed', 'API must expose a fail-closed shadow-evidence assertion'],
      ['calculateEditDistanceRatio', 'shadow scoring must include edit-distance measurement'],
      ['evaluateModelPromotionRecord', 'API must expose a promotion evaluator'],
      ['assertModelPromotionAllowed', 'API must provide a fail-closed assertion for promotion'],
      ['isNoChangeAttestation', 'promotion evaluator must handle no-change attestations explicitly'],
      ['no_change records must keep fromDeploymentRef and toDeploymentRef identical', 'no-change attestations must pin identical deployment references'],
      ['requireClinicianConsent', 'shadow eligibility must honor clinician consent policy'],
      ['requireCitationScoring', 'shadow eligibility must honor citation-scoring policy'],
      ['maxAdditionalCostAudPerDay', 'shadow eligibility must enforce daily cost caps'],
      ['maxAdditionalLatencyMs', 'shadow eligibility must enforce latency caps'],
      ['trainingAdapterReview.reviewed', 'promotion must require trainer/adapter review'],
      ['compatibleAdapterCount !== trainingAdapterReview.existingAdapterCount', 'promotion must block incomplete adapter compatibility'],
      ['adaptersRequiringRetrain.length > 0', 'promotion must block adapters that require retraining'],
      ['adapter.compatibility !== \'compatible\'', 'promotion must block non-compatible adapters'],
      ['!adapter.compatibleAliases.includes(record.alias)', 'promotion must bind adapter compatibility to the target alias'],
      ['!adapter.adapterArtifactDigest', 'promotion must require adapter artifact digests'],
      ['!adapter.trainedBaseModelDigest', 'promotion must require trained base-model digests'],
      ['!adapter.evidenceUri', 'promotion must require adapter compatibility evidence'],
      ['hallucinationFlagsPer100Runs', 'promotion must block hallucination regressions'],
      ['safetyRefusalMismatchCount > 0', 'promotion must block safety-refusal mismatches'],
      ['estimatedCostRegressionPct', 'promotion must check cost regression'],
      ['p95LatencyRegressionPct', 'promotion must check latency regression'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelGovernance.test.ts',
    patterns: [
      ['blocks model swaps that would invalidate clinician training adapters', 'tests must pin adapter invalidation blocker'],
      ['blocks compatible adapter claims without target alias and digest-backed evidence', 'tests must pin alias/digest-backed adapter evidence'],
      ['blocks shadow runs that exceed clinical governance policy', 'tests must pin shadow eligibility blockers'],
      ['uses deterministic sampling so repeated shadow decisions are stable', 'tests must pin deterministic sampling'],
      ['builds promotion-quality aggregate evidence from scored shadow runs', 'tests must pin aggregate evidence generation'],
      ['builds a hash-bound shadow evidence bundle from per-run metrics', 'tests must pin shadow evidence bundle hashing'],
      ['allows promotion evidence only when record aggregate matches raw shadow-run metrics', 'tests must pin promotion evidence recomputation'],
      ['blocks promotion evidence when aggregate metrics drift from raw shadow-run metrics', 'tests must pin aggregate drift blocker'],
      ['allows a no-change production attestation only when the deployment remains pinned', 'tests must pin no-change production attestation behavior'],
      ['allows no-change evidence only when raw shadow metrics stay on the pinned deployment', 'tests must pin no-change raw metric binding'],
      ['blocks weak quality evidence', 'tests must pin quality-evidence blocker'],
      ['blocks promotion records without a rollback plan', 'tests must pin rollback/approval schema boundary'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelShadowRuntime.ts',
    patterns: [
      ['resolveShadowRuntimeConfigFromEnv', 'runtime shadow mode must be explicitly policy-configured'],
      ['AI_SHADOW_MODE_ENABLED', 'runtime shadow mode must default to disabled and require explicit enablement'],
      ['must be one of true,false,1,0,yes,no', 'runtime shadow safety booleans must reject malformed values'],
      ['evaluateShadowRunEligibility', 'runtime shadow mode must use the shared eligibility gate'],
      ['scoreShadowCandidate', 'runtime shadow mode must produce shared quality metrics'],
      ['recordLlmInteraction', 'runtime shadow evidence must be written through the canonical LLM audit writer'],
      ['shadowMode: null', 'challenger requests must not recursively spawn shadow challengers'],
      ['runShadowTextGenerationOnce', 'runtime shadow mode must expose a testable one-shot execution path'],
      ['scheduleShadowTextGeneration', 'runtime shadow mode must be scheduled after primary output'],
      ['assertChallengerIdentityConfigured', 'runtime shadow mode must require explicit challenger identity'],
      ['fallbackFromModelName', 'runtime shadow mode must reject silent provider fallback evidence'],
      ['AI_SHADOW_MODE_CHALLENGER_LOCAL_MODEL', 'local shadow challenger model must be explicit'],
      ['primaryOutput: input.primaryResult.text', 'shadow scoring must compare primary output'],
      ['challengerOutput: challengerResult.text', 'shadow scoring must compare challenger output'],
      ['metadata: {', 'runtime shadow audit must write derived metadata only'],
    ],
    forbiddenPatterns: [
      ['promptText:', 'runtime shadow audit must not persist raw prompts'],
      ['outputText:', 'runtime shadow audit must not persist raw challenger output'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelShadowRuntime.test.ts',
    patterns: [
      ['fails closed when the shadow policy is disabled', 'tests must pin disabled policy behavior'],
      ['runs an eligible challenger and writes derived-only shadow evidence', 'tests must pin runtime shadow execution'],
      ['preserves primary output when env config is invalid during scheduling', 'tests must pin shadow non-interference on bad config'],
      ['fails closed on malformed safety booleans instead of disabling consent gates', 'tests must pin malformed safety boolean behavior'],
      ['blocks local shadow challengers without an explicit candidate model', 'tests must pin explicit challenger identity'],
      ['rejects fallback challenger evidence', 'tests must pin no-silent-fallback evidence'],
      ['expect(request.shadowMode).toBeNull()', 'tests must prove challenger recursion is disabled'],
      ['not.toContain(PRIMARY_RESULT.text)', 'tests must prove raw primary output is not in metrics'],
      ['not.toContain(CHALLENGER_RESULT.text)', 'tests must prove raw challenger output is not in metrics'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelRouter.ts',
    patterns: [
      ['scheduleShadowTextGeneration', 'model router must invoke the runtime shadow observer after primary output'],
      ['runChallenger: routeTextGenerationPrimary', 'shadow challenger must use the primary one-shot router without recursion'],
    ],
  },
  {
    path: 'scripts/ai/validate-model-promotion-record.ts',
    patterns: [
      ['AiModelPromotionRecordSchema.parse', 'CLI must parse the typed promotion record contract'],
      ['AiShadowRunEvidenceBundleSchema.parse', 'CLI must parse the typed shadow evidence bundle contract'],
      ['assertModelPromotionEvidenceBundleAllowed', 'CLI must recompute and validate shadow-run evidence'],
      ['AiTextGenerationModelAliasSchema.parse', 'CLI must validate the target text-generation alias'],
      ['assertAliasPromotionAllowedByManifest', 'CLI must consume the manifest promotion gate'],
    ],
  },
  {
    path: 'packages/shared/src/index.ts',
    patterns: [
      ["export * from './aiModelGovernance.schemas';", 'shared index must export model governance contracts'],
    ],
  },
  {
    path: 'docs/architecture/ai-model-governance.md',
    patterns: [
      ['Model aliases', 'architecture note must describe alias promotion control'],
      ['ai:model-promotion:validate', 'architecture note must document the checked promotion entrypoint'],
      ['Production Deployment Gate', 'architecture note must document the production promotion gate'],
      ['decision: "no_change"', 'architecture note must document the no-change production attestation path'],
      ['Shadow-mode challengers', 'architecture note must describe shadow-mode scoring'],
      ['Runtime Shadow Mode', 'architecture note must document the runtime shadow observer'],
      ['disabled by default', 'architecture note must state runtime shadow mode is disabled by default'],
      ['hash-bound shadow evidence', 'architecture note must describe shadow evidence binding'],
      ['Clinician local style adapters', 'architecture note must describe adapter preservation'],
      ['rollback plan', 'architecture note must require rollback evidence'],
    ],
  },
  {
    path: '.github/workflows/azure-deploy.yml',
    patterns: [
      ['ai_model_promotion_alias', 'Azure deploy workflow must expose model-promotion alias input'],
      ['ai_model_promotion_record', 'Azure deploy workflow must expose model-promotion record input'],
      ['Production deploy requires both ai_model_promotion_alias and ai_model_promotion_record', 'Azure deploy workflow must require model-promotion evidence for every production deploy'],
      ['npm run ai:model-promotion:validate', 'Azure deploy workflow must consume the checked model-promotion validator'],
      ['docs/quality/ai-model-governance/*.json', 'Azure deploy workflow must constrain promotion records to the evidence directory'],
      ['sha256sum "$AI_MODEL_PROMOTION_RECORD"', 'Azure deploy workflow must hash the promotion record'],
      ['actions/upload-artifact@v4', 'Azure deploy workflow must upload model-promotion evidence'],
      ['SIGNACARE_AI_MODEL_PROMOTION_RECORD_SHA256', 'Azure deploy workflow must stamp model-promotion evidence hash into runtime metadata'],
    ],
    forbiddenPatterns: [
      ['AI_MODEL_PROMOTION_REQUIRED', 'Azure deploy workflow must not expose a bare production model-promotion opt-out'],
    ],
  },
  {
    path: 'deploy/azure/deploy.sh',
    patterns: [
      ['validate_prod_ai_model_promotion_if_needed', 'Azure infra helper must gate production Azure OpenAI model changes'],
      ['AI_MODEL_PROMOTION_ALIAS', 'Azure infra helper must require model-promotion alias'],
      ['AI_MODEL_PROMOTION_RECORD', 'Azure infra helper must require model-promotion record'],
      ['npm run ai:model-promotion:validate', 'Azure infra helper must validate model-promotion evidence'],
      ['sha256_file', 'Azure infra helper must hash model-promotion evidence'],
    ],
  },
  {
    path: 'package.json',
    patterns: [
      ['guard:ai-model-governance-contract', 'root scripts must expose the model-governance guard'],
      ['check-ai-model-governance-contract.ts', 'guard script must point at the model-governance contract checker'],
      ['ai:model-promotion:validate', 'root scripts must expose the checked model-promotion entrypoint'],
    ],
  },
];

const violations: string[] = [];

for (const check of checks) {
  let source = '';
  try {
    source = read(check.path);
  } catch (err) {
    violations.push(`${check.path}: missing (${(err as Error).message})`);
    continue;
  }

  for (const [pattern, reason] of check.patterns) {
    const ok = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (!ok) violations.push(`${check.path}: ${reason}`);
  }

  for (const [pattern, reason] of check.forbiddenPatterns ?? []) {
    const found = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (found) violations.push(`${check.path}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('AI model governance contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('AI model governance contract passed.');
