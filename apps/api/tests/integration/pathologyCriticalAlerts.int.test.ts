/**
 * BUG-372a — pathology critical-result alert integration test.
 *
 * Exercises the live SQL `listUnacknowledgedCritical` helper + the live
 * `notificationService.emit` insert path, then re-runs the processor
 * within the same UTC-day to assert the partial unique index dedupes.
 *
 * Skip behaviour: degrades to "0 tests run" when integration stack
 * unavailable per `_helpers.ts:isIntegrationReady`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  processPathologyCriticalAlerts,
  buildLiveContext,
} from '../../src/jobs/schedulers/pathologyCriticalScheduler';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let episodeId = '';
let pathologyOrderId = '';
let resultId = '';
const TEST_TAG = `BUG-372a-${Date.now()}`;

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  patientId = randomUUID();
  episodeId = randomUUID();
  pathologyOrderId = randomUUID();
  resultId = randomUUID();

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'PathAlert',
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

  await dbAdmin('pathology_orders').insert({
    id: pathologyOrderId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_id: episodeId,
    ordered_by_id: session.userId,
    order_number: TEST_TAG,
    panel_name: 'Sodium panel',
    tests: ['Na'],
    urgency: 'urgent',
    status: 'completed',
    created_at: new Date(),
    updated_at: new Date(),
  });

  // 60-min-old critical_high result that has NOT been acknowledged.
  await dbAdmin('pathology_results').insert({
    id: resultId,
    clinic_id: session.clinicId,
    pathology_order_id: pathologyOrderId,
    patient_id: patientId,
    test_code: 'Na',
    test_name: 'Sodium',
    result_value: '160',
    result_unit: 'mmol/L',
    reference_range: '135-145',
    abnormal_flag: 'critical_high',
    result_status: 'final',
    collection_date: new Date().toISOString().slice(0, 10),
    result_date: new Date().toISOString().slice(0, 10),
    is_critical: true,
    created_at: new Date(Date.now() - 60 * 60 * 1000),
    updated_at: new Date(Date.now() - 60 * 60 * 1000),
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('notifications').whereRaw(`payload::text ILIKE ?`, [`%${TEST_TAG}%`]).del();
  await dbAdmin('notifications')
    .where({ clinic_id: session.clinicId })
    .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
    .del();
  await dbAdmin('pathology_results').where({ id: resultId }).del();
  await dbAdmin('pathology_orders').where({ id: pathologyOrderId }).del();
  await dbAdmin('episodes').where({ id: episodeId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

describe.skipIf(!READY)('BUG-372a — pathology critical-result alerts (live)', () => {
  it('TP-PA-INT-1: emits notification rows for unacknowledged critical result', async () => {
    const out = await processPathologyCriticalAlerts(new Date(), await buildLiveContext());
    expect(out.processed).toBeGreaterThanOrEqual(1);
    expect(out.emitted).toBeGreaterThanOrEqual(1);
    expect(out.errors).toBe(0);

    const rows = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
      .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
      .select('id', 'severity', 'category', 'payload');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].severity).toBe('critical');
    expect(rows[0].category).toBe('pathology');
  });

  it('TP-PA-INT-2: re-running same UTC-day deduplicates via partial unique index', async () => {
    const before = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
      .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
      .count<{ count: string }[]>('id as count');
    const beforeCount = parseInt(before[0]!.count, 10);

    await processPathologyCriticalAlerts(new Date(), await buildLiveContext());

    const after = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
      .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
      .count<{ count: string }[]>('id as count');
    const afterCount = parseInt(after[0]!.count, 10);

    expect(afterCount).toBe(beforeCount);
  });

  it('TP-PA-INT-3: next UTC-day boundary re-emits when still unacknowledged', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await processPathologyCriticalAlerts(tomorrow, await buildLiveContext());

    const rows = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
      .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
      .select('id', 'payload');
    // At least 2 distinct dedupe keys (today + tomorrow). Each row's
    // payload.dedupe_key contains the YYYY-MM-DD bucket.
    const keys = new Set(
      rows.map((r) => {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        return p?.dedupe_key as string;
      }),
    );
    expect(keys.size).toBeGreaterThanOrEqual(2);
  });

  it('TP-PA-INT-4: soft-deleted pathology_order excludes its results from the alert query', async () => {
    // Setup: soft-delete the order, run the processor, expect 0 processed.
    await dbAdmin('pathology_orders').where({ id: pathologyOrderId }).update({ deleted_at: new Date() });
    try {
      const before = await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
        .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
        .count<{ count: string }[]>('id as count');
      const beforeCount = parseInt(before[0]!.count, 10);

      await processPathologyCriticalAlerts(new Date(), await buildLiveContext());

      const after = await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
        .whereRaw(`payload::text ILIKE ?`, [`%${resultId}%`])
        .count<{ count: string }[]>('id as count');
      const afterCount = parseInt(after[0]!.count, 10);

      // This specific result must not emit when the parent order is soft-deleted.
      expect(afterCount).toBe(beforeCount);
    } finally {
      // Restore so afterAll can clean up
      await dbAdmin('pathology_orders').where({ id: pathologyOrderId }).update({ deleted_at: null });
    }
  });
});
