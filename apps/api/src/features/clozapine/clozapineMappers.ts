// apps/api/src/features/clozapine/clozapineMappers.ts
//
// BUG-618 — backend clozapine response-mapper consolidation per
// CLAUDE.md §5.2 ("Backend must map snake_case DB columns to camelCase
// response fields. Never pass raw Knex rows directly to response emitters.").
//
// Pre-fix all 6 clozapine controllers emitted raw row payloads
// Knex rows (snake_case) → frontend ClozapinePanel.tsx had to use
// defensive `?? snake_case` dual-shape access throughout, hiding 16+
// `<any>` typings (BUG-606) and read-rail silent-coalescing (BUG-617).
// Sibling architectural class to BUG-613 (side-effect-schedules
// endpoint, same violation, separate cycle).
//
// Each mapper:
//   - Renames snake_case row columns to camelCase response fields.
//   - Coerces `Date` columns to ISO-8601 strings via `dateToIso`.
//   - Validates the output against the canonical Zod schema from
//     `@signacare/shared/clozapine.schemas.ts`.
//   - Wraps validation errors in AppError(500, 'RESPONSE_SHAPE_ERROR')
//     so emit-time parse failures surface as 500 (server-side data
//     issue), NOT 422 (which is reserved for request-validation).
//
// Closes BUG-606 (any typings drained naturally once shape is canonical)
// + BUG-617 (read-rail silent-coalescing addressed in same campaign).

import { AppError } from '@signacare/shared';
import {
  ClozapineRegistrationResponseSchema,
  ClozapineBloodResultResponseSchema,
  ClozapineTitrationDayResponseSchema,
  ClozapineAdministrationResponseSchema,
  ClozapineObservationResponseSchema,
  ClozapineMonitoringCheckResponseSchema,
  type ClozapineRegistrationResponse,
  type ClozapineBloodResultResponse,
  type ClozapineTitrationDayResponse,
  type ClozapineAdministrationResponse,
  type ClozapineObservationResponse,
  type ClozapineMonitoringCheckResponse,
} from '@signacare/shared';
import type {
  ClozapineRegistrationRow,
  ClozapineBloodResultRow,
  ClozapineTitrationDayRow,
  ClozapineAdministrationRow,
  ClozapineObservationRow,
  ClozapineMonitoringCheckRow,
} from './clozapineRepository';
import { ZodError } from 'zod';

// Knex returns native `Date` objects for date / timestamp columns; the
// SSoT response schemas declare these as `z.string()` so direct emission
// would 422 on parse. Coerce to ISO-8601 here (mirrors `medicationService`
// pattern at apps/api/src/features/medications/medicationService.ts:34).
function dateToIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return v.toISOString();
}

