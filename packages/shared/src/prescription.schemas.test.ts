import { describe, expect, it } from 'vitest';
import { PrescriptionCreateSchema } from './prescription.schemas';

function basePayload() {
  return {
    patientId: '11111111-1111-1111-1111-111111111111',
    patientMedicationId: '22222222-2222-2222-2222-222222222222',
    genericName: 'Lithium carbonate',
    dose: '450mg',
    route: 'oral',
    frequency: 'nocte',
    quantity: 30,
    repeats: 1,
    prescribedDate: '2026-05-27',
  };
}

describe('prescription.schemas — BUG-WF81 PBS authority validation', () => {
  it('accepts non-authority prescription without authority code', () => {
    const parsed = PrescriptionCreateSchema.parse({
      ...basePayload(),
      isAuthority: false,
    });
    expect(parsed.isAuthority).toBe(false);
    expect(parsed.authorityCode).toBeUndefined();
  });

  it('rejects authority prescription without PBS item code', () => {
    const parsed = PrescriptionCreateSchema.safeParse({
      ...basePayload(),
      isAuthority: true,
      authorityCode: 'AUTH-01',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects authority prescription without authority code', () => {
    const parsed = PrescriptionCreateSchema.safeParse({
      ...basePayload(),
      isAuthority: true,
      pbsItemCode: '8200J',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts authority prescription with PBS item code and authority code', () => {
    const parsed = PrescriptionCreateSchema.parse({
      ...basePayload(),
      isAuthority: true,
      pbsItemCode: '8200J',
      authorityCode: 'AUTH-02',
    });
    expect(parsed.isAuthority).toBe(true);
    expect(parsed.pbsItemCode).toBe('8200J');
    expect(parsed.authorityCode).toBe('AUTH-02');
  });
});

