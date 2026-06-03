// apps/web/src/features/billing/types/billingTypes.ts
//
// Phase 0.7 PR3 Class D — billing has 4 type duplicates:
// InvoiceStatus, InvoiceLineItemResponse, InvoiceResponse, PaymentResponse.
//
// Shared (@signacare/shared) is the single source of truth for the
// canonical billing types. The local file re-exports the shared
// InvoiceStatus enum (which has 12 statuses, vs the old frontend-only
// 7-value enum that left half the backend statuses unrendered — a real
// silent shipped bug).
//
// InvoiceResponse, InvoiceLineItemResponse, PaymentResponse are larger
// and the frontend bolted display metadata onto them over time
// (patientName, payments[], claims[], dollar-vs-cents variants). Those
// remain as `*View` extension types here so the historical name still
// resolves to the shared canonical type. Backend enrichment of those
// fields is tracked as a follow-up under TYPEDUP:InvoiceResponse.
import { z } from 'zod';
import {
  InvoiceStatusEnum,
  type InvoiceResponse as SharedInvoiceResponse,
  type PaymentResponse as SharedPaymentResponse,
} from '@signacare/shared';

export const InvoiceStatusSchema = InvoiceStatusEnum;
export type { InvoiceStatus } from '@signacare/shared';
export type { InvoiceLineItemResponse, InvoiceResponse, PaymentResponse } from '@signacare/shared';

export const ClaimTypeSchema = z.enum([
  'medicare', 'dva', 'ndis', 'private_health', 'self_funded',
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClaimStatusSchema = z.enum([
  'not_submitted', 'pending', 'processing', 'approved', 'rejected', 'partial', 'paid',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const InvoiceLineItemSchema = z.object({
  mbsItemNumber: z.string().max(20).optional(),
  description: z.string().min(1).max(500),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean().default(false),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const CreateInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  claimType: ClaimTypeSchema,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
  lineItems: z.array(InvoiceLineItemSchema).min(1),
});
export type CreateInvoiceDTO = z.infer<typeof CreateInvoiceSchema>;

// Phase 0.7 PR3 Class D — PaymentResponse + InvoiceLineItemResponse
// imported from shared above. Local Zod schemas removed. The frontend
// display fields that used to live here (amount in dollars, gstAmount,
// lineTotal) need backend enrichment to make available; flagged in the
// fix-registry under TYPEDUP:PaymentResponse and
// TYPEDUP:InvoiceLineItemResponse.

export const ClaimResponseSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  claimType: ClaimTypeSchema,
  claimStatus: ClaimStatusSchema,
  claimReference: z.string().nullable(),
  submittedAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  approvedAmount: z.number().nullable(),
  rejectionReason: z.string().nullable(),
  notes: z.string().nullable(),
});
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

// Phase 0.7 PR3 Class D — InvoiceResponse imported from shared above.
// The historical `.passthrough()` schema is gone; a InvoiceResponseView
// extension type below preserves the display-only fields the patient
// billing tab reads (patientName, payments[], claims[], dollar
// variants). Backend enrichment is the proper fix; tracked under
// TYPEDUP:InvoiceResponse in the fix-registry.
export type InvoiceResponseView = SharedInvoiceResponse & {
  episodeId?: string | null;
  claimType?: ClaimType;
  // Dollar variants emitted by some legacy endpoints (the canonical
  // ones use *Cents). Treat both as optional.
  subtotal?: number;
  gstTotal?: number;
  total?: number;
  amountPaid?: number;
  balance?: number;
  // Display-only metadata
  patientName?: string;
  payments?: SharedPaymentResponse[];
  claims?: ClaimResponse[];
};

export const RecordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum([
    'cash', 'card', 'eft', 'cheque', 'bpay', 'online', 'medicare_rebate', 'other',
  ]),
  reference: z.string().optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});
export type RecordPaymentDTO = z.infer<typeof RecordPaymentSchema>;

export const SubmitClaimSchema = z.object({
  invoiceId: z.string().uuid(),
  claimType: ClaimTypeSchema,
  notes: z.string().optional(),
});
export type SubmitClaimDTO = z.infer<typeof SubmitClaimSchema>;

