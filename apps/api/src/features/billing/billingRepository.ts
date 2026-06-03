import { randomUUID } from 'crypto';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
// Phase 0b.2c-batch-3 (2026-05-06): drain hand-written billing column
// constants to migration-driven SSoT per Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: alias re-exports below ARE the end-state for Phase 0b.2's
// DoD ("0 remaining hand-written *_COLUMNS array literals"). Future
// migrations to billing_accounts / invoices / invoice_line_items /
// payments propagate automatically. No consumer-rename concern (all
// 4 constants are local-scope / no external imports). Non-clinical
// surface — L4 N/A per diff scope.
import { BILLING_ACCOUNTS_COLUMNS } from '../../db/types/billing_accounts';
import { INVOICES_COLUMNS } from '../../db/types/invoices';
import { INVOICE_LINE_ITEMS_COLUMNS } from '../../db/types/invoice_line_items';
import { PAYMENTS_COLUMNS } from '../../db/types/payments';
import type {
  BillingAccountCreateDTO,
  InvoiceCreateDTO,
  PaymentCreateDTO,
  ClaimUpdateDTO,
} from '@signacare/shared';

// Phase 0.7.5 c24 D7b — row interfaces matching schema-snapshot.json
// (verified 2026-04-18 via psql \d). Prior code used `Record<string,
// unknown>` which let the SD40-43 drift (D7a) go undetected for months.
// These interfaces + the guard prevent this class of bug from recurring.

export interface BillingAccountRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  account_type: string | null;
  medicare_number: string | null;
  dva_number: string | null;
  private_health_fund: string | null;
  member_number: string | null;
  is_active: boolean;
  created_at: Date;
  billing_type: string | null;
  health_fund_name: string | null;
  health_fund_member_number: string | null;
  ndis_number: string | null;
  ndis_package_manager: string | null;
  dva_card_type: string | null;
  notes: string | null;
  updated_at: Date;
}

export interface InvoiceRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_id: string | null;
  invoice_number: string;
  service_date: Date | string | null;
  mbs_item_code: string | null;
  mbs_item_description: string | null;
  fee_cents: number | null;
  status: string;
  payment_method: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  appointment_id: string | null;
  billing_type: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  paid_cents: number;
  gap_cents: number;
  schedule_fee_cents: number;
  rebate_cents: number;
  provider_fee_cents: number;
  due_date: Date | string | null;
  approved_at: Date | null;
  approved_by_staff_id: string | null;
  sent_at: Date | null;
  auto_generated: boolean;
  override_notes: string | null;
  referral_valid: boolean;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  mbs_item_code: string | null;
  description: string;
  fee_cents: number | null;
  quantity: number;
  created_at: Date;
  unit_price_cents: number;
  discount_cents: number;
  line_total_cents: number;
  schedule_fee_cents: number;
  updated_at: Date;
}

export interface PaymentRow {
  id: string;
  invoice_id: string | null;
  clinic_id: string;
  amount_cents: number | null;
  payment_method: string | null;
  reference: string | null;
  status: string;
  paid_at: Date | null;
  created_at: Date;
  received_by_id: string | null;
  payment_date: Date | string | null;
  claim_status: string | null;
  claim_reference: string | null;
  notes: string | null;
  updated_at: Date;
}

// Explicit column lists — one source of truth per table.
// Phase 0b.2c-batch-3 (2026-05-06): aliases of auto-generated SSoT (see
// import block + permanent rationale at top of file).
const BILLING_ACCOUNT_COLUMNS = BILLING_ACCOUNTS_COLUMNS;
const INVOICE_COLUMNS = INVOICES_COLUMNS;
const INVOICE_LINE_ITEM_COLUMNS = INVOICE_LINE_ITEMS_COLUMNS;
const PAYMENT_COLUMNS = PAYMENTS_COLUMNS;

