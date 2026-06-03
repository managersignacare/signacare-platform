// apps/web/src/features/patient-outreach/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for patient outreach (CLAUDE.md §4.1).
export const patientOutreachKeys = {
  all: ['patient-outreach'] as const,
  delivery: (patientId: string) => ['patient-outreach', 'delivery-profile', patientId] as const,
  logs: (patientId: string) => ['patient-outreach', 'logs', patientId] as const,
} as const;

// Back-compat alias — existing panel imports this name.
export const profileKeys = {
  delivery: patientOutreachKeys.delivery,
  logs: patientOutreachKeys.logs,
};
