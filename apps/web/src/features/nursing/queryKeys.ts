// apps/web/src/features/nursing/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for nursing (CLAUDE.md §4.1).
export const nursingKeys = {
  all: ['nursing'] as const,
  patients: () => ['nursing-patients'] as const,
  marChart: (patientId: string) => ['mar-chart', patientId] as const,
  observations: (patientId: string) => ['observations', patientId] as const,
  handoverUpdates: (shiftType: string) => ['handover-updates', shiftType] as const,
  phoneTriage: (status?: string) => ['nursing-phone-triage', status ?? 'open'] as const,
} as const;
