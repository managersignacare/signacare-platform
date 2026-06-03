// apps/web/src/features/clinical-notes/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for clinical notes.
// Single source of truth so mutation invalidations always match their
// queries (CLAUDE.md §4.1).
export const clinicalNotesKeys = {
  all: ['clinical-notes'] as const,
  patient: (patientId: string, episodeId?: string | null) =>
    [...clinicalNotesKeys.all, 'patient', patientId, episodeId ?? null] as const,
  patientAll: (patientId: string) =>
    [...clinicalNotesKeys.all, 'patient', patientId] as const,
  detail: (id: string) => [...clinicalNotesKeys.all, id] as const,
} as const;
