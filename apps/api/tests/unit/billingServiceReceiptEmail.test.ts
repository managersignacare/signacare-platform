import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as billingRepo from '../../src/features/billing/billingRepository';
import * as billingService from '../../src/features/billing/billingService';
import { jobBus } from '../../src/shared/jobBus';

describe('billingService.recordPayment — billing receipt dispatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues billing_notice email after successful payment', async () => {
    vi.spyOn(billingRepo, 'getInvoiceWithItems').mockResolvedValue({
      id: 'inv-1',
      clinic_id: 'clinic-1',
      patient_id: 'patient-1',
      invoice_number: 'INV-20260528-ABC123',
      status: 'approved',
      total_amount: 2000,
      paid_amount: 0,
      lineItems: [],
    } as unknown as Awaited<ReturnType<typeof billingRepo.getInvoiceWithItems>>);
    vi.spyOn(billingRepo, 'createPayment').mockResolvedValue({
      id: 'pay-1',
      clinic_id: 'clinic-1',
      invoice_id: 'inv-1',
      received_by_id: 'staff-1',
      amount: 500,
      payment_method: 'card',
      payment_date: '2026-05-28',
      reference_number: 'R-100',
      claim_status: null,
      claim_reference: null,
      notes: null,
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:00:00.000Z',
    });

    const enqueueSpy = vi.spyOn(jobBus, 'enqueue').mockResolvedValue(undefined);

    const out = await billingService.recordPayment('clinic-1', 'staff-1', {
      invoiceId: 'inv-1',
      amount: 500,
      paymentMethod: 'card',
      paymentDate: '2026-05-28',
    });

    expect(out.id).toBe('pay-1');
    expect(enqueueSpy).toHaveBeenCalledWith(
      'email',
      expect.objectContaining({
        type: 'billing_notice',
        clinicId: 'clinic-1',
        patientId: 'patient-1',
        invoiceId: 'inv-1',
        paymentId: 'pay-1',
        amountCents: 500,
      }),
    );
  });

  it('does not fail payment write when billing_notice enqueue fails', async () => {
    vi.spyOn(billingRepo, 'getInvoiceWithItems').mockResolvedValue({
      id: 'inv-2',
      clinic_id: 'clinic-1',
      patient_id: 'patient-2',
      invoice_number: 'INV-20260528-XYZ999',
      status: 'approved',
      total_amount: 1500,
      paid_amount: 0,
      lineItems: [],
    } as unknown as Awaited<ReturnType<typeof billingRepo.getInvoiceWithItems>>);
    vi.spyOn(billingRepo, 'createPayment').mockResolvedValue({
      id: 'pay-2',
      clinic_id: 'clinic-1',
      invoice_id: 'inv-2',
      received_by_id: 'staff-1',
      amount: 300,
      payment_method: 'cash',
      payment_date: '2026-05-28',
      reference_number: null,
      claim_status: null,
      claim_reference: null,
      notes: null,
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:00:00.000Z',
    });
    vi.spyOn(jobBus, 'enqueue').mockRejectedValue(new Error('queue unavailable'));

    await expect(
      billingService.recordPayment('clinic-1', 'staff-1', {
        invoiceId: 'inv-2',
        amount: 300,
        paymentMethod: 'cash',
        paymentDate: '2026-05-28',
      }),
    ).resolves.toMatchObject({ id: 'pay-2' });
  });
});
