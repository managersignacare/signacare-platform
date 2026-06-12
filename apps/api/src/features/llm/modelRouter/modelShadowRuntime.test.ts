import { describe, expect, it, vi } from 'vitest';
import type {
  AiShadowModePolicy,
  RoutedModelExecution,
} from '@signacare/shared';
import type {
  RoutedTextGenerationRequest,
  RoutedTextGenerationResult,
} from './modelRouter';
import {
  scheduleShadowTextGeneration,
  runShadowTextGenerationOnce,
  type ShadowAuditRecord,
  type ShadowRuntimeConfig,
} from './modelShadowRuntime';

const PRIMARY_EXECUTION: RoutedModelExecution = {
  alias: 'best_clinical',
  backend: 'azure_openai',
  modelName: 'gpt-clinical-current',
  modelVersion: '2026-05-01',
  deployment: 'sig-best-clinical-staging',
  localStyleAdapterModelName: null,
};

const CHALLENGER_EXECUTION: RoutedModelExecution = {
  alias: 'best_clinical',
  backend: 'local_ollama',
  modelName: 'llama3.2:style-candidate',
  modelVersion: 'llama3.2:style-candidate@sha256:1234567890abcdef',
  deployment: null,
  localStyleAdapterModelName: 'llama3.2:style-candidate',
};

const REQUEST: RoutedTextGenerationRequest = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  alias: 'best_clinical',
  action: 'clinical-summary',
  prompt: [
    'Generate a concise clinical summary.',
    '',
    'Patient context: stable mood and no acute psychosis reported.',
  ].join('\n'),
  system: 'You are a governed clinical AI assistant.',
  shadowMode: {
    clinicianConsentRecorded: true,
    citationScoringAvailable: true,
    citationsRequired: 2,
    citationsWithEvidence: 2,
    deterministicSampleSeed: 'shadow-runtime-unit-test-seed-0001',
    forceInclude: true,
  },
};

const PRIMARY_RESULT: RoutedTextGenerationResult = {
  text: 'Mood stable. No acute psychosis reported.',
  execution: PRIMARY_EXECUTION,
  promptTokens: 120,
  completionTokens: 12,
  cachedPromptTokens: 1024,
  promptPrefixHash: 'stable-prefix-hash',
  fallbackFromModelName: null,
};

const CHALLENGER_RESULT: RoutedTextGenerationResult = {
  text: 'Mood remains stable. No psychotic symptoms were reported.',
  execution: CHALLENGER_EXECUTION,
  promptTokens: 130,
  completionTokens: 14,
  cachedPromptTokens: null,
  promptPrefixHash: 'stable-prefix-hash',
  fallbackFromModelName: null,
};

function policy(enabled: boolean): AiShadowModePolicy {
  return {
    schemaVersion: '1.0',
    enabled,
    policyVersion: 'shadow-policy-unit',
    eligibleAliases: ['best_clinical'],
    eligibleActions: ['clinical-summary'],
    sampleRatePct: 0,
    maxAdditionalLatencyMs: 5000,
    maxAdditionalCostAudPerDay: 20,
    requireCitationScoring: true,
    requireClinicianConsent: true,
  };
}

function config(enabled: boolean): ShadowRuntimeConfig {
  return {
    enabled,
    policy: policy(enabled),
    challengerBackend: 'local_ollama',
    challengerLocalModel: 'llama3.2:style-candidate',
    estimatedAdditionalLatencyMs: 1200,
    estimatedRequestCostAud: 0.03,
    estimatedAdditionalCostAudToday: 1,
  };
}

