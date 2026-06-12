import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, ClinicalContextFact, ContextDocumentType } from '@signacare/shared';

const requirePatientRelationshipMock = vi.hoisted(() => vi.fn());
const readClinicalContextFactsMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/shared/authGuards', () => ({
  requirePatientRelationship: requirePatientRelationshipMock,
}));

vi.mock('../../src/features/llm/context/contextSourceReaders', () => ({
  readClinicalContextFacts: readClinicalContextFactsMock,
}));

const { buildClinicalContext } = await import('../../src/features/llm/context/buildClinicalContext');

const AUTH: AuthContext = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clinicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'clinician',
};

const PATIENT = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  given_name: 'Alex',
  family_name: 'Smith',
  preferred_name: null,
  date_of_birth: '1980-01-01',
  emr_number: 'MRN-1',
  updated_at: '2026-06-05T09:00:00.000Z',
};

const BASE_LINEAGE = {
  sourceTable: 'patients',
  sourceId: PATIENT.id,
  sourceDate: '2026-06-05T09:00:00.000Z',
  lineageKey: 'a'.repeat(64),
  citationRequired: false,
};

const BASE_FRESHNESS = {
  sourceCapturedAt: '2026-06-05T09:00:00.000Z',
  contextBuiltAt: '2026-06-05T09:01:00.000Z',
  ageSeconds: 60,
};

function makeFact(overrides: Partial<ClinicalContextFact> = {}): ClinicalContextFact {
  return {
    factId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    tier: 'A',
    domain: 'demographics',
    trustLevel: 'authoritative',
    lineage: { ...BASE_LINEAGE },
    freshness: { ...BASE_FRESHNESS },
    payload: { givenName: 'Alex', familyName: 'Smith' },
    tokenCost: 50,
    ...overrides,
  };
}

function consentFact(status: string): ClinicalContextFact {
  return makeFact({
    factId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    domain: 'consent_state',
    lineage: {
      sourceTable: 'scribe_consents',
      sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sourceDate: '2026-06-05T09:00:00.000Z',
      lineageKey: 'b'.repeat(64),
      citationRequired: false,
    },
    payload: { status },
  });
}

async function arrangeContext(documentType: ContextDocumentType, facts: ClinicalContextFact[]) {
  readClinicalContextFactsMock.mockResolvedValueOnce({
    anchorPatient: PATIENT,
    facts,
    preExcluded: [],
  });

  return buildClinicalContext({
    auth: AUTH,
    documentType,
    patientId: PATIENT.id,
  });
}

describe('buildClinicalContext consent gate', () => {
  beforeEach(() => {
    requirePatientRelationshipMock.mockReset();
    readClinicalContextFactsMock.mockReset();
    requirePatientRelationshipMock.mockResolvedValue(undefined);
  });

  it('allows scribe-pass2 context when consent_state is active', async () => {
    const built = await arrangeContext('scribe-pass2', [
      makeFact(),
      consentFact('active'),
    ]);

    expect(built.envelope.documentType).toBe('scribe-pass2');
    expect(built.envelope.facts.some((fact) => fact.domain === 'consent_state')).toBe(true);
  });

  it('fails closed for scribe-pass2 context when consent_state is missing', async () => {
    await expect(arrangeContext('scribe-pass2', [
      makeFact(),
      consentFact('missing'),
    ])).rejects.toMatchObject({
      status: 403,
      code: 'CONSENT_REQUIRED',
    });
  });

  it('fails closed with CONSENT_REVOKED when scribe consent was revoked', async () => {
    await expect(arrangeContext('scribe-pass2', [
      makeFact(),
      consentFact('revoked'),
    ])).rejects.toMatchObject({
      status: 403,
      code: 'CONSENT_REVOKED',
    });
  });

  it('does not apply the scribe consent gate to referral-letter context', async () => {
    const built = await arrangeContext('referral-letter', [
      makeFact(),
      consentFact('missing'),
    ]);

    expect(built.envelope.documentType).toBe('referral-letter');
  });

  it('fails with CONTEXT_OVERFLOW instead of dropping Tier-A context when the budget is too small', async () => {
    readClinicalContextFactsMock.mockResolvedValueOnce({
      anchorPatient: PATIENT,
      facts: [
        makeFact({ tokenCost: 50 }),
        consentFact('active'),
      ],
      preExcluded: [],
    });

    await expect(
      buildClinicalContext({
        auth: AUTH,
        documentType: 'scribe-pass2',
        patientId: PATIENT.id,
        tokenBudgetOverride: 1,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'CONTEXT_OVERFLOW',
    });
  });
});
