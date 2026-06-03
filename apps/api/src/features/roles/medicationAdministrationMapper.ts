// apps/api/src/features/roles/medicationAdministrationMapper.ts
//
// BUG-622 — backend response-mapper for the `/medication-administrations`
// surface per CLAUDE.md §5.2. Sibling architectural class to BUG-618
// (clozapine), BUG-613 (side-effect-schedules). This mapper is the
// boundary between snake_case DB rows and the canonical camelCase wire
// shape consumed by MarChartPanel.tsx.

import { ZodError } from 'zod';
import {
  AppError,
  MedicationAdministrationResponseSchema,
  type MedicationAdministrationResponse,
} from '@signacare/shared';

export interface MedicationAdministrationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  // BUG-626 — DB enforces NOT NULL post-migration (Layer C defence-in-depth).
  patient_medication_id: string;
  scheduled_time: Date | string | null;
  status: string;
  administered_time: Date | string | null;
  administered_by_staff_id: string | null;
  dose_given: string | null;
  route: string | null;
  site: string | null;
  notes: string | null;
  reason_not_given: string | null;
  witnessed_by_staff_id: string | null;
  batch_number: string | null;
  administration_context: string | null;
  prn_reason: string | null;
  created_at: Date | string;
  // BUG-PR-R1-12-FIX-S0-medication_administrations — opt-locking version
  // (default 1; monotonic). Future UPDATE paths MUST route through
  // updateWithOptimisticLock per CLAUDE.md §1.6.
  lock_version: number;
}

function dateToIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return v.toISOString();
}

export function mapMedicationAdministrationRowToResponse(
  r: MedicationAdministrationRow,
): MedicationAdministrationResponse {
  const candidate = {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    patientMedicationId: r.patient_medication_id,
    scheduledTime: dateToIso(r.scheduled_time),
    status: r.status,
    administeredTime: dateToIso(r.administered_time),
    administeredByStaffId: r.administered_by_staff_id ?? null,
    doseGiven: r.dose_given ?? null,
    route: r.route ?? null,
    site: r.site ?? null,
    notes: r.notes ?? null,
    reasonNotGiven: r.reason_not_given ?? null,
    witnessedByStaffId: r.witnessed_by_staff_id ?? null,
    batchNumber: r.batch_number ?? null,
    administrationContext: r.administration_context ?? null,
    prnReason: r.prn_reason ?? null,
    createdAt: dateToIso(r.created_at) ?? '',
    // BUG-PR-R1-12-FIX-S0-medication_administrations — surface
    // lock_version so future UPDATE callers echo back as expectedLockVersion.
    lockVersion: r.lock_version,
  };
  try {
    return MedicationAdministrationResponseSchema.parse(candidate);
  } catch (err) {
    const message = err instanceof ZodError
      ? `medication-administration response-shape drift: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      : `medication-administration response-shape drift on row ${r.id}`;
    throw new AppError(message, 500, 'RESPONSE_SHAPE_ERROR');
  }
}
