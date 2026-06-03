import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import { InMemoryJobBus, jobBus } from '../../src/shared/jobBus';

const READY = await isIntegrationReady();
const TAG = `WF61-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

function requireInMemoryJobBus(): InMemoryJobBus {
  if (jobBus.backendName !== 'in-memory') {
    throw new Error('bugWf61ReceiptEmail.int.test.ts requires in-memory jobBus backend');
  }
  return jobBus as InMemoryJobBus;
}

async function seedPatientId(): Promise<string> {
  const row = await withTenantContext(session.clinicId, async () =>
    dbAdmin('patients')
      .where({ clinic_id: session.clinicId })
      .whereNull('deleted_at')
      .select('id')
      .orderBy('created_at', 'desc')
      .first(),
  );
  if (!row?.id) throw new Error('No patient fixture available for BUG-WF61 billing email integration test');
  return String(row.id);
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  await withTenantContext(session.clinicId, async () => {
    if (createdPaymentIds.length > 0) {
      await dbAdmin('payments')
        .where({ clinic_id: session.clinicId })
        .whereIn('id', createdPaymentIds)
        .del()
        .catch(() => undefined);
    }

    if (createdInvoiceIds.length > 0) {
      await dbAdmin('patient_shared_documents')
        .where({ clinic_id: session.clinicId })
        .whereIn('url', createdInvoiceIds.map((id) => `billing/invoices/${id}`))
        .del()
        .catch(() => undefined);
      await dbAdmin('invoice_line_items')
        .whereIn('invoice_id', createdInvoiceIds)
        .del()
        .catch(() => undefined);
      await dbAdmin('invoices')
        .where({ clinic_id: session.clinicId })
        .whereIn('id', createdInvoiceIds)
        .del()
        .catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('BUG-WF61-RECEIPT-EMAIL-MISSING — billing email dispatch', () => {
  it('enqueues billing_notice receipt email when payment is recorded', async () => {
    const bus = requireInMemoryJobBus();
    bus.reset();
    const patientId = await seedPatientId();

    const createRes = await request(app)
      .post('/api/v1/billing/invoices')
      .set(authHeaders(session.token))
      .send({
        patientId,
        billingType: 'private',
        dueDate: '2026-12-31',
        notes: `BUG-WF61 payment receipt probe ${TAG}`,
        lineItems: [
          {
            description: 'Psychiatry review',
            quantity: 1,
            unitPriceCents: 5000,
            discountCents: 0,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = String(createRes.body?.id ?? '');
    expect(invoiceId).toMatch(/[0-9a-f-]{36}/);
    createdInvoiceIds.push(invoiceId);

    const paymentRes = await request(app)
      .post('/api/v1/billing/payments')
      .set(authHeaders(session.token))
      .send({
        invoiceId,
        amount: 5000,
        paymentMethod: 'card',
        paymentDate: '2026-05-28',
      });
    expect(paymentRes.status).toBe(201);
    const paymentId = String(paymentRes.body?.id ?? '');
    expect(paymentId).toMatch(/[0-9a-f-]{36}/);
    createdPaymentIds.push(paymentId);

    const receiptJobs = bus.dump('email').filter((j) =>
      j.data['type'] === 'billing_notice'
      && j.data['clinicId'] === session.clinicId
      && j.data['invoiceId'] === invoiceId
      && j.data['paymentId'] === paymentId);
    expect(receiptJobs).toHaveLength(1);
    expect(receiptJobs[0]?.data?.['title']).toContain('Payment receipt');
    bus.reset();
  });

  it('enqueues billing_notice email when invoice is sent', async () => {
    const bus = requireInMemoryJobBus();
    bus.reset();
    const patientId = await seedPatientId();

    const createRes = await request(app)
      .post('/api/v1/billing/invoices')
      .set(authHeaders(session.token))
      .send({
        patientId,
        billingType: 'private',
        dueDate: '2026-12-31',
        notes: `BUG-WF61 invoice send probe ${TAG}`,
        lineItems: [
          {
            description: 'Psychology consult',
            quantity: 1,
            unitPriceCents: 3000,
            discountCents: 0,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = String(createRes.body?.id ?? '');
    expect(invoiceId).toMatch(/[0-9a-f-]{36}/);
    createdInvoiceIds.push(invoiceId);

    const sendRes = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/send`)
      .set(authHeaders(session.token))
      .send({});
    expect(sendRes.status).toBe(200);
    expect(sendRes.body).toMatchObject({ ok: true });

    const issuedJobs = bus.dump('email').filter((j) =>
      j.data['type'] === 'billing_notice'
      && j.data['clinicId'] === session.clinicId
      && j.data['invoiceId'] === invoiceId
      && j.data['title'] === `Invoice issued — ${String(createRes.body?.invoiceNumber ?? '')}`);
    expect(issuedJobs).toHaveLength(1);
    bus.reset();
  });
});
