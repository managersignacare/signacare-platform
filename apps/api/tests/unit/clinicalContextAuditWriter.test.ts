import { describe, expect, it, vi } from 'vitest';
import type { ClinicalContextEnvelope, RoutedModelExecution } from '@signacare/shared';
import {
  buildClinicalContextAuditMetadata,
  recordClinicalContextLlmInteraction,
} from '../../src/features/llm/context/contextAuditWriter';

const recordLlmInteraction = vi.hoisted(() => vi.fn());

vi.mock('../../src/shared/recordLlmInteraction', () => ({
  recordLlmInteraction,
}));

const EXECUTION: RoutedModelExecution = {
  alias: 'best_clinical',
  backend: 'azure_openai',
  modelName: 'gpt-test',
  modelVersion: 'gpt-test@sha256:abc',
  deployment: 'staging-best-clinical',
  localStyleAdapterModelName: null,
};

const ENVELOPE: ClinicalContextEnvelope = {
  envelopeId: '11111111-1111-4111-8111-111111111111',
  documentType: 'referral-letter',
  schemaVersion: '1.0.0',
  builtAt: '2026-06-06T00:00:00.000Z',
  phiClass: 'high',
  estimatedTokens: 320,
  tokenBudget: 6000,
  contextHash: 'a'.repeat(64),
  facts: [
    {
      factId: '22222222-2222-4222-8222-222222222222',
      tier: 'A',
      domain: 'demographics',
      trustLevel: 'authoritative',
      lineage: {
        sourceTable: 'patients',
        sourceId: '33333333-3333-4333-8333-333333333333',
        sourceDate: '2026-06-05T00:00:00.000Z',
        lineageKey: 'b'.repeat(64),
        citationRequired: false,
      },
      freshness: {
        sourceCapturedAt: '2026-06-05T00:00:00.000Z',
        contextBuiltAt: '2026-06-06T00:00:00.000Z',
        ageSeconds: 86400,
      },
      payload: {
        givenName: 'Alex',
        familyName: 'Smith',
      },
      tokenCost: 20,
    },
    {
      factId: '44444444-4444-4444-8444-444444444444',
      tier: 'B',
      domain: 'recent_notes',
      trustLevel: 'retrieved_unverified',
      lineage: {
        sourceTable: 'clinical_notes',
        sourceId: '55555555-5555-4555-8555-555555555555',
        sourceDate: '2026-06-04T00:00:00.000Z',
        lineageKey: 'c'.repeat(64),
        citationRequired: true,
      },
      freshness: {
        sourceCapturedAt: '2026-06-04T00:00:00.000Z',
        contextBuiltAt: '2026-06-06T00:00:00.000Z',
        ageSeconds: 172800,
      },
      payload: {
        text: 'Patient reports poorer sleep.',
      },
      tokenCost: 45,
    },
  ],
  excluded: [
    {
      domain: 'recent_pathology',
      reason: 'no-data',
    },
  ],
};

describe('clinicalContextAuditWriter', () => {
  it('builds derived-only audit metadata from execution + context envelope', () => {
    const metadata = buildClinicalContextAuditMetadata(EXECUTION, ENVELOPE);

    expect(metadata).toEqual({
      routedAlias: 'best_clinical',
      routedBackend: 'azure_openai',
      routedDeployment: 'staging-best-clinical',
      localStyleAdapterModelName: null,
      contextPresent: true,
      contextDocumentType: 'referral-letter',
      contextSchemaVersion: '1.0.0',
      contextHash: 'a'.repeat(64),
      contextPhiClass: 'high',
      contextEstimatedTokens: 320,
      contextTokenBudget: 6000,
      contextSourceCount: 2,
      contextSourceTables: {
        patients: 1,
        clinical_notes: 1,
      },
      contextExcluded: [
        {
          domain: 'recent_pathology',
          reason: 'no-data',
        },
      ],
    });
  });

  it('emits safe null/default values when no context envelope exists', () => {
    const metadata = buildClinicalContextAuditMetadata(EXECUTION, null);

    expect(metadata.contextPresent).toBe(false);
    expect(metadata.contextDocumentType).toBeNull();
    expect(metadata.contextHash).toBeNull();
    expect(metadata.contextSourceTables).toEqual({});
    expect(metadata.contextExcluded).toEqual([]);
  });

  it('records prompt-prefix telemetry when cache hints are supplied', async () => {
    recordLlmInteraction.mockResolvedValueOnce('11111111-1111-4111-8111-111111111111');

    await recordClinicalContextLlmInteraction({
      clinicId: '11111111-1111-4111-8111-111111111111',
      feature: 'scribe-patient-summary',
      execution: EXECUTION,
      promptText: 'system context and note context',
      cachedPromptTokens: 128,
      promptPrefixHash: 'cache-hash',
      contextEnvelope: ENVELOPE,
      patientId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      promptTokens: 42,
      completionTokens: 12,
    });

    expect(recordLlmInteraction).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        cachedPromptTokens: 128,
        promptPrefixHash: 'cache-hash',
        routedAlias: 'best_clinical',
        routedBackend: 'azure_openai',
      }),
      promptTokens: 42,
      completionTokens: 12,
      patientId: '22222222-2222-4222-8222-222222222222',
    }));
  });
});
