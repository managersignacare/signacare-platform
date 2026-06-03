import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { AU_CLINICAL_ROLES } from '@signacare/shared';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { runReferenceDataStep } from '../../src/seed-good-health/generators/00_reference_data';
import { isIntegrationReady } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('seed-good-health reference data natural-key upsert', () => {
  it('preserves legacy clinical_role id when natural key already exists', async () => {
    const clinicId = randomUUID();
    const legacyRoleId = randomUUID();
    const role = AU_CLINICAL_ROLES[0];
    const now = new Date().toISOString();

    const seedTag = Date.now().toString().slice(-10);
    const abn = `99${seedTag.slice(-9)}`;

    await dbAdmin('clinics').insert({
      id: clinicId,
      name: `Seed Collision Clinic ${seedTag}`,
      legal_name: `Seed Collision Clinic ${seedTag} Pty Ltd`,
      abn,
      time_zone: 'Australia/Melbourne',
      hpio: '8003620000000001',
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await withTenantContext(clinicId, () =>
      dbAdmin('clinical_roles').insert({
        id: legacyRoleId,
        clinic_id: clinicId,
        name: role.displayName,
        is_active: false,
        sort_order: 999,
        created_at: now,
        updated_at: now,
      }),
    );

    try {
      await withTenantContext(
        clinicId,
        () => runReferenceDataStep(dbAdmin, { clinicIds: [clinicId] }),
      );

      const rows = await withTenantContext(clinicId, () =>
        dbAdmin('clinical_roles')
          .where({ clinic_id: clinicId, name: role.displayName })
          .select('id', 'is_active', 'sort_order'),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(legacyRoleId);
      expect(rows[0]?.is_active).toBe(true);
      expect(rows[0]?.sort_order).toBe(role.sortOrder);
    } finally {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('template_categories').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('appointment_modes').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('alert_types').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('investigation_types').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('referral_sources').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('clinical_roles').where({ clinic_id: clinicId }).del().catch(() => undefined);
        await dbAdmin('professional_disciplines').where({ clinic_id: clinicId }).del().catch(() => undefined);
      }).catch(() => undefined);
      await dbAdmin('clinics').where({ id: clinicId }).del().catch(() => undefined);
    }
  });
});
