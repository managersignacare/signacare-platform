/**
 * Phase 4 + 5 — unit tests for the lane capabilities builder.
 *
 * Pure unit (no DB, no HTTP). Asserts the operator-required surface:
 *   - backend alias                       (activeLane.backend)
 *   - model deployment id/version          (activeLane.deploymentRef + modelVersion)
 *   - promptPrefixHash sample              (promptPrefixHashSample is sha256 hex)
 *   - cached_tokens telemetry availability (per-lane flag)
 *   - per-lane SLO + health
 *   - inferenceTrainingSeparated (Phase 5 #3)
 *   - privateNetworkEnforced + managedIdentityEnforced (Phase 4 #2 #3)
 *
 * Negative-space: when no lane is configured, the active lane defaults
 * to `local_ollama` and is reported as `disabled`, not `healthy`.
 */
import { describe, expect, it } from 'vitest';
import {
  AiCapabilitiesResponseSchema,
  type ClinicAiRuntimeSettings,
} from '@signacare/shared';
import { buildAiCapabilitiesResponse, buildPromptPrefixHashSample, type LaneProbeInputs } from './aiCapabilities';

const SAMPLE_CLINIC = '11111111-1111-1111-1111-111111111111';

const RUNTIME_AZURE: ClinicAiRuntimeSettings = {
  clinicId: SAMPLE_CLINIC,
  llmBackend: 'azure_openai',
  scribeRuntimeMode: 'standard',
  localStyleAdapterModelName: null,
};

const RUNTIME_LOCAL: ClinicAiRuntimeSettings = {
  clinicId: SAMPLE_CLINIC,
  llmBackend: 'local_ollama',
  scribeRuntimeMode: 'standard',
  localStyleAdapterModelName: null,
};

function azureProbe(extra: Partial<LaneProbeInputs['azureOpenAi']> = {}): LaneProbeInputs {
  return {
    azureOpenAi: {
      endpointConfigured: true,
      authMode: 'managed_identity',
      apiKeyConfigured: false,
      fastClinicalDeployment: 'sig-fast-clinical-staging',
      bestClinicalDeployment: 'sig-best-clinical-staging',
      fastClinicalModelVersion: '2024-07-18',
      bestClinicalModelVersion: '2024-11-20',
      privateNetworkEnforced: true,
      ...extra,
    },
    sovereignGpu: {
      enabled: false,
      inferenceImage: null,
      inferenceModelManifestSha256: null,
    },
    localOllama: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:signacare-35f39aa1',
    },
  };
}

function sovereignProbe(): LaneProbeInputs {
  return {
    azureOpenAi: {
      endpointConfigured: false,
      authMode: 'managed_identity',
      apiKeyConfigured: false,
      fastClinicalDeployment: null,
      bestClinicalDeployment: null,
      fastClinicalModelVersion: null,
      bestClinicalModelVersion: null,
      privateNetworkEnforced: false,
    },
    sovereignGpu: {
      enabled: true,
      inferenceImage: 'sigcr.azurecr.io/ollama-sovereign@sha256:9b8c',
      inferenceModelManifestSha256: 'sha256:35f39aa10ab6',
    },
    localOllama: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:signacare-35f39aa1',
    },
  };
}

describe('aiCapabilities — buildPromptPrefixHashSample', () => {
  it('is a deterministic 64-char sha256 hex (PHI-free)', () => {
    const a = buildPromptPrefixHashSample();
    const b = buildPromptPrefixHashSample();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });
});

describe('aiCapabilities — azure_fast active', () => {
  it('exposes backend alias + pinned deployment + model version + cached-tokens telemetry', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe(),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    expect(() => AiCapabilitiesResponseSchema.parse(response)).not.toThrow();
    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.backend).toBe('azure_openai');
    expect(response.activeLane.deploymentRef).toBe('sig-fast-clinical-staging@2024-07-18');
    expect(response.activeLane.modelVersion).toBe('2024-07-18');
    expect(response.activeLane.cachedTokensTelemetryEnabled).toBe(true);
    expect(response.activeLane.privateNetworkEnforced).toBe(true);
    expect(response.activeLane.managedIdentityEnforced).toBe(true);
    expect(response.activeLane.health).toBe('degraded');
    expect(response.activeLane.ttftSloMs).toBe(1500);
    expect(response.lanes.length).toBe(3);
    expect(response.lanes.map((l) => l.lane).sort()).toEqual(['azure_fast', 'local_ollama', 'sovereign_gpu']);
  });

  it('marks azure_fast as disabled when endpoint is unconfigured', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_LOCAL,
      laneProbe: azureProbe({ endpointConfigured: false }),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    const azure = response.lanes.find((l) => l.lane === 'azure_fast');
    expect(azure?.health).toBe('disabled');
  });

  it('marks azure_fast as disabled when any governed Azure deployment lacks a pinned model version', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe({ bestClinicalModelVersion: null }),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.health).toBe('disabled');
    expect(response.activeLane.privateNetworkEnforced).toBe(false);
    expect(response.activeLane.managedIdentityEnforced).toBe(false);
  });

  it('does not let observed health override missing governed Azure model versions', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: {
        ...azureProbe({ fastClinicalModelVersion: null }),
        observedHealth: { azure_fast: 'healthy' },
      },
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.health).toBe('disabled');
  });

  it('disables azure_fast when API-key mode is selected for the private lane', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe({ authMode: 'api_key', apiKeyConfigured: true }),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.health).toBe('disabled');
    expect(response.activeLane.privateNetworkEnforced).toBe(false);
    expect(response.activeLane.managedIdentityEnforced).toBe(false);
  });

  it('allows explicit API-key mode only when the private-lane flag is false', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe({
        authMode: 'api_key',
        apiKeyConfigured: true,
        privateNetworkEnforced: false,
      }),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.health).toBe('degraded');
    expect(response.activeLane.privateNetworkEnforced).toBe(false);
    expect(response.activeLane.managedIdentityEnforced).toBe(false);
  });

  it('does not infer private-network enforcement from endpoint presence alone', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe({ privateNetworkEnforced: false }),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(response.activeLane.lane).toBe('azure_fast');
    expect(response.activeLane.health).toBe('degraded');
    expect(response.activeLane.privateNetworkEnforced).toBe(false);
    expect(response.activeLane.managedIdentityEnforced).toBe(true);
  });
});

