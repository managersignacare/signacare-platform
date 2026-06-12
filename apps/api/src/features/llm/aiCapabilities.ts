/**
 * Phase 4 + 5 lane capabilities builder.
 *
 * Pure function that assembles the `AiCapabilitiesResponse` payload for
 * the `/api/v1/ai/capabilities` endpoint from current runtime config +
 * the clinic AI runtime settings + a deterministic prompt-prefix hash
 * sample.
 *
 * Why it lives in its own file: the assembly is non-trivial (3 lane
 * descriptors, health probes, telemetry flags) and the operator brief
 * explicitly names the surface as a Phase 4 deliverable. Keeping it
 * separate from the route handler makes it easy to unit-test (no
 * Express, no DB).
 *
 * The endpoint MUST be read-only and PHI-free — the sample prompt-prefix
 * hash uses a fixed lane-probe seed, never a real clinical prompt.
 *
 * Phase 4 #5 — runtime config exposes:
 *   - backend alias                       (activeLane.backend)
 *   - model deployment id/version          (activeLane.deploymentRef + modelVersion)
 *   - promptPrefixHash sample              (promptPrefixHashSample)
 *   - cached_tokens telemetry availability (activeLane.cachedTokensTelemetryEnabled)
 *
 * Phase 5 #4 — health/startup/readiness checks and lane-specific SLO
 * telemetry exposed per lane.
 */
import { createHash } from 'node:crypto';
import {
  AI_LANE_TO_BACKEND,
  AiCapabilitiesResponseSchema,
  type AiCapabilitiesResponse,
  type AiLane,
  type AiLaneCapability,
  type AiLaneHealth,
  type AiScribeRuntimeMode,
  type ClinicAiRuntimeSettings,
} from '@signacare/shared';

// AiLane is used as the key type for observedHealth in the public
// LaneProbeInputs interface below.
export type { AiLane };

const LANE_PROBE_SEED = 'fast_clinical|ai-capabilities-probe|system-probe-seed|prompt-probe-seed';

/**
 * Pure deterministic sample hash. Mirrors the algorithm in modelRouter.ts
 * `estimateStablePromptPrefixHash` so smoke jobs can assert the digest
 * shape without depending on the live `routeTextGeneration` path.
 */
export function buildPromptPrefixHashSample(): string {
  return createHash('sha256').update(LANE_PROBE_SEED).digest('hex');
}

export interface LaneProbeInputs {
  azureOpenAi: {
    endpointConfigured: boolean;
    authMode: 'managed_identity' | 'api_key';
    apiKeyConfigured: boolean;
    fastClinicalDeployment: string | null;
    bestClinicalDeployment: string | null;
    /**
     * Pinned Azure model version strings (e.g. '2024-07-18'). Sourced from
     * AZURE_OPENAI_DEPLOYMENT_*_VERSION env vars (Phase 4 #4).
     */
    fastClinicalModelVersion: string | null;
    bestClinicalModelVersion: string | null;
    /**
     * Explicit Bicep-stamped runtime assertion that the Azure OpenAI account
     * is private endpoint only. Smoke tests treat this as required deployment
     * metadata; live Azure control-plane verification stays in the infra
     * runbook/preflight layer.
     */
    privateNetworkEnforced: boolean;
  };
  sovereignGpu: {
    /**
     * Whether the sovereign-GPU lane is provisioned for this deployment.
     * Sourced from SOVEREIGN_GPU_LANE_ENABLED env var.
     */
    enabled: boolean;
    /**
     * Pinned ollama model manifest digest baked into the inference image
     * (Phase 5 #2 — no runtime pulls).
     */
    inferenceModelManifestSha256: string | null;
    inferenceImage: string | null;
  };
  localOllama: {
    baseUrl: string | null;
    model: string | null;
  };
  /**
   * Optional per-lane probe results. Callers may pre-compute lane health
   * via async probes and pass the resolved health label here; if absent,
   * configured lanes are reported as `degraded` because runtime app
   * settings alone are not live provider proof.
   */
  observedHealth?: Partial<Record<AiLane, AiLaneHealth>>;
}

function deriveHealth(configured: boolean, observed?: AiLaneHealth): AiLaneHealth {
  if (!configured) return 'disabled';
  if (observed) return observed;
  return 'degraded';
}