export async function upsertBillingAccount(
  clinicId: string,
  dto: BillingAccountCreateDTO,
): Promise<Record<string, unknown>> {
  const existing = await db('billing_accounts')
    .where({ clinic_id: clinicId, patient_id: dto.patientId })
    .first();

  if (existing) {
    const rows = await db<BillingAccountRow>('billing_accounts')
      .where({ id: existing.id })
      .update({
        billing_type: dto.billingType,
        health_fund_name: dto.healthFundName ?? null,
        health_fund_member_number: dto.healthFundMemberNumber ?? null,
        ndis_number: dto.ndisNumber ?? null,
        ndis_package_manager: dto.ndisPackageManager ?? null,
        dva_number: dto.dvaNumber ?? null,
        dva_card_type: dto.dvaCardType ?? null,
        notes: dto.notes ?? null,
        updated_at: db.fn.now(),
      })
      .returning(BILLING_ACCOUNT_COLUMNS) as BillingAccountRow[];
    return rows[0] as unknown as Record<string, unknown>;
  }

  const rows = await db<BillingAccountRow>('billing_accounts')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: dto.patientId,
      billing_type: dto.billingType,
      health_fund_name: dto.healthFundName ?? null,
      health_fund_member_number: dto.healthFundMemberNumber ?? null,
      ndis_number: dto.ndisNumber ?? null,
      ndis_package_manager: dto.ndisPackageManager ?? null,
      dva_number: dto.dvaNumber ?? null,
      dva_card_type: dto.dvaCardType ?? null,
      notes: dto.notes ?? null,
      updated_at: db.fn.now(),
    })
    .returning(BILLING_ACCOUNT_COLUMNS) as BillingAccountRow[];
  return rows[0] as unknown as Record<string, unknown>;
}

export async function getBillingAccount(
  clinicId: string,
  patientId: string,
): Promise<Record<string, unknown> | undefined> {
  return db('billing_accounts')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .first() as Promise<Record<string, unknown> | undefined>;
}

export async function createInvoice(
  clinicId: string,
  dto: InvoiceCreateDTO,
  invoiceNumber: string,
  subtotal: number,
  gstAmount: number,
  totalAmount: number,
): Promise<Record<string, unknown> & { lineItems: Record<string, unknown>[] }> {
  return db.transaction(async (trx) => {
    const invoiceId = randomUUID();
    const invoiceRows = await trx<InvoiceRow>('invoices')
      .insert({
        id: invoiceId,
        clinic_id: clinicId,
        patient_id: dto.patientId,
        appointment_id: dto.appointmentId ?? null,
        invoice_number: invoiceNumber,
        billing_type: dto.billingType,
        subtotal_cents: subtotal,
        gst_cents: gstAmount,
        total_cents: totalAmount,
        paid_cents: 0,
        status: 'unpaid',
        due_date: dto.dueDate ?? null,
        notes: dto.notes ?? null,
        updated_at: db.fn.now(),
      })
      .returning(INVOICE_COLUMNS) as InvoiceRow[];
    const invoice = invoiceRows[0];

    const lineItemRows = dto.lineItems.map((li) => ({
      id: randomUUID(),
      invoice_id: invoiceId,
      // Phase 0.7.5 c24 D7a (SD43) — column is `mbs_item_code` in the
      // DB, not `mbs_item_number`. The DTO keeps `mbsItemNumber` so the
      // client contract is unchanged.
      mbs_item_code: li.mbsItemNumber ?? null,
      description: li.description,
      quantity: li.quantity,
      unit_price_cents: li.unitPriceCents,
      discount_cents: li.discountCents ?? 0,
      line_total_cents: li.unitPriceCents * li.quantity - (li.discountCents ?? 0),
      schedule_fee_cents: li.scheduleFeeCents ?? 0,
    }));

    const lineItems = await trx<InvoiceLineItemRow>('invoice_line_items')
      .insert(lineItemRows)
      .returning(INVOICE_LINE_ITEM_COLUMNS) as InvoiceLineItemRow[];

    return {
      ...(invoice as unknown as Record<string, unknown>),
      lineItems: lineItems as unknown as Record<string, unknown>[],
    };
  });
}

