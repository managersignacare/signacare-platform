import { describe, expect, it } from 'vitest';
import { evaluatePrescriberEligibility } from './usePrescriber';

describe('BUG-324 — clozapine prescribing eligibility', () => {
  it('returns false for every flag when profile is missing', () => {
    expect(evaluatePrescriberEligibility(undefined)).toEqual({
      isPrescriber: false,
      isDisciplineEligible: false,
      canPrescribeClozapine: false,
    });
  });

  it('marks isPrescriber true when prescriberNumber exists', () => {
    expect(evaluatePrescriberEligibility({
      role: 'prescriber_registrar',
      prescriberNumber: 'ABC123',
      isPrescribingDisciplineEligible: false,
    })).toEqual({
      isPrescriber: true,
      isDisciplineEligible: true,
      canPrescribeClozapine: true,
    });
  });

  it('blocks prescribing when a prescriber number exists but the system role is not a prescriber role', () => {
    expect(evaluatePrescriberEligibility({
      role: 'clinician',
      prescriberNumber: 'ABC123',
      isPrescribingDisciplineEligible: true,
    })).toEqual({
      isPrescriber: false,
      isDisciplineEligible: false,
      canPrescribeClozapine: false,
    });
  });

  it('allows prescribing when the system role grants it and a prescriber number is present', () => {
    expect(evaluatePrescriberEligibility({
      role: 'prescriber_consultant',
      prescriberNumber: 'ABC123',
      hasPrescribingPrivileges: true,
    })).toEqual({
      isPrescriber: true,
      isDisciplineEligible: true,
      canPrescribeClozapine: true,
    });
  });
});
