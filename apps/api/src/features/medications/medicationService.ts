import { z } from 'zod';
import type { AuthContext } from '@signacare/shared';
import { MedicationResponseSchema, type MedicationResponse } from '@signacare/shared';
import { medicationRepository } from './medicationRepository';
import { writeAuditLog } from '../../utils/audit';
import { AppError } from '../../shared/errors';
import {
  requireClinicalAccessRole,
  requirePatientRelationship,
  requirePermission,
  requirePrescribingDiscipline,
  requireValidHpii,
} from '../../shared/authGuards';
import type { MedicationRow } from './medicationRepository';
import { checkContraindications } from './checkContraindications';
import { resolvePrescriberSpecialty, deriveCategoryFromLegacyFlags } from './prescriberSpecialtyResolver';
import { logger } from '../../utils/logger';

// BUG-456 — `MedicationResponse` now imported from `@signacare/shared`
// (SSoT). The previous backend-local `interface MedicationResponse`
// had drifted: 12 fields the frontend expected were missing from the
// wire (drugProductId, drugCode, brandName, instructions, startDate,
// endDate, reasonForCessation, isRegular, isPrn, taperSchedule,
// source, prescribedByStaffId, notes); 9 legacy fields were extra
// (medicationName, isClozapine, isS8, laiFrequency/NextDue/LastAdmin,
// prescribedAt, prescriber, prescribedBySpecialty, category). The
// status field was widened from a 5-value enum to plain `string`,
// which silently propagated malformed DB rows to the UI.
//
// Post-BUG-456 the mapper populates every SSoT field directly from
// `MedicationRow` and runs `MedicationResponseSchema.parse()` on the
// candidate before return. Any future drift fails LOUD at the API
// boundary instead of silently in the UI.
export type { MedicationResponse };

// BUG-456 — Knex returns native `Date` objects for date / timestamp
// columns (start_date, end_date, created_at, updated_at). The SSoT
// declares these as `z.string()` so the parse step would 422. Coerce
// to ISO-8601 strings here. `null` columns stay `null`.
function dateToIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return v.toISOString();
}

function toResponse(r: MedicationRow): MedicationResponse {
  const startDate = dateToIso(r.start_date as Date | string | null);
  const candidate = {
    id: r.id,
    // BUG-371b — propagate lock_version to client so next mutation
    // sends it back as expectedLockVersion.
    lockVersion: r.lock_version,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    episodeId: r.episode_id ?? null,
    drugProductId: r.drug_product_id ?? null,
    drugCode: r.drug_code ?? null,
    drugLabel: r.drug_label,
    // BUG-456 L4 absorb-1 — derived alias for `drugLabel`.
    medicationName: r.drug_label,
    genericName: r.generic_name ?? null,
    brandName: r.brand_name ?? null,
    dose: r.dose,
    doseUnit: r.dose_unit ?? null,
    route: r.route,
    frequency: r.frequency,
    instructions: r.instructions ?? null,
    indication: r.indication ?? null,
    startDate,
    endDate: dateToIso(r.end_date as Date | string | null),
    status: r.status,
    reasonForCessation: r.reason_for_cessation ?? null,
    isRegular: r.is_regular,
    isPrn: r.is_prn,
    isLai: r.is_lai,
    // BUG-456 L4 absorb-1 — derived clinical-safety flags from
    // `category`. Frontend depends on these for the Clozapine sub-tab
    // filter, Schedule 8 SafeScript banner, printed-prescription
    // warnings, and Clinical Review icon coloring.
    isClozapine: r.category === 'clozapine',
    isS8: r.category === 's8',
    category: r.category ?? null,
    // Derived alias for `startDate` — kept on wire because
    // `PatientDetailLayout.tsx:600` supply-low alert reads
    // `m.prescribedAt`.
    prescribedAt: startDate,
    // Always-null today; LAI scheduling lives in `lai_schedules`.
    laiFrequency: null,
    laiNextDue: null,
    laiLastAdmin: null,
    prescriber: null,
    prescribedBySpecialty: r.prescribed_by_specialty_code ?? null,
    taperSchedule: r.taper_schedule ?? null,
    // BUG-456 L4 absorb-1 — passthrough nullable; DB column is
    // string | null. Pre-absorb coalesce to 'manual' mis-attributed
    // imported / e-prescribed records with NULL source.
    source: r.source ?? null,
    prescribedByStaffId: r.prescribed_by_staff_id ?? null,
    notes: r.notes ?? null,
    // BUG-456 L4 absorb-1 — `created_at` and `updated_at` are
    // NOT NULL DEFAULT now() per CLAUDE.md §7.3. The previous
    // `?? ''` fallback masked a potential schema-violation row.
    // Throw instead so a corrupted row surfaces loud.
    createdAt:
      dateToIso(r.created_at as Date | string | null) ??
      raiseDataIntegrity('created_at', r.id),
    updatedAt:
      dateToIso(r.updated_at as Date | string | null) ??
      raiseDataIntegrity('updated_at', r.id),
  };
  // BUG-456 — fail-loud rather than silently shipping drift to the
  // frontend. Any future widening of MedicationRow that doesn't update
  // this mapper will surface as a Zod parse error.
  // BUG-456 L3+L4 absorb-1 — wrap ZodError in AppError(500,
  // 'RESPONSE_SHAPE_ERROR') so emit-time parse failures surface as
  // 500 (server-side data issue), NOT 422 (request validation
  // failure) which the global ZodError handler would otherwise emit.
  try {
    return MedicationResponseSchema.parse(candidate);
  } catch (err) {
    throw new AppError(
      'Medication response shape mismatch — server data integrity issue',
      500,
      'RESPONSE_SHAPE_ERROR',
      {
        medicationId: r.id,
        zodIssues: err instanceof z.ZodError ? err.issues : undefined,
      },
    );
  }
}

