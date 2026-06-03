// apps/web/src/features/paediatrics/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factories for paediatrics (CLAUDE.md §4.1).
export const paediatricsKeys = {
  all: ['paediatrics'] as const,
  milestones: (patientId: string) => ['paediatrics', 'milestones', patientId] as const,
  growth: (patientId: string) => ['paediatrics', 'growth', patientId] as const,
  immunizations: (patientId: string) => ['paediatrics', 'immunizations', patientId] as const,
} as const;

// Back-compat aliases — existing tab files import these names.
export const milestoneKeys = {
  list: paediatricsKeys.milestones,
};
export const growthKeys = {
  list: paediatricsKeys.growth,
};
export const immKeys = {
  list: paediatricsKeys.immunizations,
};