describe('aiCapabilities — sovereign_gpu active', () => {
  it('reports inferenceTrainingSeparated=true and pinned model manifest digest', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_LOCAL,
      laneProbe: sovereignProbe(),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    expect(response.activeLane.lane).toBe('sovereign_gpu');
    expect(response.activeLane.backend).toBe('local_ollama');
    expect(response.activeLane.deploymentRef).toBe('sigcr.azurecr.io/ollama-sovereign@sha256:9b8c@sha256:35f39aa10ab6');
    expect(response.activeLane.modelVersion).toBe('sha256:35f39aa10ab6');
    expect(response.activeLane.inferenceTrainingSeparated).toBe(true);
    expect(response.activeLane.privateNetworkEnforced).toBe(true);
    expect(response.activeLane.cachedTokensTelemetryEnabled).toBe(false);
  });

  it('marks sovereign_gpu as disabled when not provisioned', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_LOCAL,
      laneProbe: azureProbe(),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    const sovereign = response.lanes.find((l) => l.lane === 'sovereign_gpu');
    expect(sovereign?.health).toBe('disabled');
    expect(sovereign?.deploymentRef).toBeNull();
  });
});

describe('aiCapabilities — local_ollama fallback', () => {
  it('reports inferenceTrainingSeparated=false and no privateNetworkEnforced', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_LOCAL,
      laneProbe: {
        azureOpenAi: {
          endpointConfigured: false,
          authMode: 'managed_identity',
          apiKeyConfigured: false,
          fastClinicalDeployment: null,
          bestClinicalDeployment: null,
          fastClinicalModelVersion: null,
          bestClinicalModelVersion: null,
          privateNetworkEnforced: false,
        },
        sovereignGpu: { enabled: false, inferenceImage: null, inferenceModelManifestSha256: null },
        localOllama: { baseUrl: 'http://localhost:11434', model: 'llama3.2:signacare-35f39aa1' },
      },
      stagingSmokeRequired: false,
      productionSmokeRequired: false,
    });
    expect(response.activeLane.lane).toBe('local_ollama');
    expect(response.activeLane.privateNetworkEnforced).toBe(false);
    expect(response.activeLane.managedIdentityEnforced).toBe(false);
    expect(response.activeLane.inferenceTrainingSeparated).toBe(false);
    expect(response.activeLane.ttftSloMs).toBeNull();
  });
});

describe('aiCapabilities — observedHealth overrides defaults', () => {
  it('passes through caller-supplied lane health (degraded / unhealthy)', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: {
        ...azureProbe(),
        observedHealth: { azure_fast: 'degraded' },
      },
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    expect(response.activeLane.health).toBe('degraded');
  });
});

describe('aiCapabilities — Phase 4/5 operator-required telemetry surface', () => {
  it('exposes the full set of operator-required fields on the active lane', () => {
    const response = buildAiCapabilitiesResponse({
      runtime: RUNTIME_AZURE,
      laneProbe: azureProbe(),
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });
    // Operator brief Phase 4 #5:
    //   - backend alias
    //   - model deployment id/version
    //   - promptPrefixHash
    //   - cached_tokens telemetry
    expect(response.activeLane.backend).toBeDefined();
    expect(response.activeLane.deploymentRef).toBeDefined();
    expect(response.activeLane.modelVersion).toBeDefined();
    expect(response.promptPrefixHashSample).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof response.activeLane.cachedTokensTelemetryEnabled).toBe('boolean');
    // Operator brief Phase 5 #4:
    //   - health / readiness signals per lane
    //   - SLO telemetry per lane
    for (const lane of response.lanes) {
      expect(['healthy', 'degraded', 'unhealthy', 'disabled']).toContain(lane.health);
      // ttftSloMs may be null for local_ollama; other lanes carry the SLO.
      if (lane.lane !== 'local_ollama') {
        expect(typeof lane.ttftSloMs).toBe('number');
      }
    }
  });
});