function raiseDataIntegrity(column: string, recordId: string): never {
  throw new AppError(
    `Data integrity error: patient_medications.${column} is null for row ${recordId}`,
    500,
    'DATA_INTEGRITY',
    { column, recordId },
  );
}

/**
 * BUG-456 L3 absorb-1 — list-fragility helper. Pre-absorb a single bad
 * DB row in a list response would 422 the entire patient's medication
 * list (rows.map(toResponse) throws on the first bad row). Clinically
 * equivalent to "patient has no medications", which silently hides the
 * other 49 valid rows.
 *
 * Post-absorb: per-row `safeParse` + structured pino warn on any row
 * that fails to map; bad rows are skipped, good rows ship. The
 * acknowledge path (single-resource get-by-id) keeps the strict
 * `parse()` so an individual lookup of a corrupted row fails loud.
 */
// BUG-456 absorb-2 — exported for the unit test that exercises the
// list-fragility safeguard with a hand-crafted bad MedicationRow
// (the integration test path is constrained by the DB CHECK + NOT NULL
// constraints; a unit test directly drives the helper).
export function toResponseListSafe(rows: MedicationRow[]): MedicationResponse[] {
  return _toResponseListSafe(rows);
}

function _toResponseListSafe(rows: MedicationRow[]): MedicationResponse[] {
  const out: MedicationResponse[] = [];
  for (const r of rows) {
    try {
      out.push(toResponse(r));
    } catch (err) {
      // Per-row fail-loud-but-non-blocking. Skipping a corrupt row
      // is the right trade-off here: better that a clinic sees 49 of
      // 50 medications than 0 of 50 because of a single bad status.
      // Operations gets paged via the structured warn (pino → Sentry).
      logger.warn(
        {
          medicationId: r.id,
          patientId: r.patient_id,
          clinicId: r.clinic_id,
          err: err instanceof Error ? err.message : String(err),
          kind: 'medication_response_shape_skip',
        },
        'BUG-456: medication row failed shape validation, skipped from list response',
      );
    }
  }
  return out;
}

