// apps/web/src/features/risk-allergies/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factories for the risk + allergies
// feature. Single source of truth for cache keys so mutation invalidations
// always match the corresponding queries (CLAUDE.md §4.1).

export const riskKeys = {
  all: ['risk'] as const,
  patient: (patientId: string) => [...riskKeys.all, patientId] as const,
  list: (patientId: string, episodeId?: string) =>
    [...riskKeys.all, patientId, episodeId ?? null] as const,
  detail: (patientId: string, id: string) =>
    [...riskKeys.all, patientId, 'detail', id] as const,
  templates: () => [...riskKeys.all, 'templates'] as const,
  template: (id: string) => [...riskKeys.all, 'templates', id] as const,
} as const;

export const allergiesKeys = {
  all: ['allergies'] as const,
  patient: (patientId: string) => [...allergiesKeys.all, patientId] as const,
  list: (patientId: string, active?: boolean) =>
    [...allergiesKeys.all, patientId, active ?? 'all'] as const,
  check: (patientId: string, drugName: string) =>
    [...allergiesKeys.all, patientId, 'check', drugName] as const,
} as const;
