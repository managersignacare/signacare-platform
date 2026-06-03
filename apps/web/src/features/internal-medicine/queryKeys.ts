// apps/web/src/features/internal-medicine/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the internal
// medicine feature. Single source of truth so mutation invalidations
// always match the corresponding queries (CLAUDE.md §4.1).
//
// Cross-feature namespace note: `medicationsActiveForMedRec` preserves
// the `medications` namespace literal (owned by the medications feature)
// — do NOT import another feature's factory, just mirror the literal
// prefix so invalidations from either side line up.

export const internalMedicineKeys = {
  // Problem list + chronic disease register share the `problem-list` prefix.
  problemListAll: ['problem-list'] as const,
  problemList: (patientId: string) => ['problem-list', patientId] as const,
  problemListFiltered: (
    patientId: string,
    filters: { activeOnly?: boolean } = {},
  ) => ['problem-list', patientId, filters] as const,
  problemListChronic: (patientId: string) =>
    ['problem-list', patientId, { isChronic: true }] as const,

  // Medication reconciliation.
  medRecAll: ['med-reconciliations'] as const,
  medRecList: (patientId: string) =>
    ['med-reconciliations', patientId] as const,

  // Cross-feature literal — active medications used by the med-rec wizard.
  medicationsActiveForMedRec: (patientId: string) =>
    ['medications', patientId, 'active-for-medrec'] as const,
} as const;
