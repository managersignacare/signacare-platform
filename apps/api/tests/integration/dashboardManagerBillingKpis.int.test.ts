import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Knex } from 'knex';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

describe.skipIf(!ready)('BUG-647 dashboard manager billing KPI query', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;
  let createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    session = await loginAsAdmin();
  });

  async function withClinicContext<T>(
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    const { dbAdmin } = await import('../../src/db/db');
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [session.clinicId]);
      return work(trx);
    });
  }

  afterAll(async () => {
    if (createdInvoiceIds.length === 0) return;
    await withClinicContext(async (trx) => {
      await trx('invoices').whereIn('id', createdInvoiceIds).delete();
    });
    createdInvoiceIds = [];
  });

  it('returns manager dashboard without 500 and computes billing totals from canonical *_cents columns', async () => {
    const runId = randomUUID().slice(0, 8);

    const baselineRes = await request(app)
      .get('/api/v1/dashboard/manager')
      .query({ period: 'month', team: `bug647-baseline-${runId}` })
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test');

    expect(baselineRes.status).toBe(200);
    expect(baselineRes.body?.role).toBe('manager');

    const baselineKpis = baselineRes.body?.data?.billingKpis;
    expect(baselineKpis).toBeTruthy();

    const baselineInvoiceCount = asNumber(baselineKpis.invoiceCount);
    const baselineTotalInvoiced = asNumber(baselineKpis.totalInvoiced);
    const baselineTotalCollected = asNumber(baselineKpis.totalCollected);

    const now = new Date();
    const invoiceIds = [randomUUID(), randomUUID(), randomUUID()];
    createdInvoiceIds = invoiceIds;

    await withClinicContext(async (trx) => {
      await trx('invoices').insert([
        {
          id: invoiceIds[0],
          clinic_id: session.clinicId,
          status: 'pending',
          billing_type: 'bulk_bill',
          total_cents: 12345,
          paid_cents: 2345,
          created_at: now,
          updated_at: now,
        },
        {
          id: invoiceIds[1],
          clinic_id: session.clinicId,
          status: 'paid',
          billing_type: 'private',
          total_cents: 10000,
          paid_cents: 10000,
          created_at: now,
          updated_at: now,
        },
        {
          id: invoiceIds[2],
          clinic_id: session.clinicId,
          status: 'draft',
          billing_type: 'private',
          total_cents: 9999,
          paid_cents: 9999,
          created_at: now,
          updated_at: now,
        },
      ]);
    });

    const afterRes = await request(app)
      .get('/api/v1/dashboard/manager')
      .query({ period: 'month', team: `bug647-after-${runId}` })
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test');

    expect(afterRes.status).toBe(200);
    expect(afterRes.body?.role).toBe('manager');

    const afterKpis = afterRes.body?.data?.billingKpis;
    expect(afterKpis).toBeTruthy();

    const afterInvoiceCount = asNumber(afterKpis.invoiceCount);
    const afterTotalInvoiced = asNumber(afterKpis.totalInvoiced);
    const afterTotalCollected = asNumber(afterKpis.totalCollected);

    // Two non-draft/non-void invoices should count.
    expect(afterInvoiceCount - baselineInvoiceCount).toBe(2);
    // cents -> dollars conversion must be correct.
    expect(afterTotalInvoiced - baselineTotalInvoiced).toBeCloseTo(223.45, 2);
    expect(afterTotalCollected - baselineTotalCollected).toBeCloseTo(123.45, 2);
  });
});