export async function findInvoicesByPatient(
  clinicId: string,
  patientId: string,
): Promise<Record<string, unknown>[]> {
  return db('invoices')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('created_at', 'desc') as Promise<Record<string, unknown>[]>;
}

export async function getInvoiceWithItems(
  clinicId: string,
  invoiceId: string,
): Promise<(Record<string, unknown> & { lineItems: Record<string, unknown>[] }) | undefined> {
  const invoice = await db('invoices')
    .where({ id: invoiceId, clinic_id: clinicId })
    .first() as Record<string, unknown> | undefined;

  if (!invoice) return undefined;

  const lineItems = await db('invoice_line_items')
    .where({ invoice_id: invoiceId })
    .orderBy('created_at', 'asc') as Record<string, unknown>[];

  return { ...invoice, lineItems };
}

export async function createPayment(
  clinicId: string,
  receivedById: string,
  dto: PaymentCreateDTO,
): Promise<Record<string, unknown>> {
  return db.transaction(async (trx) => {
    // CLAUDE.md §1.6 — concurrent payment submissions must not race.
    //
    // The original implementation:
    //   1. SELECT paid_amount FROM invoices WHERE id = ?
    //   2. compute newPaidAmount = old + dto.amount in JS
    //   3. UPDATE invoices SET paid_amount = newPaidAmount
    //
    // Two concurrent recordPayment() calls could both read paid_amount=0,
    // both compute newPaidAmount=X, and the second UPDATE silently
    // overwrites the first — one payment's money is lost and the invoice
    // status is wrong. Fixed with a belt-and-braces pair:
    //
    //   - `.forUpdate()` on the SELECT locks the invoice row for the
    //     lifetime of this transaction so the status derivation sees a
    //     consistent paid_amount.
    //   - The UPDATE sets paid_amount via a `trx.raw('paid_amount + ?')`
    //     atomic expression so even a future code change that removes
    //     the .forUpdate() cannot reintroduce the race.
    //
    // Also closes two latent bugs that were in the same block:
    //   - The UPDATE was missing `clinic_id` in its WHERE clause
    //     (CLAUDE.md §1.3 violation — the row lookup was only by id).
    //   - Looking up a non-existent invoice produced a cryptic
    //     `TypeError: Cannot read properties of undefined` at the
    //     `Number(invoice['paid_amount'])` line. Now throws a clean
    //     NOT_FOUND AppError that the error middleware maps to 404.

    const paymentRows = await trx<PaymentRow>('payments')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        invoice_id: dto.invoiceId,
        received_by_id: receivedById,
        // Phase 0.7.5 c24 D7a (SD40) — column is `amount_cents`,
        // not `amount`. Every historical payment created via this
        // path was writing NULL to amount_cents (nullable column),
        // meaning the payment ledger was losing the actual paid
        // amount. DTO shape is unchanged.
        amount_cents: dto.amount,
        payment_method: dto.paymentMethod,
        payment_date: dto.paymentDate,
        // Phase 0.7.5 c24 D7a (SD41) — column is `reference`, not
        // `reference_number`. Same silent-drop pattern as SD40.
        reference: dto.referenceNumber ?? null,
        claim_status: null,
        claim_reference: null,
        notes: dto.notes ?? null,
        updated_at: trx.fn.now(),
      })
      .returning(PAYMENT_COLUMNS) as PaymentRow[];
    const payment = paymentRows[0];

    const invoice = (await trx('invoices')
      .where({ id: dto.invoiceId, clinic_id: clinicId })
      .forUpdate()
      .first()) as Record<string, unknown> | undefined;

    if (!invoice) {
      throw new AppError(
        `Invoice ${dto.invoiceId} not found`,
        404,
        'NOT_FOUND',
      );
    }

    // Phase 0.7.5 c24 D7a (SD42) — columns are `paid_cents` and
    // `total_cents` in the DB, not `paid_amount` / `total_amount`.
    // The previous code read `undefined` for both, so:
    //   - newPaidAmount was always `NaN` (NaN + dto.amount = NaN)
    //   - newStatus was always 'unpaid' (NaN >= NaN is false, NaN > 0 is false)
    //   - the UPDATE wrote `paid_amount = paid_amount + delta` but
    //     the column doesn't exist, so Knex silently dropped the
    //     update (no rows errored, but paid_cents never advanced).
    // Net effect: invoices stayed 'unpaid' forever even when fully
    // paid. Historical payments table still has the amount_cents NULL
    // from SD40 so no single-step data recovery is possible — this is
    // a forward-only fix. (A separate backfill pass can re-derive
    // invoice status from the corrected payments going forward.)
    const newPaidAmount = Number(invoice['paid_cents']) + dto.amount;
    const totalAmount = Number(invoice['total_cents']);
    const newStatus =
      newPaidAmount >= totalAmount
        ? 'paid'
        : newPaidAmount > 0
          ? 'partially_paid'
          : 'unpaid';

    await trx('invoices')
      .where({ id: dto.invoiceId, clinic_id: clinicId })
      .update({
        // Atomic SQL expression — cannot race even without the row
        // lock above. Two concurrent transactions see their own
        // reads serialize via the forUpdate lock, AND each UPDATE
        // writes `old + delta` as a single SQL statement.
        paid_cents: trx.raw('?? + ?', ['paid_cents', dto.amount]),
        status: newStatus,
        updated_at: trx.fn.now(),
      });

    return payment as unknown as Record<string, unknown>;
  });
}

