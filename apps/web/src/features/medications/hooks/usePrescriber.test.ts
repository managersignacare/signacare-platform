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
      prescriberNumber: 'ABC123',
      isPrescribingDisciplineEligible: false,
    })).toEqual({
      isPrescriber: true,
      isDisciplineEligible: false,
      canPrescribeClozapine: false,
    });
  });

  it('requires BOTH prescriber number and discipline eligibility for clozapine prescribing', () => {
    expect(evaluatePrescriberEligibility({
      prescriberNumber: 'ABC123',
      isPrescribingDisciplineEligible: true,
    })).toEqual({
      isPrescriber: true,
      isDisciplineEligible: true,
      canPrescribeClozapine: true,
    });
  });
});
