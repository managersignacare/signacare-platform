import { z } from 'zod';

const OLLAMA_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}(:[a-z0-9][a-z0-9._-]{0,63})?$/i;

export const AiLlmBackendSchema = z.enum(['local_ollama', 'azure_openai']);
export type AiLlmBackend = z.infer<typeof AiLlmBackendSchema>;

/**
 * Phase 4 + 5 lane selection.
 *
 * A "lane" is a deployment posture, not just a backend choice. Each lane
 * carries its own network controls, identity model, model-artifact
 * pinning policy, and SLO targets:
 *
 *   - `azure_fast` — Phase 4. Azure OpenAI/Foundry, private VNet ingress
 *     only, managed identity + Key Vault secrets, versioned deployment
 *     references, TTFT-optimised (gpt-4o-mini-class for the bulk of
 *     traffic, larger model for `best_clinical` / `court_report_reasoning`).
 *
 *   - `sovereign_gpu` — Phase 5. Self-hosted Ollama/vLLM on an AKS GPU
 *     node pool inside the operator's tenant. Immutable model artifact
 *     references only (manifest SHA pinned at boot; no runtime pulls).
 *     Inference and training pools are explicitly separated.
 *
 *   - `local_ollama` — legacy/local-dev posture. CPU/GPU Ollama on the
 *     same host as the API. Not a production lane; useful for offline
 *     and dev environments.
 *
 * Lane selection is policy-switchable at runtime via clinic settings;
 * the executing lane is recorded on every `llm_interactions` row and
 * surfaced to clinicians via the visible audit metadata returned by
 * `/api/v1/ai/capabilities`.
 */
export const AiLaneSchema = z.enum(['azure_fast', 'sovereign_gpu', 'local_ollama']);
export type AiLane = z.infer<typeof AiLaneSchema>;

/**
 * Map a lane to its concrete backend. Used by the model router when a
 * lane is selected explicitly via clinic settings (Phase 4/5) instead
 * of by raw backend enum (legacy posture).
 */
export const AI_LANE_TO_BACKEND: Readonly<Record<AiLane, AiLlmBackend>> = {
  azure_fast: 'azure_openai',
  sovereign_gpu: 'local_ollama',
  local_ollama: 'local_ollama',
} as const;

export const AiScribeRuntimeModeSchema = z.enum(['standard', 'agentic']);
export type AiScribeRuntimeMode = z.infer<typeof AiScribeRuntimeModeSchema>;

export const LocalStyleAdapterModelNameSchema = z
  .string()
  .regex(OLLAMA_NAME_RE)
  .max(200)
  .nullable();
export type LocalStyleAdapterModelName = z.infer<typeof LocalStyleAdapterModelNameSchema>;

export const ClinicAiRuntimeSettingsSchema = z.object({
  clinicId: z.string().uuid(),
  llmBackend: AiLlmBackendSchema,
  scribeRuntimeMode: AiScribeRuntimeModeSchema,
  // Separate persisted local adapter selection so local training artefacts
  // survive default-model swaps or temporary Azure routing changes.
  localStyleAdapterModelName: LocalStyleAdapterModelNameSchema,
});
export type ClinicAiRuntimeSettings = z.infer<typeof ClinicAiRuntimeSettingsSchema>;

export const ClinicAiRuntimeSettingsUpdateSchema = z
  .object({
    llmBackend: AiLlmBackendSchema.optional(),
    scribeRuntimeMode: AiScribeRuntimeModeSchema.optional(),
    localStyleAdapterModelName: LocalStyleAdapterModelNameSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one AI runtime field must be provided',
  });
export type ClinicAiRuntimeSettingsUpdateDTO = z.infer<typeof ClinicAiRuntimeSettingsUpdateSchema>;

export const AiTextGenerationModelAliasSchema = z.enum([
  'fast_clinical',
  'best_clinical',
  'local_sovereign',
  'court_report_reasoning',
]);
export type AiTextGenerationModelAlias = z.infer<typeof AiTextGenerationModelAliasSchema>;

export const AiModelAliasSchema = z.enum([
  ...AiTextGenerationModelAliasSchema.options,
  'asr_default',
]);
export type AiModelAlias = z.infer<typeof AiModelAliasSchema>;

export const AiModelAliasPolicySchema = z.object({
  alias: AiTextGenerationModelAliasSchema,
  defaultLanePreference: z.array(AiLaneSchema).min(1),
  localStyleAdapterAllowed: z.boolean(),
  trainerAdapterDecoupled: z.literal(true),
  modelSwapInvalidatesLocalStyleAdapters: z.literal(false),
  promotionRequiresGovernanceRecord: z.literal(true),
  promptCacheEligible: z.boolean(),
});
export type AiModelAliasPolicy = z.infer<typeof AiModelAliasPolicySchema>;

export const AiModelPolicyManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  policies: z.array(AiModelAliasPolicySchema).min(AiTextGenerationModelAliasSchema.options.length),
});
export type AiModelPolicyManifest = z.infer<typeof AiModelPolicyManifestSchema>;

