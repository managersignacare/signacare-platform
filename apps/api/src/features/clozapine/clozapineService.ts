import { clozapineRepository } from './clozapineRepository';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
import { logger } from '../../utils/logger';
import { db } from '../../db/db';
import { v4 as uuidv4 } from 'uuid';
import { settingsService, DEFAULT_THRESHOLDS } from '../settings/settingsService';
// BUG-293 — service-layer AuthContext migration + prescriber-discipline
// barrier (Layer A). Pairs with the DB trigger installed by migration
// 20260701000030_clozapine_titration_days_prescriber_discipline_barrier.ts
// (Layer B). Clozapine is the highest-safety-risk psychotropic
// (agranulocytosis / FBC monitoring) — non-psychiatrist prescribing
// attribution is worse than BUG-040/BUG-292 because of drug risk profile.
import type { AuthContext } from '@signacare/shared';
import {
  requireClinicalAccessRole,
  requirePatientRelationship,
  requirePrescribingDiscipline,
  requireValidHpii,
} from '../../shared/authGuards';
import type {
  ClozapineRegistrationCreateDTO,
  ClozapineRegistrationUpdateDTO,
  ClozapineBloodResultCreateDTO,
  ClozapineTitrationDayCreateDTO,
  ClozapineAdministrationCreateDTO,
  ClozapineObservationCreateDTO,
  ClozapineMonitoringCheckCreateDTO,
  ClozapineRegistrationResponse,
  ClozapineBloodResultResponse,
} from '@signacare/shared';
import type {
  ClozapineRegistrationRow,
  ClozapineTitrationDayRow,
  ClozapineAdministrationRow,
  ClozapineObservationRow,
  ClozapineMonitoringCheckRow,
} from './clozapineRepository';

// ── ANC Classification (Australian CPMS-equivalent thresholds) ────────────────
// Normal:  ANC ≥ 2.0 × 10⁹/L  → green, continue clozapine
// Amber:   ANC 1.5–1.99        → weekly monitoring, alert prescriber
// Red:     ANC < 1.5           → STOP clozapine immediately, urgent review
// BUG-403 (2026-05-03) — these defaults are per-clinic-overridable via
// `clinic_thresholds.{clozapine_anc_red_threshold,
// clozapine_anc_amber_threshold}`. The constants remain exported as
// the canonical Australian CPMS defaults; classifyAnc accepts optional
// override parameters so callers reading the per-clinic config (via
// settingsService.getThresholds) can pass them through.
//
// BUG-403 cycle-2 L5 advisory absorb (2026-05-03) — derive from
// `DEFAULT_THRESHOLDS` rather than redeclare to prevent silent drift if
// a future PR tunes the defaults in one place but not the other. The
// SSoT lives in settingsService.ts.
export const ANC_RED_THRESHOLD = DEFAULT_THRESHOLDS.clozapine_anc_red_threshold;
export const ANC_AMBER_THRESHOLD = DEFAULT_THRESHOLDS.clozapine_anc_amber_threshold;

export const NEXT_BLOOD_DUE_DAYS: Record<string, number> = {
  initiation: 7,
  maintenance: 28,
  tapering: 7,
  amber: 7,
  red: 1,
};

export function classifyAnc(
  anc: number | null | undefined,
  redThreshold: number = ANC_RED_THRESHOLD,
  amberThreshold: number = ANC_AMBER_THRESHOLD,
): 'normal' | 'amber' | 'red' | 'unknown' {
  if (anc === null || anc === undefined) return 'unknown';
  if (anc < redThreshold) return 'red';
  if (anc < amberThreshold) return 'amber';
  return 'normal';
}

