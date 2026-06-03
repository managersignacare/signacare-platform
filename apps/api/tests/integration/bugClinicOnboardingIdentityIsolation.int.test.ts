import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';
import { CANONICAL_CLINIC_IDS } from '../fixtures/canonical-personas';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

function makeProvisionPayload(seed: string, adminEmail: string) {
  return {
    clinicName: `Identity Isolation Clinic ${seed}`,
    clinicType: 'solo_practice',
    hpio: `8003621234567${seed.slice(-3)}`,
    timeZone: 'Australia/Melbourne',
    legalName: `Identity Isolation Clinic ${seed} Pty Ltd`,
    adminGivenName: 'Clinic',
    adminFamilyName: `Admin${seed}`,
    adminEmail,
    adminRole: 'admin',
    sidebarTitle: `Clinic ${seed}`,
    sidebarSubtitle: 'Mental Health EMR',
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
  const staffIds = await withTenantContext(clinicId, async () => (
    (await dbAdmin('staff').where({ clinic_id: clinicId }).select('id'))
      .map((row: { id: string }) => row.id)
  ));
  if (staffIds.length > 0) {
    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff_sessions').whereIn('staff_id', staffIds).del().catch(() => undefined);
      await dbAdmin('staff')
        .whereIn('id', staffIds)
        .update({
          is_active: false,
          deleted_at: new Date(),
          updated_at: new Date(),
        })
        .catch(() => undefined);
    });
  }
  await withTenantContext(clinicId, async () => {
    await dbAdmin('clinics')
      .where({ id: clinicId })
      .update({
        is_active: false,
        deleted_at: new Date(),
        updated_at: new Date(),
      })
      .catch(() => undefined);
  });
}

