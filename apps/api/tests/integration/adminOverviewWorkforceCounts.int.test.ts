import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
  loginAsClinician,
} from './_helpers';

const READY = await isIntegrationReady();
const CANONICAL_PATIENT_ID = 'b1111111-1111-4111-8111-111111111111';

describe.skipIf(!READY)('admin overview workforce counts', () => {
  let adminToken = '';
  let clinicId = '';
  let clinicianId = '';

  beforeAll(async () => {
    const admin = await loginAsAdmin();
    const clinician = await loginAsClinician();
    adminToken = admin.token;
    clinicId = admin.clinicId;
    clinicianId = clinician.userId;
  });

  it('includes non-zero clinician caseload when active assignment exists', async () => {
    const episodeId = randomUUID();
    const nowIso = new Date().toISOString();
    const episodeNumber = `WF-${Date.now()}`;

    try {
      await dbAdmin('episodes').insert({
        id: episodeId,
        clinic_id: clinicId,
        patient_id: CANONICAL_PATIENT_ID,
        title: 'Workforce caseload integration fixture',
        episode_number: episodeNumber,
        episode_type: 'mental_health',
        status: 'active',
        start_date: nowIso.slice(0, 10),
        primary_clinician_id: clinicianId,
        specialty_code: 'mental_health',
        lock_version: 0,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const res = await authedAgent(adminToken).get('/api/v1/reports/admin-overview');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body?.staff)).toBe(true);
      const row = (res.body.staff as Array<{ role: string; patients: number }>)
        .find((entry) => entry.role === 'clinician' && entry.patients >= 1);
      expect(row).toBeTruthy();
    } finally {
      await dbAdmin('episodes').where({ id: episodeId }).delete();
    }
  });
});
