import { describe, expect, it } from 'vitest';
import { CreateAllergySchema } from './allergy.schemas';

const BASE_DTO = {
  patientId: '11111111-1111-1111-1111-111111111111',
  allergen: 'Penicillin',
  allergenType: 'drug' as const,
  severity: 'moderate' as const,
  status: 'active' as const,
};

describe('CreateAllergySchema', () => {
  it('accepts empty recordedAt as undefined', () => {
    const parsed = CreateAllergySchema.safeParse({
      ...BASE_DTO,
      recordedAt: '',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.recordedAt).toBeUndefined();
  });

  it('accepts YYYY-MM-DD recordedAt and normalizes to ISO datetime', () => {
    const parsed = CreateAllergySchema.safeParse({
      ...BASE_DTO,
      recordedAt: '2026-05-31',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.recordedAt).toBe('2026-05-31T00:00:00.000Z');
  });
});