export const RoutedModelExecutionSchema = z.object({
  alias: AiModelAliasSchema,
  backend: AiLlmBackendSchema,
  modelName: z.string().min(1).max(200),
  modelVersion: z.string().max(200).nullable(),
  deployment: z.string().max(200).nullable(),
  localStyleAdapterModelName: LocalStyleAdapterModelNameSchema.optional(),
});
export type RoutedModelExecution = z.infer<typeof RoutedModelExecutionSchema>;

// ── Phase 4/5 capabilities surface ────────────────────────────────────────

/**
 * Per-lane health classification surfaced by `/api/v1/ai/capabilities`.
 *
 *   - `healthy`  — lane probes are green (network reachable, deployment
 *                  responsive, recent latency within SLO).
 *   - `degraded` — lane probes are partially green (e.g., one of two
 *                  configured deployments unreachable, latency above SLO).
 *   - `unhealthy`— lane probes failed (network unreachable, no responsive
 *                  deployment). Caller should fail over to a different
 *                  lane per the policy in `/docs/operations/runbooks/`.
 *   - `disabled` — lane is not configured for this clinic / tenant.
 *
 * The capability response is read-only and free of PHI; it is used by the
 * staging-smoke and production-smoke jobs to prove lane health before
 * promoting traffic.
 */
export const AiLaneHealthSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'disabled']);
export type AiLaneHealth = z.infer<typeof AiLaneHealthSchema>;

/**
 * Per-lane capability descriptor. The `deploymentRef` is the immutable
 * reference the lane points at:
 *
 *   - For `azure_fast` it is the Azure deployment name + model version
 *     string returned by the most recent successful call.
 *   - For `sovereign_gpu` / `local_ollama` it is `<ollama-model-tag>@<sha256>`
 *     baked into the container image at provision time. There is NO
 *     `ollama pull`-style runtime model fetch — the model is part of
 *     the image's content-addressable manifest.
 */
export const AiLaneCapabilitySchema = z.object({
  lane: AiLaneSchema,
  backend: AiLlmBackendSchema,
  health: AiLaneHealthSchema,
  /** Immutable deployment reference. Format depends on backend (see comment above). */
  deploymentRef: z.string().min(1).max(400).nullable(),
  /** Model version returned by the provider on the last successful generation, when known. */
  modelVersion: z.string().max(200).nullable(),
  /** Whether provider returns cached_tokens telemetry (Azure OpenAI + Foundry). */
  cachedTokensTelemetryEnabled: z.boolean(),
  /** Whether the lane is operating inside the operator's tenant VNet (Phase 4 + Phase 5). */
  privateNetworkEnforced: z.boolean(),
  /** Whether all provider secrets are sourced from Key Vault / managed identity (Phase 4). */
  managedIdentityEnforced: z.boolean(),
  /** Whether inference + training share a node pool (false = required separation). */
  inferenceTrainingSeparated: z.boolean(),
  /** Per-lane SLO targets in milliseconds. Used by staging smoke to assert TTFT. */
  ttftSloMs: z.number().int().positive().nullable(),
  /** Lane-specific health probe URL stem (relative to the lane backend, when known). */
  healthCheckPath: z.string().max(200).nullable(),
});
export type AiLaneCapability = z.infer<typeof AiLaneCapabilitySchema>;

/**
 * Response shape for `GET /api/v1/ai/capabilities`.
 *
 * Per Phase 4 requirement #5, this endpoint exposes:
 *   - backend alias                       (`activeLane.backend`)
 *   - model deployment id/version         (`activeLane.deploymentRef` + `modelVersion`)
 *   - promptPrefixHash sample             (`promptPrefixHashSample`)
 *   - cached_tokens telemetry availability (`activeLane.cachedTokensTelemetryEnabled`)
 *
 * Per Phase 5 requirement #4, this endpoint also exposes per-lane SLO
 * targets and the health/startup/readiness signal for each lane.
 *
 * The endpoint MUST be read-only and PHI-free. It is mounted behind
 * the same authMiddleware + role gate as the rest of the AI router
 * (clinician / admin / superadmin); smoke jobs authenticate with an
 * operator-issued admin token before probing.
 */
export const AiCapabilitiesResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  /** Lane currently routing this clinic's traffic. */
  activeLane: AiLaneCapabilitySchema,
  /** All lanes the cluster knows how to route to, with per-lane health. */
  lanes: z.array(AiLaneCapabilitySchema).min(1),
  /**
   * Sample sha256 hex over a deterministic seed (`alias|action|systemSlice|promptSlice`).
   * This is a stability witness only — it does NOT carry PHI because the
   * sample seed is a fixed lane-probe string, not a real clinical prompt.
   */
  promptPrefixHashSample: z.string().regex(/^[a-f0-9]{64}$/),
  /** Active clinic AI runtime mode (standard / agentic) for cross-reference. */
  scribeRuntimeMode: AiScribeRuntimeModeSchema,
  /** Whether staging-smoke must pass before traffic promotion. */
  stagingSmokeRequired: z.boolean(),
  /** Whether production-smoke must pass before traffic promotion. */
  productionSmokeRequired: z.boolean(),
});
export type AiCapabilitiesResponse = z.infer<typeof AiCapabilitiesResponseSchema>;
