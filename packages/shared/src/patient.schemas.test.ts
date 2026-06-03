import { describe, expect, it } from 'vitest';
import { CreatePatientSchema } from './patient.schemas';

function basePayload() {
  return {
    givenName: 'Noah',
    familyName: 'Bennett',
    dateOfBirth: '1990-01-01',
    phoneMobile: '0400 123 456',
    medicareNumber: '2123456701',
    medicareIrn: '1',
  };
}

describe('patient.schemas — BUG-WF31 strict registration validation', () => {
  it('accepts a valid payload', () => {
    const parsed = CreatePatientSchema.parse(basePayload());
    expect(parsed.givenName).toBe('Noah');
    expect(parsed.medicareNumber).toBe('2123456701');
  });

  it('rejects future dateOfBirth', () => {
    const parsed = CreatePatientSchema.safeParse({
      ...basePayload(),
      dateOfBirth: '2099-01-01',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects implausible age > 130 years', () => {
    const parsed = CreatePatientSchema.safeParse({
      ...basePayload(),
      dateOfBirth: '1800-01-01',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed phone values', () => {
    const parsed = CreatePatientSchema.safeParse({
      ...basePayload(),
      phoneMobile: 'abc@@@',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid medicare checksum', () => {
    const parsed = CreatePatientSchema.safeParse({
      ...basePayload(),
      medicareNumber: '2123456711',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid medicare IRN', () => {
    const parsed = CreatePatientSchema.safeParse({
      ...basePayload(),
      medicareIrn: '0',
    });
    expect(parsed.success).toBe(false);
  });
});