describe('modelShadowRuntime', () => {
  it('preserves primary output when env config is invalid during scheduling', () => {
    const originalEnabled = process.env.AI_SHADOW_MODE_ENABLED;
    const originalBackend = process.env.AI_SHADOW_MODE_CHALLENGER_BACKEND;
    process.env.AI_SHADOW_MODE_ENABLED = 'true';
    process.env.AI_SHADOW_MODE_CHALLENGER_BACKEND = 'not-a-backend';

    expect(() =>
      scheduleShadowTextGeneration({
        request: REQUEST,
        primaryResult: PRIMARY_RESULT,
        primaryLatencyMs: 900,
        runChallenger: vi.fn(),
      }),
    ).not.toThrow();

    if (originalEnabled === undefined) {
      delete process.env.AI_SHADOW_MODE_ENABLED;
    } else {
      process.env.AI_SHADOW_MODE_ENABLED = originalEnabled;
    }
    if (originalBackend === undefined) {
      delete process.env.AI_SHADOW_MODE_CHALLENGER_BACKEND;
    } else {
      process.env.AI_SHADOW_MODE_CHALLENGER_BACKEND = originalBackend;
    }
  });

  it('fails closed on malformed safety booleans instead of disabling consent gates', () => {
    const originalEnabled = process.env.AI_SHADOW_MODE_ENABLED;
    const originalConsent = process.env.AI_SHADOW_MODE_REQUIRE_CLINICIAN_CONSENT;
    process.env.AI_SHADOW_MODE_ENABLED = 'true';
    process.env.AI_SHADOW_MODE_REQUIRE_CLINICIAN_CONSENT = 'treu';

    expect(() =>
      scheduleShadowTextGeneration({
        request: REQUEST,
        primaryResult: PRIMARY_RESULT,
        primaryLatencyMs: 900,
        runChallenger: vi.fn(),
      }),
    ).not.toThrow();

    if (originalEnabled === undefined) {
      delete process.env.AI_SHADOW_MODE_ENABLED;
    } else {
      process.env.AI_SHADOW_MODE_ENABLED = originalEnabled;
    }
    if (originalConsent === undefined) {
      delete process.env.AI_SHADOW_MODE_REQUIRE_CLINICIAN_CONSENT;
    } else {
      process.env.AI_SHADOW_MODE_REQUIRE_CLINICIAN_CONSENT = originalConsent;
    }
  });

  it('fails closed when the shadow policy is disabled and never calls the challenger', async () => {
    const runChallenger = vi.fn<() => Promise<RoutedTextGenerationResult>>();
    const auditWriter = vi.fn<(args: ShadowAuditRecord) => Promise<void>>();

    const decision = await runShadowTextGenerationOnce({
      request: REQUEST,
      primaryResult: PRIMARY_RESULT,
      primaryLatencyMs: 900,
      config: config(false),
      runChallenger,
      auditWriter,
    });

    expect(decision.eligible).toBe(false);
    expect(decision.blockers.join('\n')).toContain('shadow policy shadow-policy-unit is disabled');
    expect(runChallenger).not.toHaveBeenCalled();
    expect(auditWriter).not.toHaveBeenCalled();
  });

  it('runs an eligible challenger and writes derived-only shadow evidence', async () => {
    const runChallenger = vi.fn(async (request: RoutedTextGenerationRequest) => {
      expect(request.runtimeSelection?.backend).toBe('local_ollama');
      expect(request.requestedModel).toBe('llama3.2:style-candidate');
      expect(request.shadowMode).toBeNull();
      return CHALLENGER_RESULT;
    });
    const auditRecords: ShadowAuditRecord[] = [];

    const decision = await runShadowTextGenerationOnce({
      request: REQUEST,
      primaryResult: PRIMARY_RESULT,
      primaryLatencyMs: 900,
      config: config(true),
      runChallenger,
      auditWriter: async (record) => {
        auditRecords.push(record);
      },
    });

    expect(decision.eligible).toBe(true);
    expect(runChallenger).toHaveBeenCalledTimes(1);
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].metrics.baselineDeploymentRef).toBe('sig-best-clinical-staging@2026-05-01');
    expect(auditRecords[0].metrics.candidateDeploymentRef).toBe(
      'llama3.2:style-candidate@llama3.2:style-candidate@sha256:1234567890abcdef',
    );
    expect(auditRecords[0].metrics.editDistanceRatio).toBeGreaterThan(0);
    expect(auditRecords[0].metrics.citationCoverageRatio).toBe(1);
    expect(JSON.stringify(auditRecords[0].metrics)).not.toContain(PRIMARY_RESULT.text);
    expect(JSON.stringify(auditRecords[0].metrics)).not.toContain(CHALLENGER_RESULT.text);
  });

  it('blocks local shadow challengers without an explicit candidate model', async () => {
    const runChallenger = vi.fn(async () => CHALLENGER_RESULT);

    await expect(
      runShadowTextGenerationOnce({
        request: REQUEST,
        primaryResult: PRIMARY_RESULT,
        primaryLatencyMs: 900,
        config: {
          ...config(true),
          challengerLocalModel: null,
        },
        runChallenger,
      }),
    ).rejects.toThrow('AI shadow-mode local challenger requires AI_SHADOW_MODE_CHALLENGER_LOCAL_MODEL');
    expect(runChallenger).not.toHaveBeenCalled();
  });

  it('rejects fallback challenger evidence so alias promotion cannot learn from the wrong model', async () => {
    const runChallenger = vi.fn(async () => ({
      ...CHALLENGER_RESULT,
      fallbackFromModelName: 'llama3.2:style-candidate',
      execution: {
        ...CHALLENGER_RESULT.execution,
        modelName: 'llama3.2',
      },
    }));

    await expect(
      runShadowTextGenerationOnce({
        request: REQUEST,
        primaryResult: PRIMARY_RESULT,
        primaryLatencyMs: 900,
        config: config(true),
        runChallenger,
      }),
    ).rejects.toThrow('AI shadow-mode challenger fell back from llama3.2:style-candidate');
  });
});