function raiseShapeError(entity: string, id: string | undefined, err: unknown): never {
  const message = err instanceof ZodError
    ? `clozapine ${entity} response-shape drift: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    : `clozapine ${entity} response-shape drift on row ${id ?? '<unknown>'}`;
  throw new AppError(message, 500, 'RESPONSE_SHAPE_ERROR');
}

// ── Registration ─────────────────────────────────────────────────────
export function mapClozapineRegistrationRowToResponse(
  r: ClozapineRegistrationRow,
): ClozapineRegistrationResponse {
  const candidate = {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    episodeId: r.episode_id ?? null,
    drugProductId: r.drug_product_id ?? null,
    prescriberStaffId: r.prescriber_staff_id ?? null,
    registrationDate: dateToIso(r.registration_date as unknown as Date | string) ?? r.registration_date,
    dispenserPharmacy: r.dispenser_pharmacy ?? null,
    currentDoseMg: r.current_dose_mg ?? null,
    titrationPhase: r.titration_phase,
    monitoringWeek: r.monitoring_week ?? null,
    monitoringFrequency: r.monitoring_frequency,
    lastAncDate: dateToIso(r.last_anc_date as unknown as Date | string | null),
    lastAncValue: r.last_anc_value ?? null,
    ancStatus: r.anc_status,
    lastWbcDate: dateToIso(r.last_wbc_date as unknown as Date | string | null),
    lastWbcValue: r.last_wbc_value ?? null,
    nextBloodDueDate: dateToIso(r.next_blood_due_date as unknown as Date | string | null),
    physicalHealthCheckDue: dateToIso(r.physical_health_check_due as unknown as Date | string | null),
    ceasedDate: dateToIso(r.ceased_date as unknown as Date | string | null),
    ceasedReason: r.ceased_reason ?? null,
    notes: r.notes ?? null,
    createdAt: dateToIso(r.created_at as unknown as Date | string) ?? r.created_at,
    updatedAt: dateToIso(r.updated_at as unknown as Date | string) ?? r.updated_at,
  };
  try {
    return ClozapineRegistrationResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('registration', r.id, err);
  }
}

// ── Blood Result ─────────────────────────────────────────────────────
export function mapClozapineBloodResultRowToResponse(
  r: ClozapineBloodResultRow,
): ClozapineBloodResultResponse {
  const candidate = {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    registrationId: r.registration_id,
    recordedByStaffId: r.recorded_by_staff_id,
    collectionDate: dateToIso(r.collection_date as unknown as Date | string) ?? r.collection_date,
    resultedDate: dateToIso(r.resulted_date as unknown as Date | string | null),
    ancValue: r.anc_value ?? null,
    wbcValue: r.wbc_value ?? null,
    neutrophilsPct: r.neutrophils_pct ?? null,
    ancStatus: r.anc_status,
    flagRaised: r.flag_raised,
    flagType: r.flag_type ?? null,
    labName: r.lab_name ?? null,
    labReference: r.lab_reference ?? null,
    clinicalNotes: r.clinical_notes ?? null,
    createdAt: dateToIso(r.created_at as unknown as Date | string) ?? r.created_at,
  };
  try {
    return ClozapineBloodResultResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('blood result', r.id, err);
  }
}

// ── Titration Day ────────────────────────────────────────────────────
export function mapClozapineTitrationDayRowToResponse(
  r: ClozapineTitrationDayRow,
): ClozapineTitrationDayResponse {
  const candidate = {
    id: r.id,
    registrationId: r.registration_id,
    dayNumber: r.day_number,
    titrationDate: dateToIso(r.titration_date as unknown as Date | string) ?? r.titration_date,
    morningDoseMg: r.morning_dose_mg ?? null,
    eveningDoseMg: r.evening_dose_mg ?? null,
    prescriberInitials: r.prescriber_initials ?? null,
    prescribedByStaffId: r.prescribed_by_staff_id,
    comments: r.comments ?? null,
  };
  try {
    return ClozapineTitrationDayResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('titration day', r.id, err);
  }
}

// ── Administration ───────────────────────────────────────────────────
export function mapClozapineAdministrationRowToResponse(
  r: ClozapineAdministrationRow,
): ClozapineAdministrationResponse {
  // timeSlot is z.enum(['morning', 'evening']) on the response schema;
  // the row's `time_slot` is a plain string. The Zod parse will throw
  // RESPONSE_SHAPE_ERROR if a row has an unexpected value (data drift).
  const candidate = {
    id: r.id,
    registrationId: r.registration_id,
    titrationDayId: r.titration_day_id ?? null,
    administrationDate: dateToIso(r.administration_date as unknown as Date | string) ?? r.administration_date,
    timeSlot: r.time_slot,
    actualTime: r.actual_time ?? null,
    doseMg: r.dose_mg,
    administered: r.administered,
    nonAdminCode: r.non_admin_code ?? null,
    administeredByStaffId: r.administered_by_staff_id,
    administratorInitials: r.administrator_initials ?? null,
    notes: r.notes ?? null,
    createdAt: dateToIso(r.created_at) ?? '',
  };
  try {
    return ClozapineAdministrationResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('administration', r.id, err);
  }
}

// ── Observation ──────────────────────────────────────────────────────
export function mapClozapineObservationRowToResponse(
  r: ClozapineObservationRow,
): ClozapineObservationResponse {
  const candidate = {
    id: r.id,
    registrationId: r.registration_id,
    observationDate: dateToIso(r.observation_date as unknown as Date | string) ?? r.observation_date,
    observationTime: r.observation_time ?? null,
    temperature: r.temperature ?? null,
    pulse: r.pulse ?? null,
    bpSystolicLying: r.bp_systolic_lying ?? null,
    bpDiastolicLying: r.bp_diastolic_lying ?? null,
    bpSystolicStanding: r.bp_systolic_standing ?? null,
    bpDiastolicStanding: r.bp_diastolic_standing ?? null,
    respirationRate: r.respiration_rate ?? null,
    smokingStatus: r.smoking_status ?? null,
    cigarettesPerDay: r.cigarettes_per_day ?? null,
    outsideNormal: r.outside_normal,
    notes: r.notes ?? null,
    recordedByStaffId: r.recorded_by_staff_id ?? null,
    createdAt: dateToIso(r.created_at) ?? '',
  };
  try {
    return ClozapineObservationResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('observation', r.id, err);
  }
}

// ── Monitoring Check ─────────────────────────────────────────────────
export function mapClozapineMonitoringCheckRowToResponse(
  r: ClozapineMonitoringCheckRow,
): ClozapineMonitoringCheckResponse {
  const candidate = {
    id: r.id,
    registrationId: r.registration_id,
    investigation: r.investigation,
    checkPoint: r.check_point,
    checkDate: dateToIso(r.check_date as unknown as Date | string | null),
    resultStatus: r.result_status ?? null,
    resultValue: r.result_value ?? null,
    notes: r.notes ?? null,
    recordedByStaffId: r.recorded_by_staff_id ?? null,
    createdAt: dateToIso(r.created_at) ?? '',
  };
  try {
    return ClozapineMonitoringCheckResponseSchema.parse(candidate);
  } catch (err) {
    raiseShapeError('monitoring check', r.id, err);
  }
}
