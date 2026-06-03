// apps/web/src/features/pathology/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for pathology (CLAUDE.md §4.1).
export const pathologyKeys = {
  all: ['pathology'] as const,
  orders: (patientId: string) =>
    [...pathologyKeys.all, 'orders', patientId] as const,
  order: (id: string) => [...pathologyKeys.all, 'order', id] as const,
  results: (patientId: string) =>
    [...pathologyKeys.all, 'results', patientId] as const,
} as const;
