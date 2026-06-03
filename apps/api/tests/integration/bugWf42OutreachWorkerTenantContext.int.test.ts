import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import { processPatientOutreachJob } from '../../src/features/patient-outreach/patientOutreachWorkerProcessor';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-WF42-WORKER-RLS-${Date.now()}`;

let clinicId = '';
const createdPatientIds: string[] = [];

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsClinician();
  clinicId = session.clinicId;
});

afterAll(async () => {
  if (!READY || !clinicId) return;
  await withTenantContext(clinicId, async () => {
    if (createdPatientIds.length > 0) {
      await dbAdmin('patient_outreach_log')
        .where({ clinic_id: clinicId })
        .whereIn('patient_id', createdPatientIds)
        .del()
        .catch(() => undefined);

      await dbAdmin('patients')
        .where({ clinic_id: clinicId })
        .whereIn('id', createdPatientIds)
        .del()
        .catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('BUG-WF42 — patient outreach worker tenant context', () => {
  it('loads patient profile under tenant context and writes outreach log row', async () => {
    const patientId = randomUUID();
    createdPatientIds.push(patientId);

    await withTenantContext(clinicId, async () => {
      await dbAdmin('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: 'Outreach',
        family_name: TEST_TAG,
        emr_number: `${TEST_TAG}-${patientId.slice(0, 8)}`,
        date_of_birth: '1990-01-01',
        sms_consent: false,
        phone_mobile: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    await expect(
      processPatientOutreachJob({
        clinicId,
        patientId,
        kind: 'clinical_message',
        title: 'Test outreach',
        body: 'This is a worker-path tenant context regression test.',
      }),
    ).resolves.toBeUndefined();

    const rows = await withTenantContext(clinicId, async () =>
      dbAdmin('patient_outreach_log')
        .where({
          clinic_id: clinicId,
          patient_id: patientId,
          kind: 'clinical_message',
        })
        .orderBy('attempted_at', 'desc')
        .select('channel', 'skip_reason')
        .limit(1),
    );

    expect(rows.length).toBe(1);
    expect(String(rows[0]?.channel ?? '')).toBe('skipped');
    expect(String(rows[0]?.skip_reason ?? '')).toBe('no_mobile_number');
  });
});
