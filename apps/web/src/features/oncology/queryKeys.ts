// apps/web/src/features/oncology/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for oncology (CLAUDE.md §4.1).
export const oncologyKeys = {
  all: ['oncology'] as const,
  conditions: (patientId: string) => [...oncologyKeys.all, 'conditions', patientId] as const,
  tnm: (conditionId: string) => [...oncologyKeys.all, 'tnm', conditionId] as const,
  ecog: (patientId: string) => [...oncologyKeys.all, 'ecog', patientId] as const,
  plans: (conditionId: string) => [...oncologyKeys.all, 'plans', conditionId] as const,
  cycles: (planId: string) => [...oncologyKeys.all, 'cycles', planId] as const,
  decisions: (conditionId: string) => [...oncologyKeys.all, 'decisions', conditionId] as const,
} as const;
