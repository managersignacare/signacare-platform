/**
 * BUG-372b — MHA review-window alerts integration test.
 *
 * Live-DB exercise of the legalOrderRepository SELECT + the
 * notificationService.emit insert path; asserts the bell row
 * materialises and the partial unique index dedupes within a bucket.
 *
 * Skip behaviour: degrades to "0 tests run" when integration stack
 * unavailable per `_helpers.ts:isIntegrationReady`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  processMhaReviewAlerts,
  type MhaReviewContext,
  type MhaReviewRow,
} from '../../src/jobs/schedulers/mhaReviewScheduler';
import { legalOrderRepository } from '../../src/features/legal/legalOrderRepository';
import { notificationService } from '../../src/features/notifications/notificationService';
import { logger } from '../../src/utils/logger';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let episodeId = '';
let orderId = '';
let orderTypeId = '';
const TEST_TAG = `BUG-372b-${Date.now()}`;

function ymdOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  patientId = randomUUID();
  episodeId = randomUUID();
  orderId = randomUUID();
  orderTypeId = randomUUID();

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'MHA',
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

  // Seed an order_type for the legal_orders FK.
  await dbAdmin('legal_order_types').insert({
    id: orderTypeId,
    code: `TEST-${TEST_TAG.slice(0, 20)}`,
    name: 'Test MHA Order Type',
    jurisdiction: 'NSW',
    max_duration_days: 28,
    requires_tribunal: false,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create a legal order with review_date = today (T-0 bucket).
  await dbAdmin('legal_orders').insert({
    id: orderId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_id: episodeId,
    order_type_id: orderTypeId,
    order_number: TEST_TAG,
    start_date: ymdOffset(new Date(), -7),
    expires_at: ymdOffset(new Date(), 14),
    review_date: ymdOffset(new Date(), 0),
    status: 'active',
    created_by_staff_id: session.userId,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('notifications')
    .where({ clinic_id: session.clinicId })
    .whereRaw(`payload::text ILIKE ?`, [`%${orderId}%`])
    .del();
  await dbAdmin('legal_orders').where({ id: orderId }).del();
  await dbAdmin('legal_order_types').where({ id: orderTypeId }).del();
  await dbAdmin('episodes').where({ id: episodeId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

function buildLiveCtx(): MhaReviewContext {
  return {
    async listOrdersInReviewWindow(now: Date): Promise<MhaReviewRow[]> {
      void now;
      return legalOrderRepository.listOrdersInReviewWindow(dbAdmin) as Promise<MhaReviewRow[]>;
    },
    async emit(input) {
      return notificationService.emit({
        clinicId: input.clinicId,
        userId: input.userId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        conn: dbAdmin,
      });
    },
    logger,
  };
}

describe.skipIf(!READY)('BUG-372b — MHA review-window alerts (live)', () => {
  it('TP-MHA-INT-1: emits notification rows for T-0d bucket', async () => {
    const out = await processMhaReviewAlerts(new Date(), buildLiveCtx());
    expect(out.errors).toBe(0);
    expect(out.emitted).toBeGreaterThanOrEqual(1);

    const rows = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'mha-review' })
      .whereRaw(`payload::text ILIKE ?`, [`%${orderId}%`])
      .select('id', 'severity', 'category', 'payload');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].severity).toBe('critical'); // T-0 → critical
  });

  it('TP-MHA-INT-2: same-bucket re-run deduplicates via partial unique index', async () => {
    const before = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'mha-review' })
      .whereRaw(`payload::text ILIKE ?`, [`%${orderId}%`])
      .count<{ count: string }[]>('id as count');
    const beforeCount = parseInt(before[0]!.count, 10);

    await processMhaReviewAlerts(new Date(), buildLiveCtx());

    const after = await dbAdmin('notifications')
      .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'mha-review' })
      .whereRaw(`payload::text ILIKE ?`, [`%${orderId}%`])
      .count<{ count: string }[]>('id as count');
    expect(parseInt(after[0]!.count, 10)).toBe(beforeCount);
  });

  it('TP-MHA-INT-3: distinct buckets emit distinct dedupe keys', async () => {
    // Move review_date to T-3 → emit a separate bucket.
    await dbAdmin('legal_orders').where({ id: orderId }).update({ review_date: ymdOffset(new Date(), 3) });
    try {
      await processMhaReviewAlerts(new Date(), buildLiveCtx());
      const rows = await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId, category: 'mha-review' })
        .whereRaw(`payload::text ILIKE ?`, [`%${orderId}%`])
        .select('payload');
      const buckets = new Set(
        rows.map((r) => {
          const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
          return p?.bucket as string;
        }),
      );
      expect(buckets.size).toBeGreaterThanOrEqual(2);
    } finally {
      await dbAdmin('legal_orders').where({ id: orderId }).update({ review_date: ymdOffset(new Date(), 0) });
    }
  });
});
