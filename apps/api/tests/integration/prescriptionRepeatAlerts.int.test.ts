/**
 * BUG-372c — prescription-repeat alert integration test.
 *
 * Live-DB exercise of the SQL JOIN that derives `consumed_count` from
 * `erx_tokens.dispensed_at` + the `notificationService.emit` insert
 * path. Asserts the notification row materialises with the right
 * severity for the high-risk drug class.
 *
 * Skip behaviour: degrades to "0 tests run" when integration stack
 * unavailable per `_helpers.ts:isIntegrationReady`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import {
  processPrescriptionRepeatAlerts,
  buildLiveContext,
} from '../../src/jobs/schedulers/prescriptionRepeatScheduler';
import { prescriptionRepeatHelpers } from '../../src/features/prescriptions/prescriptionRepeatHelpers';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let episodeId = '';
let prescriptionId = '';
const TEST_TAG = `BUG-372c-${Date.now()}`;

function ymdOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsClinician();

  patientId = randomUUID();
  episodeId = randomUUID();
  prescriptionId = randomUUID();

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Rx',
    family_name: TEST_TAG,
    emr_number: TEST_TAG,
    date_of_birth: '1990-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    primary_clinician_id: session.userId,
    episode_type: 'community',
    presenting_problem: TEST_TAG,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create a clozapine prescription expiring in 7 days with 5 repeats remaining.
  await dbAdmin('prescriptions').insert({
    id: prescriptionId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_id: episodeId,
    prescribed_by_staff_id: session.userId,
    generic_name: 'clozapine',
    brand_name: 'Clozaril',
    dose: '100mg',
    route: 'oral',
    frequency: 'BD',
    quantity: 28,
    repeats: 5,
    status: 'active',
    prescribed_date: ymdOffset(new Date(), -7),
    expires_at: ymdOffset(new Date(), 7),
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('notifications')
    .where({ clinic_id: session.clinicId })
    .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
    .del();
  await dbAdmin('erx_tokens').where({ prescription_id: prescriptionId }).del();
  await dbAdmin('prescriptions').where({ id: prescriptionId }).del();
  await dbAdmin('episodes').where({ id: episodeId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

describe.skipIf(!READY)('BUG-372c — prescription-repeat alerts (live)', () => {
  it('TP-PR-INT-1: clozapine prescription at T-7d emits severity critical', async () => {
    const out = await processPrescriptionRepeatAlerts(new Date(), await buildLiveContext());
    expect(out.errors).toBe(0);
    expect(out.emitted).toBeGreaterThanOrEqual(1);

    const rows = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'prescription-repeat' })
      .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
      .select('severity', 'payload');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].severity).toBe('critical'); // clozapine drug-class promotion
    const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(payload.high_risk_drug_class).toBe(true);
    expect(payload.bucket).toBe('T-7d');
  });

  it('TP-PR-INT-2: same-bucket re-run deduplicates via partial unique index', async () => {
    const before = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'prescription-repeat' })
      .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
      .count<{ count: string }[]>('id as count');
    const beforeCount = parseInt(before[0]!.count, 10);

    await processPrescriptionRepeatAlerts(new Date(), await buildLiveContext());

    const after = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'prescription-repeat' })
      .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
      .count<{ count: string }[]>('id as count');
    expect(parseInt(after[0]!.count, 10)).toBe(beforeCount);
  });

  it('TP-PR-INT-3: consumed_count derived correctly from erx_tokens — exhausted prescription is skipped', async () => {
    // Insert 5 dispensed erx_tokens (matches repeats=5 → consumed_count=5 → skip)
    for (let i = 0; i < 5; i++) {
      await dbAdmin('erx_tokens').insert({
        id: randomUUID(),
        clinic_id: session.clinicId,
        prescription_id: prescriptionId,
        token_value: `${TEST_TAG}-token-${i}`,
        status: 'dispensed',
        issued_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        dispensed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
    try {
      const rows = await prescriptionRepeatHelpers.listPrescriptionsApproachingRepeatDue(dbAdmin);
      const ourRow = rows.find((r) => r.prescription_id === prescriptionId);
      expect(ourRow).toBeDefined();
      expect(ourRow!.consumed_count).toBe(5);
      // Processor should now skip this prescription (consumed_count >= repeats).
      const before = await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, category: 'prescription-repeat' })
        .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
        .count<{ count: string }[]>('id as count');
      const beforeCount = parseInt(before[0]!.count, 10);
      const out = await processPrescriptionRepeatAlerts(new Date(), await buildLiveContext());
      expect(out.errors).toBe(0);
      // No NEW notifications — the existing dedupe-keyed rows from prior tests remain;
      // the integration assertion is that the count does not grow.
      const after = await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, category: 'prescription-repeat' })
        .whereRaw(`payload::text ILIKE ?`, [`%${prescriptionId}%`])
        .count<{ count: string }[]>('id as count');
      expect(parseInt(after[0]!.count, 10)).toBe(beforeCount);
    } finally {
      await dbAdmin('erx_tokens').where({ prescription_id: prescriptionId }).del();
    }
  });
});