describe.skipIf(!READY)('BUG-CLINIC-IDENTITY-ISOLATION', () => {
  it('normalizes onboarding admin email and keeps login/branding/staff scoped to provisioned clinic', async () => {
    const session = await loginAsAdmin();
    const superadmin = authedAgent(session.token);

    const seed = Date.now().toString().slice(-6);
    const mixedCaseEmail = `KDirector${seed}@demo.local`;
    const normalizedEmail = mixedCaseEmail.toLowerCase();
    const payload = makeProvisionPayload(seed, mixedCaseEmail);

    let clinicId: string | null = null;
    try {
      const provisionRes = await superadmin
        .post('/api/v1/provisioning/provision')
        .send(payload);

      expect(provisionRes.status).toBe(201);
      clinicId = String(provisionRes.body?.clinicId ?? '');
      expect(clinicId.length).toBeGreaterThan(0);
      expect(provisionRes.body?.adminEmail).toBe(normalizedEmail);
      expect(typeof provisionRes.body?.adminTemporaryPassword).toBe('string');

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          email: normalizedEmail,
          password: provisionRes.body.adminTemporaryPassword as string,
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body?.requiresMfa).toBe(false);
      expect(loginRes.body?.user?.clinicId).toBe(clinicId);
      expect(loginRes.body?.user?.email).toBe(normalizedEmail);

      const clinicAgent = authedAgent(loginRes.body.accessToken as string);
      const brandingRes = await clinicAgent.get('/api/v1/power-settings/branding/me');
      expect(brandingRes.status).toBe(200);
      expect(brandingRes.body?.branding?.clinicId).toBe(clinicId);
      expect(brandingRes.body?.branding?.sidebarTitle).toBe(payload.sidebarTitle);

      const staffLookupRes = await clinicAgent.get('/api/v1/staff/lookup');
      expect(staffLookupRes.status).toBe(200);
      const lookupRows = Array.isArray(staffLookupRes.body) ? staffLookupRes.body : [];
      const lookupIds = lookupRows.map((row: { id: string }) => row.id);
      const clinicStaffRows = await withTenantContext(clinicId, async () =>
        dbAdmin('staff')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .select('id')
      );
      const clinicStaffIds = new Set(clinicStaffRows.map((row: { id: string }) => row.id));
      expect(lookupIds.length).toBeGreaterThan(0);
      for (const id of lookupIds) {
        expect(clinicStaffIds.has(id)).toBe(true);
      }
    } finally {
      if (clinicId) {
        await cleanupProvisionedClinic(clinicId);
      }
    }
  });

  it('rejects case-variant duplicate staff emails at create time', async () => {
    const session = await loginAsAdmin();
    const superadmin = authedAgent(session.token);
    const seed = randomUUID().slice(0, 8);
    const emailMixed = `CaseProbe${seed}@demo.local`;
    const emailVariant = emailMixed.toLowerCase();

    let createdStaffId: string | null = null;
    try {
      const firstCreate = await superadmin
        .post('/api/v1/staff')
        .send({
          clinicId: CANONICAL_CLINIC_IDS.primary,
          givenName: 'Case',
          familyName: 'Probe',
          email: emailMixed,
          role: 'clinician',
        });

      expect(firstCreate.status).toBe(201);
      createdStaffId = firstCreate.body?.id as string;
      expect(typeof firstCreate.body?.temporaryPassword).toBe('string');

      const duplicateCreate = await superadmin
        .post('/api/v1/staff')
        .send({
          clinicId: CANONICAL_CLINIC_IDS.primary,
          givenName: 'Case',
          familyName: 'Probe 2',
          email: emailVariant,
          role: 'clinician',
        });

      expect(duplicateCreate.status).toBe(409);
      expect(duplicateCreate.body?.code).toBe('DUPLICATE_EMAIL');

      const activeRows = await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () =>
        dbAdmin('staff')
          .whereRaw('LOWER(email) = LOWER(?)', [emailVariant])
          .whereNull('deleted_at')
          .count<{ cnt: string }>('* as cnt')
          .first()
      );
      expect(Number(activeRows?.cnt ?? 0)).toBe(1);
    } finally {
      const rows = await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () =>
        dbAdmin('staff')
          .whereRaw('LOWER(email) = LOWER(?)', [emailVariant])
          .select('id')
      );
      const rowIds = rows.map((row: { id: string }) => row.id);
      if (createdStaffId && !rowIds.includes(createdStaffId)) {
        rowIds.push(createdStaffId);
      }
      if (rowIds.length > 0) {
        await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
          await dbAdmin('staff_sessions').whereIn('staff_id', rowIds).del().catch(() => undefined);
          await dbAdmin('staff')
            .whereIn('id', rowIds)
            .update({
              is_active: false,
              deleted_at: new Date(),
              updated_at: new Date(),
            })
            .catch(() => undefined);
        });
      }
    }
  });

  it('allows reusing onboarding admin email after prior staff row is soft-deleted', async () => {
    const session = await loginAsAdmin();
    const superadmin = authedAgent(session.token);
    const seed = randomUUID().slice(0, 8);
    const reusableEmail = `reusable.${seed}@demo.local`;
    const mixedCaseReusableEmail = reusableEmail.toUpperCase();

    let initialStaffId: string | null = null;
    let clinicId: string | null = null;
    try {
      const createStaffRes = await superadmin
        .post('/api/v1/staff')
        .send({
          clinicId: CANONICAL_CLINIC_IDS.primary,
          givenName: 'Reusable',
          familyName: 'Owner',
          email: reusableEmail,
          role: 'clinician',
        });

      expect(createStaffRes.status).toBe(201);
      initialStaffId = String(createStaffRes.body?.id ?? '');
      expect(initialStaffId.length).toBeGreaterThan(0);

      await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
        await dbAdmin('staff')
          .where({ id: initialStaffId })
          .update({
            is_active: false,
            deleted_at: new Date(),
            updated_at: new Date(),
          });
      });

      const provisionSeed = Date.now().toString().slice(-6);
      const provisionRes = await superadmin
        .post('/api/v1/provisioning/provision')
        .send(makeProvisionPayload(provisionSeed, mixedCaseReusableEmail));

      expect(provisionRes.status).toBe(201);
      clinicId = String(provisionRes.body?.clinicId ?? '');
      expect(clinicId.length).toBeGreaterThan(0);
      expect(provisionRes.body?.adminEmail).toBe(reusableEmail);

      const provisionedClinicRows = await withTenantContext(clinicId, async () =>
        dbAdmin('staff')
          .whereRaw('LOWER(email) = LOWER(?)', [reusableEmail])
          .whereNull('deleted_at')
          .select('id', 'clinic_id')
      );
      expect(provisionedClinicRows.length).toBe(1);
      expect(provisionedClinicRows[0]?.clinic_id).toBe(clinicId);

      const primaryClinicRows = await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () =>
        dbAdmin('staff')
          .whereRaw('LOWER(email) = LOWER(?)', [reusableEmail])
          .whereNull('deleted_at')
          .select('id')
      );
      expect(primaryClinicRows.length).toBe(0);
    } finally {
      if (clinicId) {
        await cleanupProvisionedClinic(clinicId);
      }
      if (initialStaffId) {
        await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
          await dbAdmin('staff_sessions').where({ staff_id: initialStaffId }).del().catch(() => undefined);
          await dbAdmin('staff')
            .where({ id: initialStaffId })
            .update({
              is_active: false,
              deleted_at: new Date(),
              updated_at: new Date(),
            })
            .catch(() => undefined);
        });
      }
      await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
        await dbAdmin('staff')
          .whereRaw('LOWER(email) = LOWER(?)', [reusableEmail])
          .update({
            is_active: false,
            deleted_at: new Date(),
            updated_at: new Date(),
          })
          .catch(() => undefined);
      });
      if (clinicId) {
        await withTenantContext(clinicId, async () => {
          await dbAdmin('staff')
            .whereRaw('LOWER(email) = LOWER(?)', [reusableEmail])
            .update({
              is_active: false,
              deleted_at: new Date(),
              updated_at: new Date(),
            })
            .catch(() => undefined);
        });
      }
    }
  });
});
