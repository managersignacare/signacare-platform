import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/shared/errors';

const buildClinicalContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/features/llm/context/buildClinicalContext', () => ({
  buildClinicalContext: buildClinicalContextMock,
}));

import {
  buildAmbientGovernedClinicalContext,
  buildAmbientGovernedContextAuditMetadata,
  shouldFailClosedForAmbientContext,
} from '../../src/features/llm/context/ambientClinicalContext';

describe('ambient governed clinical context helper', () => {
  it('reuses a caller auth context when it matches the ambient scope', async () => {
    buildClinicalContextMock.mockResolvedValueOnce({
      anchorPatient: {
        id: '0f82f445-e0fb-4f93-bb44-b25cbcbcaeb2',
        givenName: 'Ada',
        familyName: 'Lovelace',
        preferredName: null,
        dateOfBirth: '1990-01-01',
        emrNumber: 'EMR-100',
      },
      envelope: {
        envelopeId: '5ec2fe0a-bb0f-4efb-8fc1-54580a39ed44',
        documentType: 'scribe-pass2',
        schemaVersion: '1.0.0',
        builtAt: '2026-06-06T00:00:00.000Z',
        facts: [
          {
            factId: '7f398f62-181e-43fc-83db-bf2d4f8593a0',
            tier: 'A',
            domain: 'demographics',
            trustLevel: 'authoritative',
            lineage: {
              sourceTable: 'patients',
              sourceId: 'f8f0200c-f384-4f41-87e5-d81d3fb0f068',
              sourceDate: '2026-06-05T00:00:00.000Z',
              lineageKey: 'demographics:1',
              citationRequired: false,
            },
            freshness: {
              sourceCapturedAt: '2026-06-05T00:00:00.000Z',
              contextBuiltAt: '2026-06-06T00:00:00.000Z',
              ageSeconds: 86400,
            },
            payload: { givenName: 'Ada' },
            tokenCost: 20,
          },
        ],
        phiClass: 'high',
        estimatedTokens: 120,
        tokenBudget: 4000,
        contextHash: 'a'.repeat(64),
        excluded: [],
      },
      renderedPrompt: 'CLINICAL CONTEXT: grounded facts only',
    });

    const result = await buildAmbientGovernedClinicalContext({
      clinicId: 'c5700715-7a27-4287-aa9b-a864d6a5efec',
      staffId: '1ea45897-bc52-40da-a8aa-e3b1128060db',
      patientId: '2beff736-0c8f-4b7d-8d8f-c8f4f2aaf6e0',
      auth: {
        clinicId: 'c5700715-7a27-4287-aa9b-a864d6a5efec',
        staffId: '1ea45897-bc52-40da-a8aa-e3b1128060db',
        role: 'clinician',
        permissions: [],
      },
    });

    expect(result?.envelope.documentType).toBe('scribe-pass2');
    expect(buildClinicalContextMock).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'scribe-pass2',
      patientId: '2beff736-0c8f-4b7d-8d8f-c8f4f2aaf6e0',
      auth: expect.objectContaining({
        clinicId: 'c5700715-7a27-4287-aa9b-a864d6a5efec',
        staffId: '1ea45897-bc52-40da-a8aa-e3b1128060db',
        patientId: '2beff736-0c8f-4b7d-8d8f-c8f4f2aaf6e0',
      }),
    }));
  });

  it('fails closed when a caller auth context does not match the ambient scope', async () => {
    await expect(buildAmbientGovernedClinicalContext({
      clinicId: 'f6a21972-edf4-47d4-b2ff-8df7e87a1022',
      staffId: 'c7400c41-c5b6-46ba-9b95-3ea1ee86f1cf',
      patientId: 'f15ef7fb-faec-4eaf-ac00-a6ee781df360',
      auth: {
        clinicId: 'f6a21972-edf4-47d4-b2ff-8df7e87a1022',
        staffId: '5b65f35a-2943-40fa-a085-b77b909fcdb6',
        role: 'clinician',
        permissions: [],
      },
    })).rejects.toMatchObject({
      code: 'AMBIENT_AUTH_CONTEXT_MISMATCH',
      status: 403,
    });
  });

  it('records derived-only audit metadata for governed ambient context', () => {
    const metadata = buildAmbientGovernedContextAuditMetadata({
      execution: {
        alias: 'best_clinical',
        backend: 'local_ollama',
        modelName: 'qwen2.5:14b',
        modelVersion: 'qwen2.5:14b@sha256:test',
        deployment: null,
        localStyleAdapterModelName: null,
      },
      contextEnvelope: {
        envelopeId: '6cd71596-2a01-48ec-b60d-ab48218fca59',
        documentType: 'scribe-pass2',
        schemaVersion: '1.0.0',
        builtAt: '2026-06-06T00:00:00.000Z',
        facts: [
          {
            factId: '1ea9df4d-7477-4710-ae17-73c5855f6d14',
            tier: 'A',
            domain: 'demographics',
            trustLevel: 'authoritative',
            lineage: {
              sourceTable: 'patients',
              sourceId: '5e493197-2e39-418e-bbb3-f7ef98ca4e8b',
              sourceDate: '2026-06-05T00:00:00.000Z',
              lineageKey: 'patients:1',
              citationRequired: false,
            },
            freshness: {
              sourceCapturedAt: '2026-06-05T00:00:00.000Z',
              contextBuiltAt: '2026-06-06T00:00:00.000Z',
              ageSeconds: 86400,
            },
            payload: { givenName: 'Ada' },
            tokenCost: 10,
          },
        ],
        phiClass: 'high',
        estimatedTokens: 42,
        tokenBudget: 4000,
        contextHash: 'b'.repeat(64),
        excluded: [],
      },
    });

    expect(metadata).toMatchObject({
      routedAlias: 'best_clinical',
      routedBackend: 'local_ollama',
      contextPresent: true,
      contextDocumentType: 'scribe-pass2',
      contextHash: 'b'.repeat(64),
      contextSourceCount: 1,
      contextSourceTables: { patients: 1 },
    });
  });

  it('classifies ambient context app errors as fail-closed and ignores generic crashes', () => {
    expect(shouldFailClosedForAmbientContext(
      new AppError('denied', 403, 'NO_PATIENT_RELATIONSHIP'),
    )).toBe(true);
    expect(shouldFailClosedForAmbientContext(new Error('reader crashed'))).toBe(false);
  });
});
