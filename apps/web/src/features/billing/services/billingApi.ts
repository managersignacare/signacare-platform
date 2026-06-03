import { apiClient } from '../../../shared/services/apiClient';
import type {
  InvoiceCreateDTO,
  InvoiceResponse,
  InvoiceApproveDTO,
  PaymentCreateDTO,
  PaymentResponse,
  ClaimUpdateDTO,
  FeeScheduleCreateDTO,
  FeeScheduleUpdateDTO,
  FeeScheduleResponse,
  ClinicianFeeUpsertDTO,
  ClinicianFeeResponse,
  ReferralValidityCreateDTO,
  ReferralValidityResponse,
  MbsSuggestion,
  BillingAccountCreateDTO,
  BillingAccountResponse,
} from '@signacare/shared';

export const billingApi = {
  // ── Invoices ──────────────────────────────────────────────────────────
  listInvoices: async (params?: { patientId?: string; status?: string; billingType?: string }) =>
    apiClient.get<{ data: InvoiceResponse[] }>('billing', { params }),

  listInvoicesByPatient: async (patientId: string) =>
    apiClient.get<InvoiceResponse[]>(`billing/invoices/patient/${patientId}`),

  getInvoice: async (id: string) =>
    apiClient.get<InvoiceResponse>(`billing/invoices/${id}`),

  createInvoice: async (dto: InvoiceCreateDTO) =>
    apiClient.post<InvoiceResponse>('billing/invoices', dto),

  approveInvoice: async (id: string, dto: InvoiceApproveDTO) =>
    apiClient.post<InvoiceResponse>(`billing/invoices/${id}/approve`, dto),

  sendInvoice: async (id: string) =>
    apiClient.post<{ ok: boolean }>(`billing/invoices/${id}/send`),

  voidInvoice: async (id: string) =>
    apiClient.delete(`billing/invoices/${id}`),

  // ── Payments ──────────────────────────────────────────────────────────
  recordPayment: async (dto: PaymentCreateDTO) =>
    apiClient.post<PaymentResponse>('billing/payments', dto),

  listPayments: async (invoiceId: string) =>
    apiClient.get<PaymentResponse[]>(`billing/invoices/${invoiceId}/payments`),

  updateClaim: async (paymentId: string, dto: ClaimUpdateDTO) =>
    apiClient.patch(`billing/payments/${paymentId}/claim`, dto),

  // ── Billing Accounts ──────────────────────────────────────────────────
  upsertAccount: async (dto: BillingAccountCreateDTO) =>
    apiClient.put<BillingAccountResponse>('billing/accounts', dto),

  getAccount: async (patientId: string) =>
    apiClient.get<BillingAccountResponse | null>(`billing/accounts/patient/${patientId}`),

  // ── Fee Schedules ─────────────────────────────────────────────────────
  listFeeSchedules: async (filters?: { category?: string; isActive?: string; source?: string }) =>
    apiClient.get<{ items: FeeScheduleResponse[] }>('billing/fee-schedules', { params: filters }),

  createFeeSchedule: async (dto: FeeScheduleCreateDTO) =>
    apiClient.post<FeeScheduleResponse>('billing/fee-schedules', dto),

  updateFeeSchedule: async (id: string, dto: FeeScheduleUpdateDTO) =>
    apiClient.put<FeeScheduleResponse>(`billing/fee-schedules/${id}`, dto),

  deactivateFeeSchedule: async (id: string) =>
    apiClient.delete(`billing/fee-schedules/${id}`),

  seedMbsItems: async () =>
    apiClient.post<{ ok: boolean; inserted: number }>('billing/fee-schedules/seed'),

  // ── Clinician Fee Overrides ───────────────────────────────────────────
  listClinicianFees: async (staffId: string) =>
    apiClient.get<{ items: ClinicianFeeResponse[] }>(`billing/clinician-fees/${staffId}`),

  upsertClinicianFee: async (staffId: string, itemNumber: string, dto: ClinicianFeeUpsertDTO) =>
    apiClient.put<ClinicianFeeResponse>(`billing/clinician-fees/${staffId}/${itemNumber}`, dto),

  removeClinicianFee: async (staffId: string, itemNumber: string) =>
    apiClient.delete(`billing/clinician-fees/${staffId}/${itemNumber}`),

  applyUniformGap: async (staffId: string, gapCents: number) =>
    apiClient.post(`billing/clinician-fees/${staffId}/apply-uniform-gap`, { gapCents }),

  // ── Referral Validity ─────────────────────────────────────────────────
  getActiveReferral: async (patientId: string) =>
    apiClient.get<{ referral: ReferralValidityResponse | null }>(`billing/referrals/${patientId}`),

  listReferralHistory: async (patientId: string) =>
    apiClient.get<{ items: ReferralValidityResponse[] }>(`billing/referrals/${patientId}/history`),

  createReferral: async (dto: ReferralValidityCreateDTO) =>
    apiClient.post<ReferralValidityResponse>('billing/referrals', dto),

  listExpiringReferrals: async (days?: number) =>
    apiClient.get<{ items: ReferralValidityResponse[] }>('billing/referrals-expiring', { params: { days } }),

  // ── MBS Suggestion ────────────────────────────────────────────────────
  suggestMbs: async (appointmentId: string) =>
    apiClient.post<{ suggestion: MbsSuggestion | null }>('billing/suggest-mbs', { appointmentId }),
};
