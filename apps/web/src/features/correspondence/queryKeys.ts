// apps/web/src/features/correspondence/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the correspondence
// feature. Single source of truth so mutation invalidations always match
// the corresponding queries (CLAUDE.md §4.1).
//
// Cross-feature namespace note: `clinicalNotesContent` and
// `patientNotesForLetter` preserve literal cross-feature namespaces
// (`clinical-notes`, `patient-notes-for-letter`) that are owned by other
// surfaces — do NOT import another feature's factory, just mirror the
// literal here so invalidations line up.

export interface LettersListFilters {
  patientId?: string;
  episodeId?: string;
  status?: string;
}

export const correspondenceKeys = {
  all: ['correspondence'] as const,
  letters: () => [...correspondenceKeys.all, 'letters'] as const,
  lettersList: (filters: LettersListFilters) =>
    [...correspondenceKeys.all, 'letters', filters] as const,
  letter: (id: string) => [...correspondenceKeys.all, 'letter', id] as const,
  templates: () => [...correspondenceKeys.all, 'templates'] as const,

  // Cross-feature literals (not owned by correspondence — preserve prefix).
  clinicalNotesContent: (noteId: string | undefined) =>
    ['clinical-notes', 'content', noteId] as const,
  patientNotesForLetter: (patientId: string, episodeId?: string) =>
    ['patient-notes-for-letter', patientId, episodeId ?? null] as const,
} as const;