export const medicationService = {
  async create(
    auth: AuthContext,
    dto: {
      patientId: string;
      episodeId?: string | null;
      medicationName: string;
      genericName?: string;
      dose: string;
      frequency: string;
      route?: string;
      isLai?: boolean;
      isClozapine?: boolean;
      isS8?: boolean;
      laiFrequency?: string;
      prescriber?: string;
      indication?: string;
      prescribedBySpecialty?: string | null;
      category?: string | null;
    },
  ): Promise<MedicationResponse> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:create');
    await requirePatientRelationship(auth, dto.patientId);
    // BUG-040 — AHPRA prescribing-discipline gate. Blocks psychologists
    // and other non-prescribing disciplines at the service boundary
    // before any DB write. Defence-in-depth: the DB-level trigger on
    // patient_medications also fires; both sources of truth are the
    // same SQL function `is_prescribing_eligible_discipline(text)`.
    await requirePrescribingDiscipline(auth);
    // BUG-296 / BUG-WF81-HPII-MISSING — strict prescriber HPI-I
    // gate (no warn bypass). Missing/malformed HPI-I blocks with
    // 403 PRESCRIBER_HPII_INVALID.
    await requireValidHpii(auth);
    // BUG-P3 — PRES-7 DH-3869 + DH-4155 §3 step-up. S8 (Schedule 8) chart
    // additions require fresh MFA / password challenge. "Add to chart" is
    // explicitly enumerated in DH-4155 §3 alongside add-new / modify / cease.
    if (dto.isS8) {
      const { requireRecentStepUp } = await import('../../shared/stepUpAuth');
      await requireRecentStepUp(auth);
    }
    const clinicId = auth.clinicId;
    const actorId = auth.staffId;

    // ACHS Standard 4 — run contraindication screen BEFORE the
    // repository INSERT so an unsafe order is never persisted.
    // Covers allergy cross-reactivity (incl. drug-class matrix)
    // and the clozapine baseline-ANC guard (HAZARD-002 companion).
    const finding = await checkContraindications({
      clinicId,
      patientId: dto.patientId,
      drugName: dto.medicationName,
    });
    if (finding) {
      // Audit-first: every blocked attempt produces a row so a
      // forensic review can enumerate flagged orders even if the
      // clinician later tries again with a different drug.
      await writeAuditLog({
        actorId,
        clinicId,
        action: 'CONTRAINDICATION_BLOCKED',
        tableName: 'patient_medications',
        recordId: dto.patientId,
        newData: {
          drug: dto.medicationName,
          finding: finding.code,
          details: finding.details,
        },
      }).catch(() => { /* non-blocking audit */ });
      throw new AppError(finding.message, 422, finding.code, finding.details);
    }

    // Auto-resolve the prescriber's specialty. Priority: explicit override →
    // linked episode's specialty → staff's primary enrollment → mental_health.
    // Gives clinicians a correctly tagged medication list without a manual
    // dropdown, which is essential for the cross-specialty medication page
    // and the interaction checker in Phase 9.
    const prescribedBySpecialtyCode = await resolvePrescriberSpecialty({
      clinicId,
      actorStaffId: actorId,
      episodeId: dto.episodeId ?? null,
      explicitCode: dto.prescribedBySpecialty ?? null,
    });

    const category = dto.category ?? deriveCategoryFromLegacyFlags({
      isLai: dto.isLai,
      isClozapine: dto.isClozapine,
    });

    const row = await medicationRepository.create(clinicId, {
      ...dto,
      prescribedBySpecialtyCode,
      category,
      // BUG-040 L4 absorption — persist prescriber attribution. The
      // caller (auth.staffId) is the prescriber-of-record by default;
      // the discipline gate above has already verified their AHPRA
      // eligibility. recordedBy is identical today (same actor), but
      // kept distinct in the schema for future delegation paths
      // (e.g. registrar recording on behalf of consultant).
      prescribedByStaffId: actorId,
      recordedByStaffId: actorId,
    });
    await writeAuditLog({
      actorId,
      clinicId,
      action: 'CREATE',
      tableName: 'patient_medications',
      recordId: row.id,
      newData: {
        id: row.id,
        patientId: row.patient_id,
        drug: row.drug_label,
        prescribedBySpecialty: row.prescribed_by_specialty_code,
      },
    });
    return toResponse(row);
  },

  async listByPatient(
    auth: AuthContext,
    patientId: string,
    statusFilter?: string,
  ): Promise<MedicationResponse[]> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:read');
    await requirePatientRelationship(auth, patientId);
    const rows = await medicationRepository.findByPatient(auth.clinicId, patientId, statusFilter);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'patient_medications',
      recordId: patientId,
    });
    // BUG-456 L3 absorb-1 — list endpoint uses safe mapping so a single
    // bad DB row doesn't 500 the whole patient's medication list.
    return toResponseListSafe(rows);
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<MedicationResponse> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:read');
    const row = await medicationRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('Medication not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, row.patient_id);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'patient_medications',
      recordId: id,
    });
    return toResponse(row);
  },

  async update(
    auth: AuthContext,
    id: string,
    changes: Record<string, unknown>,
    expectedLockVersion: number,
  ): Promise<MedicationResponse> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:update');
    // BUG-040 — gate on UPDATE only when the prescriber column is
    // being (re)set. A non-prescriber adjusting non-clinical fields
    // (e.g. an admin correcting a label typo) shouldn't be blocked.
    if (changes && Object.prototype.hasOwnProperty.call(changes, 'prescribedByStaffId')) {
      await requirePrescribingDiscipline(auth);
      // BUG-296 — same strict HPI-I gate as create(). Running UPDATE
      // to change prescriber attribution is equivalent to prescribing:
      // the new prescriber must have a valid HPI-I.
      await requireValidHpii(auth);
    }
    const existing = await medicationRepository.findById(id, auth.clinicId);
    if (!existing) {
      throw new AppError('Medication not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, existing.patient_id);
    // BUG-P3 — PRES-7 DH-3869 + DH-4155 §3 step-up. S8 medication MODIFY
    // requires fresh MFA / password challenge. Either the existing row is
    // already S8 OR the change attempts to set isS8=true (escalation into
    // S8 status); in both cases the gate fires. (Excludes status='ceased'
    // since BUG-554 routes cessations through the dedicated /cease path,
    // which is gated separately below.)
    const isCurrentlyS8 = existing.category === 's8';
    const willBeS8 = (changes as { isS8?: boolean })['isS8'] === true
      || (changes as { category?: string })['category'] === 's8';
    if (isCurrentlyS8 || willBeS8) {
      const { requireRecentStepUp } = await import('../../shared/stepUpAuth');
      await requireRecentStepUp(auth);
    }
    // BUG-371b — opt-locked update. expectedLockVersion comes from the
    // Zod-validated request body; helper throws AppError(409,
    // 'OPTIMISTIC_LOCK_CONFLICT') if the row's lock_version moved.
    const updated = await medicationRepository.update(id, auth.clinicId, changes, expectedLockVersion);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'patient_medications',
      recordId: id,
      oldData: { status: existing.status },
      newData: { status: updated.status },
    });
    return toResponse(updated);
  },

  async cease(
    auth: AuthContext,
    id: string,
    dto: { expectedLockVersion: number; endDate: string; reasonForCessation: string },
  ): Promise<MedicationResponse> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:update');
    const existing = await medicationRepository.findById(id, auth.clinicId);
    if (!existing) {
      throw new AppError('Medication not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, existing.patient_id);
    // BUG-P3 — PRES-7 DH-3869 + DH-4155 §3 step-up. S8 medication CEASE
    // requires fresh MFA / password challenge. Mirrors the S8 modify gate
    // above; ceasing a controlled drug is the canonical "modify" example
    // for DH-4155.
    if (existing.category === 's8') {
      const { requireRecentStepUp } = await import('../../shared/stepUpAuth');
      await requireRecentStepUp(auth);
    }
    if (existing.status === 'ceased') {
      throw new AppError('Medication is already ceased', 409, 'ALREADY_CEASED');
    }
    // BUG-371b — opt-locked cease. Multiple-clinician handover race
    // class — first wins, second receives 409.
    // BUG-371b absorb-1 (L4 Rule 4): persist endDate + reasonForCessation
    // (pre-absorb these were silently dropped, causing AHPRA forensic
    // gap on "why was the medication ceased").
    const updated = await medicationRepository.cease(
      id,
      auth.clinicId,
      { endDate: dto.endDate, reasonForCessation: dto.reasonForCessation },
      dto.expectedLockVersion,
    );
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'patient_medications',
      recordId: id,
      oldData: { status: existing.status, end_date: existing.end_date, reason_for_cessation: existing.reason_for_cessation },
      newData: { status: 'ceased', end_date: dto.endDate, reason_for_cessation: dto.reasonForCessation },
    });
    return toResponse(updated);
  },

  async softDelete(auth: AuthContext, id: string): Promise<void> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'medication:update');
    const existing = await medicationRepository.findById(id, auth.clinicId);
    if (!existing) {
      throw new AppError('Medication not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, existing.patient_id);
    await medicationRepository.softDelete(id, auth.clinicId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'SOFT_DELETE',
      tableName: 'patient_medications',
      recordId: id,
      oldData: { drug: existing.drug_label },
    });
  },
};