export async function findPaymentsByInvoice(
  clinicId: string,
  invoiceId: string,
): Promise<Record<string, unknown>[]> {
  return db('payments')
    .where({ clinic_id: clinicId, invoice_id: invoiceId })
    .orderBy('payment_date', 'desc') as Promise<Record<string, unknown>[]>;
}

export async function updatePaymentClaimStatus(
  clinicId: string,
  paymentId: string,
  dto: ClaimUpdateDTO,
): Promise<void> {
  await db('payments')
    .where({ id: paymentId, clinic_id: clinicId })
    .update({
      claim_status: dto.claimStatus,
      claim_reference: dto.claimReference ?? null,
      notes: dto.notes ?? null,
      updated_at: db.fn.now(),
    });
}

export async function voidInvoice(clinicId: string, invoiceId: string): Promise<void> {
  await db('invoices')
    .where({ id: invoiceId, clinic_id: clinicId })
    .update({ status: 'void', updated_at: db.fn.now() });
}

// ── Auto-Invoice ──────────────────────────────────────────────────────────────

export async function createAutoInvoice(
  clinicId: string,
  invoiceData: Record<string, unknown>,
  lineItems: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  return db.transaction(async (trx) => {
    const id = randomUUID();
    const invoiceRows = await trx<InvoiceRow>('invoices')
      .insert({ id, clinic_id: clinicId, ...invoiceData })
      .returning(INVOICE_COLUMNS) as InvoiceRow[];
    const invoice = invoiceRows[0];

    for (const li of lineItems) {
      await trx('invoice_line_items').insert({
        id: randomUUID(),
        invoice_id: id,
        ...li,
      });
    }

    return invoice as unknown as Record<string, unknown>;
  });
}

export async function updateInvoice(
  clinicId: string,
  invoiceId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db('invoices')
    .where({ id: invoiceId, clinic_id: clinicId })
    .update(patch);
}

export async function listInvoices(
  clinicId: string,
  filters?: { status?: string; billingType?: string; limit?: number },
): Promise<Record<string, unknown>[]> {
  const query = db('invoices')
    .where({ clinic_id: clinicId })
    .orderBy('created_at', 'desc');

  if (filters?.status) query.where('status', filters.status);
  if (filters?.billingType) query.where('billing_type', filters.billingType);
  query.limit(filters?.limit ?? 100);

  return query as Promise<Record<string, unknown>[]>;
}
