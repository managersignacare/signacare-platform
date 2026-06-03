import { describe, expect, it } from 'vitest';
import { ProvisionClinicSchema } from './provisioning.schemas';

const baseDto = {
  clinicName: 'Test Clinic',
  clinicType: 'solo_practice' as const,
  timeZone: 'Australia/Melbourne',
  adminGivenName: 'Test',
  adminFamilyName: 'Admin',
  adminEmail: 'admin@example.com',
  enabledModules: ['patients'],
  enabledSpecialties: ['mental_health'] as const,
  seedDisciplines: true,
  seedClinicalRoles: true,
  seedMbsItems: true,
  seedReferralSources: true,
  seedAlertTypes: true,
  planType: 'trial' as const,
  seats: 5,
  trialDays: 30,
};

describe('ProvisionClinicSchema HPI-O handling', () => {
  it('normalizes whitespace/hyphen separators before validation', () => {
    const parsed = ProvisionClinicSchema.parse({
      ...baseDto,
      hpio: '800 362-1234 567892',
    });

    expect(parsed.hpio).toBe('8003621234567892');
  });

  it('accepts canonical 16-digit HPI-O unchanged', () => {
    const parsed = ProvisionClinicSchema.parse({
      ...baseDto,
      hpio: '8003621234567892',
    });

    expect(parsed.hpio).toBe('8003621234567892');
  });

  it('rejects invalid HPI-O after normalization', () => {
    expect(() =>
      ProvisionClinicSchema.parse({
        ...baseDto,
        hpio: '800 360 1234 567892',
      }),
    ).toThrow(/HPI-O must be 16 digits starting with 800362/);
  });
});
