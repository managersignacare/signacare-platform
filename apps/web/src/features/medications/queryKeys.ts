// apps/web/src/features/medications/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the medications
// feature (covers both patient medication records and prescription
// records, which share a feature directory).
//
// CLAUDE.md §4.1: mutation invalidation keys must exactly match query
// keys. Fix-registry row QK1 pins the canonical medications query
// shape to `['medications', patientId]`, and the MedicationsTab
// displays both medications and prescriptions on the same screen, so
// any per-patient medication change must also drop the prescriptions
// cache for that patient. Use `medicationsPatientScopeKeys` from
// mutation onSuccess handlers that mutate patient-scoped data to keep
// both surfaces in sync.

const MEDICATIONS_ROOT = 'medications';
const PRESCRIPTIONS_ROOT = 'prescriptions';

export const medicationKeys = {
  all: [MEDICATIONS_ROOT] as const,
  byPatient: (patientId: string) => [MEDICATIONS_ROOT, patientId] as const,
  byPatientEpisode: (patientId: string, episodeId: string | undefined) =>
    [MEDICATIONS_ROOT, patientId, episodeId ?? 'all'] as const,
  detail: (id: string) => [MEDICATIONS_ROOT, id] as const,
} as const;

export const prescriptionKeys = {
  all: [PRESCRIPTIONS_ROOT] as const,
  byPatient: (patientId: string) => [PRESCRIPTIONS_ROOT, patientId] as const,
} as const;

/**
 * Every per-patient medication mutation must invalidate BOTH the
 * medications list and the prescriptions list for that patient —
 * otherwise a patient who has a new medication prescribed (or a
 * prescription added/cancelled) will see a stale list on the other
 * surface. Callers do:
 *
 *   onSuccess: () => {
 *     medicationsPatientScopeKeys(patientId).forEach((key) =>
 *       qc.invalidateQueries({ queryKey: key }),
 *     );
 *   }
 */
export const medicationsPatientScopeKeys = (patientId: string) =>
  [medicationKeys.byPatient(patientId), prescriptionKeys.byPatient(patientId)] as const;