function buildAzureFastLane(inputs: LaneProbeInputs): AiLaneCapability {
  const cfg = inputs.azureOpenAi;
  const authConfigured =
    cfg.authMode === 'managed_identity'
    || (cfg.authMode === 'api_key' && cfg.apiKeyConfigured && !cfg.privateNetworkEnforced);
  const configured =
    cfg.endpointConfigured
    && authConfigured
    && Boolean(cfg.fastClinicalDeployment)
    && Boolean(cfg.fastClinicalModelVersion)
    && Boolean(cfg.bestClinicalDeployment)
    && Boolean(cfg.bestClinicalModelVersion);
  const deploymentRef = cfg.fastClinicalDeployment
    && cfg.fastClinicalModelVersion
    ? `${cfg.fastClinicalDeployment}@${cfg.fastClinicalModelVersion}`
    : cfg.fastClinicalDeployment ?? null;
  return {
    lane: 'azure_fast',
    backend: AI_LANE_TO_BACKEND.azure_fast,
    health: deriveHealth(configured, inputs.observedHealth?.azure_fast),
    deploymentRef,
    modelVersion: cfg.fastClinicalModelVersion,
    cachedTokensTelemetryEnabled: true,
    privateNetworkEnforced: configured && cfg.privateNetworkEnforced,
    managedIdentityEnforced: configured && cfg.authMode === 'managed_identity',
    inferenceTrainingSeparated: true,
    ttftSloMs: 1500,
    healthCheckPath: null,
  };
}

function buildSovereignGpuLane(inputs: LaneProbeInputs): AiLaneCapability {
  const cfg = inputs.sovereignGpu;
  const configured = cfg.enabled && Boolean(cfg.inferenceImage) && Boolean(cfg.inferenceModelManifestSha256);
  const deploymentRef = cfg.inferenceImage && cfg.inferenceModelManifestSha256
    ? `${cfg.inferenceImage}@${cfg.inferenceModelManifestSha256}`
    : null;
  return {
    lane: 'sovereign_gpu',
    backend: AI_LANE_TO_BACKEND.sovereign_gpu,
    health: deriveHealth(configured, inputs.observedHealth?.sovereign_gpu),
    deploymentRef,
    modelVersion: cfg.inferenceModelManifestSha256,
    cachedTokensTelemetryEnabled: false,
    privateNetworkEnforced: configured,
    managedIdentityEnforced: configured,
    // Phase 5 #3 — sovereign-GPU lane separates inference and training
    // via the AKS node-pool taints provisioned in sovereign-gpu-aks.bicep.
    inferenceTrainingSeparated: configured,
    ttftSloMs: 4000,
    healthCheckPath: '/api/tags',
  };
}

function buildLocalOllamaLane(inputs: LaneProbeInputs): AiLaneCapability {
  const cfg = inputs.localOllama;
  const configured = Boolean(cfg.baseUrl) && Boolean(cfg.model);
  return {
    lane: 'local_ollama',
    backend: AI_LANE_TO_BACKEND.local_ollama,
    health: deriveHealth(configured, inputs.observedHealth?.local_ollama),
    deploymentRef: cfg.model,
    modelVersion: cfg.model,
    cachedTokensTelemetryEnabled: false,
    // Local-ollama is dev / single-host. By definition not behind a VNet
    // private endpoint; not behind managed identity; usually shares GPU
    // between inference and training.
    privateNetworkEnforced: false,
    managedIdentityEnforced: false,
    inferenceTrainingSeparated: false,
    ttftSloMs: null,
    healthCheckPath: '/api/tags',
  };
}

function resolveActiveLane(
  runtime: ClinicAiRuntimeSettings,
  azureFast: AiLaneCapability,
  sovereignGpu: AiLaneCapability,
  localOllama: AiLaneCapability,
): AiLaneCapability {
  // Clinic runtime currently stores a backend (`local_ollama` |
  // `azure_openai`). Map backend → lane heuristically:
  //   - azure_openai      → azure_fast (Phase 4)
  //   - local_ollama with sovereign-GPU configured → sovereign_gpu (Phase 5)
  //   - local_ollama otherwise → local_ollama (dev / single-host)
  if (runtime.llmBackend === 'azure_openai') return azureFast;
  if (sovereignGpu.health !== 'disabled') return sovereignGpu;
  return localOllama;
}

export function buildAiCapabilitiesResponse(opts: {
  runtime: ClinicAiRuntimeSettings;
  laneProbe: LaneProbeInputs;
  stagingSmokeRequired: boolean;
  productionSmokeRequired: boolean;
  scribeRuntimeMode?: AiScribeRuntimeMode;
}): AiCapabilitiesResponse {
  const azureFast = buildAzureFastLane(opts.laneProbe);
  const sovereignGpu = buildSovereignGpuLane(opts.laneProbe);
  const localOllama = buildLocalOllamaLane(opts.laneProbe);
  const active = resolveActiveLane(opts.runtime, azureFast, sovereignGpu, localOllama);

  return AiCapabilitiesResponseSchema.parse({
    schemaVersion: '1.0',
    activeLane: active,
    lanes: [azureFast, sovereignGpu, localOllama],
    promptPrefixHashSample: buildPromptPrefixHashSample(),
    scribeRuntimeMode: opts.scribeRuntimeMode ?? opts.runtime.scribeRuntimeMode,
    stagingSmokeRequired: opts.stagingSmokeRequired,
    productionSmokeRequired: opts.productionSmokeRequired,
  });
}
