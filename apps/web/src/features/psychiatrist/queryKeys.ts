// apps/web/src/features/psychiatrist/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for psychiatrist (CLAUDE.md §4.1).
//
// Note: "psychiatrist-patients" is intentionally namespaced distinctly from
// the shared "patients" root so that filters applied here (mine: true) do not
// collide with the general patient directory cache.
export const psychiatristKeys = {
  all: ['psychiatrist'] as const,
  clinicToday: (date: string) =>
    ['psychiatrist-clinic', date] as const,
  patients: () => ['psychiatrist-patients'] as const,
  formulations: (patientId: string) =>
    ['formulations', patientId] as const,
  sideEffects: (patientId: string) =>
    ['side-effects', patientId] as const,
} as const;
