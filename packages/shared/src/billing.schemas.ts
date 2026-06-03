import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────

export const BillingTypeEnum = z.enum(['private', 'bulk_bill', 'dva', 'ndis', 'workers_comp']);
export type BillingType = z.infer<typeof BillingTypeEnum>;

export const DvaCardTypeEnum = z.enum(['gold', 'white', 'orange']);

export const InvoiceStatusEnum = z.enum([
  'draft', 'pending_approval', 'approved', 'sent',
  'unpaid', 'paid', 'partially_paid', 'overdue',
  'void', 'cancelled', 'written_off', 'refunded',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

export const PaymentMethodEnum = z.enum([
  'cash', 'card', 'eftpos', 'bank_transfer',
  'medicare', 'dva', 'ndis', 'other',
]);

export const ClaimStatusEnum = z.enum([
  'not_submitted', 'pending', 'processing',
  'approved', 'rejected', 'partial', 'paid',
]);

export const ReferralTypeEnum = z.enum(['gp', 'specialist']);

export const FeeScheduleCategoryEnum = z.enum([
  'psychiatry_initial', 'psychiatry_subsequent',
  'telehealth_phone', 'telehealth_video',
  'group_therapy', 'ect', 'case_conference', 'other',
]);

export const FeeScheduleModalityEnum = z.enum(['in_rooms', 'phone', 'video', 'group']);

// ── Billing Accounts ──────────────────────────────────────────────────────

export const BillingAccountCreateSchema = z.object({
  patientId: z.string().uuid(),
  billingType: BillingTypeEnum,
  healthFundName: z.string().optional(),
  healthFundMemberNumber: z.string().optional(),
  ndisNumber: z.string().optional(),
  ndisPackageManager: z.string().optional(),
  dvaNumber: z.string().optional(),
  dvaCardType: DvaCardTypeEnum.optional(),
  notes: z.string().optional(),
});
export type BillingAccountCreateDTO = z.infer<typeof BillingAccountCreateSchema>;

export interface BillingAccountResponse {
  id: string;
  clinicId: string;
  patientId: string;
  billingType: string;
  healthFundName?: string;
  healthFundMemberNumber?: string;
  ndisNumber?: string;
  ndisPackageManager?: string;
  dvaNumber?: string;
  dvaCardType?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Fee Schedules ─────────────────────────────────────────────────────────

export const FeeScheduleCreateSchema = z.object({
  itemNumber: z.string().min(1).max(20),
  description: z.string().min(1).max(500),
  scheduleFeeCents: z.number().int().nonnegative(),
  category: FeeScheduleCategoryEnum,
  modality: FeeScheduleModalityEnum.optional(),
  minDurationMins: z.number().int().nonnegative().optional(),
  maxDurationMins: z.number().int().nonnegative().optional(),
  isInitial: z.boolean().default(false),
  isActive: z.boolean().default(true),
  source: z.enum(['mbs', 'dva', 'ndis', 'custom']).default('mbs'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortOrder: z.number().int().default(0),
});
export type FeeScheduleCreateDTO = z.infer<typeof FeeScheduleCreateSchema>;

export const FeeScheduleUpdateSchema = FeeScheduleCreateSchema.partial();
export type FeeScheduleUpdateDTO = z.infer<typeof FeeScheduleUpdateSchema>;

export interface FeeScheduleResponse {
  id: string;
  clinicId: string;
  itemNumber: string;
  description: string;
  scheduleFeeCents: number;
  category: string;
  modality: string | null;
  minDurationMins: number | null;
  maxDurationMins: number | null;
  isInitial: boolean;
  isActive: boolean;
  source: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Clinician Fee Overrides ───────────────────────────────────────────────

export const ClinicianFeeUpsertSchema = z.object({
  itemNumber: z.string().min(1).max(20),
  providerFeeCents: z.number().int().nonnegative(),
  bulkBillEligible: z.boolean().default(false),
  notes: z.string().optional(),
});
export type ClinicianFeeUpsertDTO = z.infer<typeof ClinicianFeeUpsertSchema>;

export interface ClinicianFeeResponse {
  id: string;
  clinicId: string;
  staffId: string;
  itemNumber: string;
  providerFeeCents: number;
  gapCents: number;
  scheduleFeeCents: number;
  bulkBillEligible: boolean;
  notes: string | null;
  isActive: boolean;
}

// ── Invoices ──────────────────────────────────────────────────────────────

const InvoiceLineItemSchema = z.object({
  mbsItemNumber: z.string().optional(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().optional(),
  scheduleFeeCents: z.number().int().nonnegative().optional(),
});

export const InvoiceCreateSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  billingType: BillingTypeEnum,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().nullable().optional(),
  lineItems: z.array(InvoiceLineItemSchema).min(1),
});
export type InvoiceCreateDTO = z.infer<typeof InvoiceCreateSchema>;

export const InvoiceApproveSchema = z.object({
  overrideItemNumber: z.string().optional(),
  overrideFeeCents: z.number().int().nonnegative().optional(),
  overrideNotes: z.string().optional(),
});
export type InvoiceApproveDTO = z.infer<typeof InvoiceApproveSchema>;

export interface InvoiceLineItemResponse {
  id: string;
  invoiceId: string;
  mbsItemNumber?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  lineTotalCents: number;
  scheduleFeeCents: number;
}

export interface InvoiceResponse {
  id: string;
  clinicId: string;
  patientId: string;
  clinicianId: string | null;
  appointmentId: string | null;
  invoiceNumber: string;
  billingType: string;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  paidCents: number;
  gapCents: number;
  scheduleFeeCents: number;
  rebateCents: number;
  providerFeeCents: number;
  status: string;
  dueDate: string | null;
  notes: string | null;
  autoGenerated: boolean;
  overrideNotes: string | null;
  referralValid: boolean;
  approvedAt: string | null;
  approvedByStaffId: string | null;
  sentAt: string | null;
  lineItems: InvoiceLineItemResponse[];
  createdAt: string;
  updatedAt: string;
}

// ── Payments ──────────────────────────────────────────────────────────────

export const PaymentCreateSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().int().positive(),
  paymentMethod: PaymentMethodEnum,
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});
export type PaymentCreateDTO = z.infer<typeof PaymentCreateSchema>;

export interface PaymentResponse {
  id: string;
  clinicId: string;
  invoiceId: string;
  receivedById: string | null;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber?: string;
  claimStatus: string | null;
  claimReference: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const ClaimUpdateSchema = z.object({
  claimStatus: ClaimStatusEnum,
  claimReference: z.string().optional(),
  notes: z.string().optional(),
});
export type ClaimUpdateDTO = z.infer<typeof ClaimUpdateSchema>;

// ── Referral Validity ─────────────────────────────────────────────────────

export const ReferralValidityCreateSchema = z.object({
  patientId: z.string().uuid(),
  referringProviderName: z.string().min(1).max(200),
  referringProviderNumber: z.string().max(30).optional(),
  referralType: ReferralTypeEnum,
  referralDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});
export type ReferralValidityCreateDTO = z.infer<typeof ReferralValidityCreateSchema>;

export interface ReferralValidityResponse {
  id: string;
  clinicId: string;
  patientId: string;
  referringProviderName: string;
  referringProviderNumber: string | null;
  referralType: string;
  referralDate: string;
  expiryDate: string;
  isActive: boolean;
  daysRemaining: number;
  isExpired: boolean;
  notes: string | null;
}

// ── MBS Item Suggestion ───────────────────────────────────────────────────

export interface MbsSuggestion {
  itemNumber: string;
  description: string;
  scheduleFeeCents: number;
  providerFeeCents: number;
  gapCents: number;
  rebateCents: number;
  reason: string;
}
