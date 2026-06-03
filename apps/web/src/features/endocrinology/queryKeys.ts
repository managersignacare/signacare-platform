// apps/web/src/features/endocrinology/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factories for endocrinology (CLAUDE.md §4.1).
// Moved here from the individual tab files so the whole feature shares a
// single factory import.
export const glucoseKeys = {
  all: ['glucose'] as const,
  list: (patientId: string) => ['glucose', patientId, 'list'] as const,
  tir: (patientId: string) => ['glucose', patientId, 'tir'] as const,
} as const;

export const insulinKeys = {
  all: ['insulin-regimens'] as const,
  history: (patientId: string) => ['insulin-regimens', patientId, 'history'] as const,
  current: (patientId: string) => ['insulin-regimens', patientId, 'current'] as const,
} as const;
