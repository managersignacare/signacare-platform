/**
 * BUG-331 regression — ambient AI worker MUST re-check patient relationship
 * at job pickup (not only at enqueue/request time).
 *
 * The queue can delay processing while staff role/activity/relationships
 * change. This suite calls the pickup-time guard directly and verifies:
 *   1) ambient job context must include patient/staff/clinic IDs
 *   2) no relationship => 403 NO_PATIENT_RELATIONSHIP
 *   3) active relationship => pass
 *   4) deactivated staff => 403 AMBIENT_STAFF_CONTEXT_INVALID
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import { recheckAmbientPatientRelationshipAtPickup } from '../../src/jobs/workers/aiWorker';

const READY = await isIntegrationReady();

let clinicId = '';
let staffId = '';
let relatedPatientId = '';
let orphanPatientId = '';
let relationshipEpisodeId = '';

beforeAll(async () => {
  if (!READY) return;

  const clinician = await loginAsClinician();
  clinicId = clinician.clinicId;
  staffId = clinician.userId;

  relatedPatientId = randomUUID();
  orphanPatientId = randomUUID();
  relationshipEpisodeId = randomUUID();

  await dbAdmin('patients').insert([
    {
      id: relatedPatientId,
      clinic_id: clinicId,
      given_name: 'Bug331',
      family_name: 'Related',
      date_of_birth: '1990-01-01',
    },
    {
      id: orphanPatientId,
      clinic_id: clinicId,
      given_name: 'Bug331',
      family_name: 'Orphan',
      date_of_birth: '1991-01-01',
    },
  ]);

  await dbAdmin('episodes').insert({
    id: relationshipEpisodeId,
    patient_id: relatedPatientId,
    clinic_id: clinicId,
    title: 'BUG-331 relationship fixture',
    status: 'open',
    start_date: new Date().toISOString().slice(0, 10),
    specialty_code: 'mental_health',
    primary_clinician_id: staffId,
    lock_version: 0,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  if (relationshipEpisodeId) {
    await dbAdmin('episodes').where({ id: relationshipEpisodeId }).del().catch(() => undefined);
  }
  if (relatedPatientId || orphanPatientId) {
    await dbAdmin('patients').whereIn('id', [relatedPatientId, orphanPatientId]).del().catch(() => undefined);
  }
});

describe.skipIf(!READY)('BUG-331 ambient worker pickup relationship gate', () => {
  it('BUG-331-1: ambient job missing patient context fails closed with AMBIENT_JOB_CONTEXT_INVALID', async () => {
    await expect(
      recheckAmbientPatientRelationshipAtPickup({
        action: 'ambient',
        staffId,
        clinicId,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'AMBIENT_JOB_CONTEXT_INVALID',
    });
  });

  it('BUG-331-2: clinician with no relationship is rejected at pickup', async () => {
    await expect(
      recheckAmbientPatientRelationshipAtPickup({
        action: 'ambient',
        patientId: orphanPatientId,
        staffId,
        clinicId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'NO_PATIENT_RELATIONSHIP',
    });
  });

  it('BUG-331-3: clinician with active relationship passes pickup-time gate', async () => {
    await expect(
      recheckAmbientPatientRelationshipAtPickup({
        action: 'ambient',
        patientId: relatedPatientId,
        staffId,
        clinicId,
      }),
    ).resolves.toBeUndefined();
  });

  it('BUG-331-4: deactivated staff is rejected even if relationship row exists', async () => {
    await dbAdmin('staff').where({ id: staffId }).update({ is_active: false });
    try {
      await expect(
        recheckAmbientPatientRelationshipAtPickup({
          action: 'ambient',
          patientId: relatedPatientId,
          staffId,
          clinicId,
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: 'AMBIENT_STAFF_CONTEXT_INVALID',
      });
    } finally {
      await dbAdmin('staff').where({ id: staffId }).update({ is_active: true });
    }
  });
});
