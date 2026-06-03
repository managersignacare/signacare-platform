import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

function makePayload(seed: string, adminEmail: string) {
  return {
    clinicName: `Provisioning Test Clinic ${seed}`,
    clinicType: 'solo_practice',
    hpio: '800362-1234 567890',
    timeZone: 'Australia/Melbourne',
    legalName: `Provisioning Test Clinic ${seed} Pty Ltd`,
    adminGivenName: 'Provision',
    adminFamilyName: `Owner${seed}`,
    adminEmail,
    adminRole: 'admin',
    enabledModules: ['patients', 'episodes'],
    seedDisciplines: false,
    seedClinicalRoles: false,
    seedMbsItems: false,
    seedReferralSources: false,
    seedAlertTypes: false,
    planType: 'trial',
    seats: 3,
    trialDays: 14,
  } as const;
}

async function cleanupProvisionedClinic(clinicId: string): Promise<void> {
  await withTenantContext(clinicId, async () => {
    await dbAdmin('subscriptions').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('clinic_modules').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('org_unit_programs').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('org_units').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('org_level_labels').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('clinical_templates').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('templates').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('appointment_modes').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('template_categories').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('alert_types').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('referral_sources').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('clinical_roles').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('professional_disciplines').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('subscriber_branding').where({ clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('staff').where({ clinic_id: clinicId }).del().catch(() => undefined);
  }).catch(() => undefined);
  await dbAdmin('clinics').where({ id: clinicId }).del().catch(() => undefined);
}

describe.skipIf(!READY)('provisioning onboarding', () => {
  it('accepts formatted HPI-O, normalizes it, and returns 409 (not 500) for duplicate admin email', async () => {
    const session = await loginAsAdmin();
    const agent = authedAgent(session.token);
    const seed = Date.now().toString().slice(-8);
    const adminEmail = `provisioning-${seed}@example.test`;
    const payload = makePayload(seed, adminEmail);
    const duplicateSeed = `dup-${seed}`;
    const duplicateClinicName = `Provisioning Test Clinic ${duplicateSeed}`;
    let clinicId: string | null = null;

    try {
      const createRes = await agent
        .post('/api/v1/provisioning/provision')
        .send(payload);

      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty('clinicId');
      clinicId = createRes.body.clinicId as string;

      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .first('id', 'hpio', 'nominated_admin_staff_id');
      expect(clinic?.id).toBe(clinicId);
      expect(clinic?.hpio).toBe('8003621234567890');

      const adminRow = await withTenantContext(clinicId, () =>
        dbAdmin('staff')
          .where({ clinic_id: clinicId, email: adminEmail.toLowerCase() })
          .first('id', 'role'),
      );
      expect(adminRow?.role).toBe('admin');
      expect(clinic?.nominated_admin_staff_id).toBe(adminRow?.id);

      const duplicateRes = await agent
        .post('/api/v1/provisioning/provision')
        .send({
          ...makePayload(duplicateSeed, adminEmail),
          hpio: '8003621234567891',
        });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body?.code).toBe('CONFLICT');
      expect(String(duplicateRes.body?.error ?? '')).not.toContain('Internal server error');

      const leakedDuplicateClinic = await dbAdmin('clinics')
        .where({ name: duplicateClinicName })
        .first('id');
      expect(leakedDuplicateClinic).toBeUndefined();
    } finally {
      const clinicIdsToCleanup = new Set<string>();
      if (clinicId) clinicIdsToCleanup.add(clinicId);
      const matchedClinics = await dbAdmin('clinics')
        .whereIn('name', [payload.clinicName, duplicateClinicName])
        .select('id');
      for (const row of matchedClinics) {
        if (row?.id) clinicIdsToCleanup.add(String(row.id));
      }
      for (const id of clinicIdsToCleanup) {
        await cleanupProvisionedClinic(id);
      }
    }
  });

  it('rejects invalid HPI-O with request validation error', async () => {
    const session = await loginAsAdmin();
    const agent = authedAgent(session.token);
    const seed = `invalid-${Date.now().toString().slice(-7)}`;
    const adminEmail = `provisioning-${randomUUID()}@example.test`;
    const payload = makePayload(seed, adminEmail);

    const res = await agent
      .post('/api/v1/provisioning/provision')
      .send({
        ...payload,
        hpio: '12345-invalid-hpio',
      });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
    expect(String(res.body?.error ?? '')).toContain('Request validation failed');
  });
});