export function computeNextBloodDue(
  collectionDate: string,
  ancStatus: string,
  titrationPhase: string,
): string {
  const key = ancStatus === 'amber' || ancStatus === 'red' ? ancStatus : titrationPhase;
  const days = NEXT_BLOOD_DUE_DAYS[key] ?? 28;
  const d = new Date(collectionDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Map clozapine flag categories to human-readable titles shown in the
// patient header. Keeps the title consistent across every raise site so
// the UI can group by category text without relying on the enum slug.
const CLOZAPINE_FLAG_TITLES: Record<string, string> = {
  clozapine_anc_red: 'Clozapine ANC — RED (STOP)',
  clozapine_anc_amber: 'Clozapine ANC — AMBER (monitor weekly)',
};

async function raisePatientFlag(params: {
  clinicId: string;
  patientId: string;
  category: string;
  severity: string;
  message: string;
  raisedByStaffId: string;
}): Promise<void> {
  const title = CLOZAPINE_FLAG_TITLES[params.category]
    ?? `${params.category} (${params.severity})`;
  await db('patient_flags')
    .insert({
      id: uuidv4(),
      clinic_id: params.clinicId,
      patient_id: params.patientId,
      category: params.category,
      severity: params.severity,
      title,
      description: params.message,
      status: 'active',
      is_header_flag: true,
      raised_by_staff_id: params.raisedByStaffId,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict()
    .ignore();
}

async function resolvePatientFlag(
  clinicId: string,
  patientId: string,
  category: string,
): Promise<void> {
  await db('patient_flags')
    .where({ clinic_id: clinicId, patient_id: patientId, category, status: 'active' })
    .update({ status: 'resolved', resolved_at: new Date(), updated_at: new Date() });
}

// BUG-618 — moved to apps/api/src/features/clozapine/clozapineMappers.ts
// (single canonical home for all 6 clozapine response mappers, with Zod
// validation per CLAUDE.md §5.2 and AppError(500,'RESPONSE_SHAPE_ERROR')
// on schema drift). The pre-fix inline `toRegistrationResponse` +
// `toBloodResultResponse` did typecasts (`as ...`) without runtime Zod
// validation — silent shape drift would survive the cast. Re-imported
// below as a thin alias so call-sites in this service stay terse.
import {
  mapClozapineRegistrationRowToResponse as toRegistrationResponse,
  mapClozapineBloodResultRowToResponse as toBloodResultResponse,
} from './clozapineMappers';

type ClozapinePrescribingGuardSurface =
  | 'createRegistration'
  | 'updateRegistration'
  | 'upsertTitrationDay';

async function writeClozapinePrescribingDeniedAudit(params: {
  auth: AuthContext;
  tableName: string;
  recordId: string;
  surface: ClozapinePrescribingGuardSurface;
  guard: 'requirePrescribingDiscipline' | 'requireValidHpii';
  error: unknown;
}): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : 'Unknown prescribing-denial error';
  const code = typeof params.error === 'object' && params.error !== null && 'code' in params.error
    ? String((params.error as { code?: unknown }).code ?? 'UNKNOWN_ERROR')
    : 'UNKNOWN_ERROR';

  try {
    await writeAuditLog({
      actorId: params.auth.staffId,
      clinicId: params.auth.clinicId,
      action: 'FORBIDDEN_ACCESS',
      tableName: params.tableName,
      recordId: params.recordId,
      newData: {
        surface: params.surface,
        guard: params.guard,
        code,
        message,
      },
    });
  } catch (auditErr) {
    logger.error(
      {
        err: auditErr,
        clinicId: params.auth.clinicId,
        staffId: params.auth.staffId,
        tableName: params.tableName,
        surface: params.surface,
      },
      'BUG-322 failed to persist clozapine prescribing-denial audit row',
    );
  }
}

async function requireClozapinePrescribingDisciplineGuard(params: {
  auth: AuthContext;
  tableName: string;
  recordId: string;
  surface: ClozapinePrescribingGuardSurface;
}): Promise<void> {
  try {
    await requirePrescribingDiscipline(params.auth);
    // BUG-WF81-HPII-MISSING — clozapine registration/titration writes are
    // prescribing actions; enforce strict prescriber HPI-I on this surface
    // too, so clozapine cannot bypass the identity gate used by eRx writes.
    await requireValidHpii(params.auth);
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
    if (code === 'PRESCRIBING_DISCIPLINE_REQUIRED' || code === 'PRESCRIBER_HPII_INVALID') {
      await writeClozapinePrescribingDeniedAudit({
        auth: params.auth,
        tableName: params.tableName,
        recordId: params.recordId,
        surface: params.surface,
        guard: code === 'PRESCRIBER_HPII_INVALID' ? 'requireValidHpii' : 'requirePrescribingDiscipline',
        error: err,
      });
    }
    throw err;
  }
}

async function assertRegistrationPatientAccess(
  auth: AuthContext,
  registrationId: string,
): Promise<ClozapineRegistrationRow> {
  const registration = await clozapineRepository.findById(registrationId, auth.clinicId);
  if (!registration) {
    throw new AppError('Clozapine registration not found', 404, 'NOT_FOUND');
  }
  await requirePatientRelationship(auth, registration.patient_id);
  return registration;
}

export const clozapineService = {
  async createRegistration(
    auth: AuthContext,
    dto: ClozapineRegistrationCreateDTO,
  ): Promise<ClozapineRegistrationResponse> {
    requireClinicalAccessRole(auth);
    // BUG-293 Layer A — registering a patient on clozapine IS the
    // prescribing-initiation moment. Discipline barrier applies
    // even though clozapine_registrations uses `prescriber_staff_id`
    // (not the canonical `prescribed_by_staff_id`) — the semantic
    // equivalence is what matters for AHPRA.
    await requireClozapinePrescribingDisciplineGuard({
      auth,
      tableName: 'clozapine_registrations',
      recordId: dto.patientId,
      surface: 'createRegistration',
    });
    await requirePatientRelationship(auth, dto.patientId);
    const row = await clozapineRepository.createRegistration(auth.clinicId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'clozapine_registrations',
      recordId: row.id,
      newData: { id: row.id, patientId: row.patient_id },
    });
    return toRegistrationResponse(row);
  },

  async listByPatient(
    auth: AuthContext,
    patientId: string,
  ): Promise<ClozapineRegistrationResponse[]> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, patientId);
    const rows = await clozapineRepository.findByPatient(auth.clinicId, patientId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_registrations',
      recordId: patientId,
    });
    return rows.map(toRegistrationResponse);
  },

  async listActiveByClinic(
    auth: AuthContext,
  ): Promise<ClozapineRegistrationResponse[]> {
    requireClinicalAccessRole(auth);
    const rows = await clozapineRepository.findActiveByClinic(auth.clinicId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_registrations',
      recordId: auth.clinicId,
    });
    return rows.map(toRegistrationResponse);
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<ClozapineRegistrationResponse> {
    requireClinicalAccessRole(auth);
    const row = await assertRegistrationPatientAccess(auth, id);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_registrations',
      recordId: id,
    });
    return toRegistrationResponse(row);
  },

  async updateRegistration(
    auth: AuthContext,
    id: string,
    dto: ClozapineRegistrationUpdateDTO,
  ): Promise<ClozapineRegistrationResponse> {
    requireClinicalAccessRole(auth);
    // BUG-293 Layer A — updating registration can change titration
    // phase / dose; prescribing-adjacent. Same gate as createRegistration.
    await requireClozapinePrescribingDisciplineGuard({
      auth,
      tableName: 'clozapine_registrations',
      recordId: id,
      surface: 'updateRegistration',
    });
    const existing = await assertRegistrationPatientAccess(auth, id);
    const updated = await clozapineRepository.updateRegistration(id, auth.clinicId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'clozapine_registrations',
      recordId: id,
      oldData: { titrationPhase: existing.titration_phase, ancStatus: existing.anc_status },
      newData: { titrationPhase: updated?.titration_phase },
    });
    return toRegistrationResponse(updated!);
  },

  /**
   * Record a new ANC/WBC blood result.
   * Classifies the ANC value (normal/amber/red), syncs the cached status on
   * the registration, and raises/resolves patient flags accordingly.
   */
  async recordBloodResult(
    auth: AuthContext,
    dto: ClozapineBloodResultCreateDTO,
  ): Promise<ClozapineBloodResultResponse> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, dto.patientId);
    // NOTE (BUG-293 scope decision): recording an ANC/WBC blood result
    // is a MONITORING action, not a prescribing decision — nurses and
    // allied health legitimately record these. The discipline barrier
    // deliberately does NOT apply here. Any treatment decision triggered
    // by the result (dose change, clozapine cessation) flows through
    // updateRegistration / upsertTitrationDay which ARE gated.
    // Wrap in transaction with FOR UPDATE to prevent race conditions on concurrent blood results
    const registration = await db('clozapine_registrations')
      .where({ id: dto.registrationId, clinic_id: auth.clinicId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    if (!registration) {
      throw new AppError('Clozapine registration not found', 404, 'NOT_FOUND');
    }
    if (registration.patient_id !== dto.patientId) {
      throw new AppError(
        'Blood result patient does not match the clozapine registration patient',
        409,
        'REGISTRATION_PATIENT_MISMATCH',
      );
    }

    // BUG-403 (2026-05-03) — read per-clinic ANC thresholds from
    // clinic_thresholds (falls back to Australian CPMS defaults when no
    // override). Allows clinics with stricter haematology cohorts (e.g.
    // elderly inpatients on red < 1.7) to configure without forking.
    const thresholds = await settingsService.getThresholds(auth.clinicId);
    const ancStatus = classifyAnc(
      dto.ancValue,
      thresholds.clozapine_anc_red_threshold,
      thresholds.clozapine_anc_amber_threshold,
    );
    const flagRaised = ancStatus === 'amber' || ancStatus === 'red';
    const flagType = flagRaised ? `clozapine_anc_${ancStatus}` : null;

    const bloodResultRow = await clozapineRepository.createBloodResult(
      auth.clinicId,
      auth.staffId,
      dto,
      ancStatus,
      flagRaised,
      flagType,
    );

    const nextBloodDue = computeNextBloodDue(
      dto.collectionDate,
      ancStatus,
      registration.titration_phase,
    );

    if (dto.ancValue !== undefined && dto.ancValue !== null) {
      await clozapineRepository.syncLatestAnc(
        dto.registrationId,
        auth.clinicId,
        dto.collectionDate,
        dto.ancValue,
        dto.collectionDate,
        dto.wbcValue ?? null,
        ancStatus,
        nextBloodDue,
      );
    }

    // ── Raise or resolve flags based on ANC status ─────────────────────────
    if (ancStatus === 'red') {
      await raisePatientFlag({
        clinicId: auth.clinicId,
        patientId: registration.patient_id,
        category: 'clozapine_anc_red',
        severity: 'critical',
        message: `URGENT: Clozapine ANC RED (${dto.ancValue} × 10⁹/L). STOP clozapine immediately and arrange urgent haematology review.`,
        raisedByStaffId: auth.staffId,
      });
      await resolvePatientFlag(auth.clinicId, registration.patient_id, 'clozapine_anc_amber');
      logger.error(
        { clinicId: auth.clinicId, patientId: registration.patient_id, anc: dto.ancValue },
        '[Signacare] Clozapine ANC RED — critical flag raised',
      );
    } else if (ancStatus === 'amber') {
      await raisePatientFlag({
        clinicId: auth.clinicId,
        patientId: registration.patient_id,
        category: 'clozapine_anc_amber',
        severity: 'high',
        message: `WARNING: Clozapine ANC AMBER (${dto.ancValue} × 10⁹/L). Weekly monitoring required. Notify prescriber.`,
        raisedByStaffId: auth.staffId,
      });
      await resolvePatientFlag(auth.clinicId, registration.patient_id, 'clozapine_anc_red');
      logger.warn(
        { clinicId: auth.clinicId, patientId: registration.patient_id, anc: dto.ancValue },
        '[Signacare] Clozapine ANC AMBER — flag raised',
      );
    } else if (ancStatus === 'normal') {
      await resolvePatientFlag(auth.clinicId, registration.patient_id, 'clozapine_anc_red');
      await resolvePatientFlag(auth.clinicId, registration.patient_id, 'clozapine_anc_amber');
    }

    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'clozapine_blood_results',
      recordId: bloodResultRow.id,
      newData: {
        registrationId: dto.registrationId,
        ancValue: dto.ancValue,
        ancStatus,
        flagRaised,
        nextBloodDue,
      },
    });

    return toBloodResultResponse(bloodResultRow);
  },

  /**
   * BUG-293 — upsert a clozapine titration day (morning + evening mg).
   * This IS a prescribing moment: setting the dose for a specific day
   * of titration writes `prescribed_by_staff_id`. Delegates to the
   * repository AFTER enforcing the AHPRA discipline barrier. DB-level
   * trigger (Layer B) also fires for dbAdmin paths.
   */
  async upsertTitrationDay(
    auth: AuthContext,
    dto: ClozapineTitrationDayCreateDTO,
  ): Promise<ClozapineTitrationDayRow> {
    requireClinicalAccessRole(auth);
    await requireClozapinePrescribingDisciplineGuard({
      auth,
      tableName: 'clozapine_titration_days',
      recordId: dto.registrationId,
      surface: 'upsertTitrationDay',
    });
    await assertRegistrationPatientAccess(auth, dto.registrationId);
    return clozapineRepository.upsertTitrationDay(auth.clinicId, auth.staffId, dto);
  },

  async listTitrationDays(
    auth: AuthContext,
    registrationId: string,
  ): Promise<ClozapineTitrationDayRow[]> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, registrationId);

    const rows = await clozapineRepository.findTitrationDays(auth.clinicId, registrationId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_titration_days',
      recordId: registrationId,
    });
    return rows;
  },

  async listAdministrations(
    auth: AuthContext,
    registrationId: string,
  ): Promise<ClozapineAdministrationRow[]> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, registrationId);

    const rows = await clozapineRepository.findAdministrations(auth.clinicId, registrationId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_administrations',
      recordId: registrationId,
    });
    return rows;
  },

  async createAdministration(
    auth: AuthContext,
    dto: ClozapineAdministrationCreateDTO,
  ): Promise<ClozapineAdministrationRow> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, dto.registrationId);

    const row = await clozapineRepository.createAdministration(auth.clinicId, auth.staffId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'clozapine_administrations',
      recordId: row.id,
      newData: {
        registrationId: dto.registrationId,
        administered: dto.administered,
        administrationDate: dto.administrationDate,
        timeSlot: dto.timeSlot,
      },
    });
    return row;
  },

  async listObservations(
    auth: AuthContext,
    registrationId: string,
  ): Promise<ClozapineObservationRow[]> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, registrationId);

    const rows = await clozapineRepository.findObservations(auth.clinicId, registrationId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_observations',
      recordId: registrationId,
    });
    return rows;
  },

  async createObservation(
    auth: AuthContext,
    dto: ClozapineObservationCreateDTO,
  ): Promise<ClozapineObservationRow> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, dto.registrationId);

    const row = await clozapineRepository.createObservation(auth.clinicId, auth.staffId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'clozapine_observations',
      recordId: row.id,
      newData: {
        registrationId: dto.registrationId,
        observationDate: dto.observationDate,
      },
    });
    return row;
  },

  async listMonitoringChecks(
    auth: AuthContext,
    registrationId: string,
  ): Promise<ClozapineMonitoringCheckRow[]> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, registrationId);

    const rows = await clozapineRepository.findMonitoringChecks(auth.clinicId, registrationId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_monitoring_checks',
      recordId: registrationId,
    });
    return rows;
  },

  async upsertMonitoringCheck(
    auth: AuthContext,
    dto: ClozapineMonitoringCheckCreateDTO,
  ): Promise<ClozapineMonitoringCheckRow> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, dto.registrationId);

    const row = await clozapineRepository.upsertMonitoringCheck(auth.clinicId, auth.staffId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'clozapine_monitoring_checks',
      recordId: row.id,
      newData: {
        registrationId: dto.registrationId,
        investigation: dto.investigation,
        checkPoint: dto.checkPoint,
        resultStatus: dto.resultStatus ?? null,
      },
    });
    return row;
  },

  async listBloodResults(
    auth: AuthContext,
    registrationId: string,
  ): Promise<ClozapineBloodResultResponse[]> {
    requireClinicalAccessRole(auth);
    await assertRegistrationPatientAccess(auth, registrationId);
    const rows = await clozapineRepository.findBloodResults(auth.clinicId, registrationId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'clozapine_blood_results',
      recordId: registrationId,
    });
    return rows.map(toBloodResultResponse);
  },
};
