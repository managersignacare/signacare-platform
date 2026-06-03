// apps/web/src/features/billing/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the billing feature.
// Single source of truth so mutation invalidations always match their queries
// (CLAUDE.md §4.1).
export const billingKeys = {
  all: ['billing'] as const,
  invoices: (params: { patientId?: string; status?: string; billingType?: string }) =>
    [...billingKeys.all, 'invoices', params] as const,
  invoice: (id: string) => [...billingKeys.all, 'invoice', id] as const,
  claims: () => [...billingKeys.all, 'claims'] as const,

  // Legacy panel-specific keys (kept as literal prefixes so we don't break
  // the existing cache layout that PatientBillingTab + ClinicianFeePanel +
  // FeeSchedulePanel all rely on).
  account: (patientId: string) => ['billing-account', patientId] as const,
  referral: (patientId: string) => ['billing-referral', patientId] as const,
  patientInvoices: (patientId: string) => ['billing-invoices', patientId] as const,

  staffClinicians: () => ['staff-clinicians-billing'] as const,
  clinicianFees: (staffId: string) => ['clinician-fees', staffId] as const,

  feeSchedules: () => ['fee-schedules'] as const,
} as const;
