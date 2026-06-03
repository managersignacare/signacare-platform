import { laiScheduleRepository } from './laiScheduleRepository';
import { AppError } from '../../shared/errors';
import { laiGivenRepository } from './laiGivenRepository';
import { writeAuditLog } from '../../utils/audit';
import { logger } from '../../utils/logger';
import { db } from '../../db/db';
import { v4 as uuidv4 } from 'uuid';
import type {
  AuthContext,
  LaiScheduleCreateDTO,
  LaiScheduleUpdateDTO,
  LaiScheduleResponse,
  LaiGivenCreateDTO,
  LaiGivenResponse,
  AimsAssessmentCreateDTO,
  AimsAssessmentResponse,
} from '@signacare/shared';
import { LAI_OVERDUE_GRACE_DAYS } from '@signacare/shared';
import type { LaiScheduleRow } from './laiScheduleRepository';
import type { LaiGivenRow, AimsAssessmentRow } from './laiGivenRepository';
import {
  requireClinicalAccessRole,
  requirePatientRelationship,
} from '../../shared/authGuards';

// ── Guardrail thresholds ──────────────────────────────────────────────────────
// Grace period before raising overdue flag. SSoT lives in @signacare/shared
// (LAI_OVERDUE_GRACE_DAYS) so the frontend due-date count buckets use the
// identical value. Kept as a named export here for backward compatibility
// with existing internal references — value is unchanged (7).
export const OVERDUE_GRACE_DAYS = LAI_OVERDUE_GRACE_DAYS;
// Consecutive refusals before escalating flag severity to 'high'
const CONSECUTIVE_REFUSAL_ESCALATION_THRESHOLD = 3;
// Months between AIMS assessments
const AIMS_INTERVAL_MONTHS = 6;

// ── Date helpers ──────────────────────────────────────────────────────────────

export function addDays(dateStr: string, days: number): string {
  const d = parseIsoDateAsUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(dateStr: string, months: number): string {
  const d = parseIsoDateAsUtc(dateStr);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function parseIsoDateAsUtc(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) {
    throw new AppError(`Invalid ISO date: ${dateStr}`, 400, 'INVALID_DATE');
  }
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  // Noon UTC avoids DST edge ambiguity in any host environment.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function computeOverdue(row: LaiScheduleRow): {
  isOverdue: boolean;
  daysOverdue: number | null;
} {
  if (!row.next_due_date || row.status !== 'active') {
    return { isOverdue: false, daysOverdue: null };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.next_due_date);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (today.getTime() - due.getTime()) / 86_400_000,
  );
  if (diffDays > OVERDUE_GRACE_DAYS) {
    return { isOverdue: true, daysOverdue: diffDays };
  }
  return { isOverdue: false, daysOverdue: diffDays > 0 ? diffDays : null };
}

// ── Flag helpers ──────────────────────────────────────────────────────────────

// Titles surfaced in the patient header for each LAI flag category.
const LAI_FLAG_TITLES: Record<string, string> = {
  lai_overdue: 'LAI depot — overdue',
};

async function raisePatientFlag(params: {
  clinicId: string;
  patientId: string;
  category: string;
  severity: string;
  message: string;
  raisedByStaffId: string;
}): Promise<void> {
  const title = LAI_FLAG_TITLES[params.category]
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

// ── Response mappers ──────────────────────────────────────────────────────────

/**
 * Coerce a timestamp column to an ISO-8601 string. `LaiScheduleRow` types
 * created_at/updated_at as `string`, but pg returns `timestamptz` columns as
 * JS `Date` at runtime (a §15 row-interface-vs-reality drift). The response
 * contract (`LaiScheduleResponseSchema`) requires `z.string()`, so the mapper
 * must produce the contract shape — not loosen the schema. Handles string,
 * Date, and null defensively.
 */
function toIsoString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return new Date(v as string | number).toISOString();
}

export function toScheduleResponse(row: LaiScheduleRow): LaiScheduleResponse {
  const { isOverdue, daysOverdue } = computeOverdue(row);
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id ?? null,
    drugProductId: row.drug_product_id ?? null,
    prescriberStaffId: row.prescriber_staff_id,
    drugName: row.drug_name,
    doseMg: row.dose_mg,
    frequencyDays: row.frequency_days,
    injectionSite: row.injection_site,
    injectionTechnique: row.injection_technique,
    needleGauge: row.needle_gauge ?? null,
    indication: row.indication ?? null,
    loadingDoseRequired: row.loading_dose_required,
    loadingDosesRequired: row.loading_doses_required,
    loadingDosesGiven: row.loading_doses_given,
    oralOverlapRequired: row.oral_overlap_required,
    oralOverlapEndDate: row.oral_overlap_end_date ?? null,
    startDate: row.start_date,
    firstDueDate: row.first_due_date,
    nextDueDate: row.next_due_date ?? null,
    lastGivenDate: row.last_given_date ?? null,
    endDate: row.end_date ?? null,
    baselineAimsScore: row.baseline_aims_score ?? null,
    lastAimsDate: row.last_aims_date ?? null,
    nextAimsDueDate: row.next_aims_due_date ?? null,
    status: row.status as LaiScheduleResponse['status'],
    isOverdue,
    daysOverdue: daysOverdue ?? null,
    notes: row.notes ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toGivenResponse(row: LaiGivenRow): LaiGivenResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    laiScheduleId: row.schedule_id,
    patientId: row.patient_id,
    administeredByStaffId: row.administered_by_id,
    outcome: row.outcome as LaiGivenResponse['outcome'],
    givenDate: row.given_date,
    dosGivenMg: row.dose_given ?? null,
    injectionSite: row.injection_site ?? null,
    batchNumber: row.batch_number ?? null,
    expiryDate: null,
    refusalReason: row.refusal_reason ?? null,
    deferredToDate: null,
    nextDueDate: null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

function toAimsResponse(row: AimsAssessmentRow): AimsAssessmentResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    laiScheduleId: row.lai_schedule_id ?? null,
    assessedByStaffId: row.assessed_by_staff_id,
    assessmentDate: row.assessment_date,
    itemScores: row.item_scores,
    totalScore: row.total_score ?? null,
    interpretation: row.interpretation ?? null,
    globalSeverity: row.global_severity ?? null,
    incapacitation: row.incapacitation ?? null,
    patientAwareness: row.patient_awareness ?? null,
    currentDentalProblems: row.current_dental_problems,
    dentures: row.dentures,
    clinicalNotes: row.clinical_notes ?? null,
    isBaseline: row.is_baseline,
    createdAt: row.created_at,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const laiScheduleService = {
  /**
   * Create a new LAI schedule for a patient.
   * Sets next_due_date = first_due_date and initialises all counters.
   */
  async create(
    auth: AuthContext,
    dto: LaiScheduleCreateDTO,
  ): Promise<LaiScheduleResponse> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, dto.patientId);
    const row = await laiScheduleRepository.create(auth.clinicId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'lai_schedules',
      recordId: row.id,
      newData: {
        id: row.id,
        patientId: row.patient_id,
        drug: row.drug_name,
        firstDue: row.first_due_date,
      },
    });
    return toScheduleResponse(row);
  },

  async listActiveByClinic(
    auth: AuthContext,
  ): Promise<LaiScheduleResponse[]> {
    requireClinicalAccessRole(auth);
    const rows = await laiScheduleRepository.findCurrentActiveByClinic(auth.clinicId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'lai_schedules',
      recordId: auth.clinicId,
    });
    return rows.map(toScheduleResponse);
  },

  /**
   * List all LAI schedules for a patient (all statuses unless filtered).
   * isOverdue and daysOverdue are computed from today's date on read.
   */
  async listByPatient(
    auth: AuthContext,
    patientId: string,
    statusFilter?: string,
  ): Promise<LaiScheduleResponse[]> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, patientId);
    const rows = await laiScheduleRepository.findByPatient(
      auth.clinicId,
      patientId,
      statusFilter,
    );
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'lai_schedules',
      recordId: patientId,
    });
    return rows.map(toScheduleResponse);
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<LaiScheduleResponse> {
    requireClinicalAccessRole(auth);
    const row = await laiScheduleRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, row.patient_id);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'lai_schedules',
      recordId: id,
    });
    return toScheduleResponse(row);
  },

  async update(
    auth: AuthContext,
    id: string,
    dto: LaiScheduleUpdateDTO,
  ): Promise<LaiScheduleResponse> {
    requireClinicalAccessRole(auth);
    const existing = await laiScheduleRepository.findById(id, auth.clinicId);
    if (!existing) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, existing.patient_id);
    const updated = await laiScheduleRepository.update(id, auth.clinicId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'lai_schedules',
      recordId: id,
      oldData: { status: existing.status, nextDue: existing.next_due_date },
      newData: { status: updated?.status, nextDue: updated?.next_due_date },
    });
    return toScheduleResponse(updated!);
  },

  /**
   * Record a LAI administration event (given / refused / deferred / partial).
   *
   * Guardrails:
   *  - outcome = 'given'    → advance next_due_date by frequency_days; resolve overdue flag.
   *  - outcome = 'refused'  → raise lai_overdue flag; escalate after
   *                           CONSECUTIVE_REFUSAL_ESCALATION_THRESHOLD consecutive refusals.
   *  - outcome = 'deferred' → set next_due_date to deferredToDate.
   *  - Schedule overdue (> OVERDUE_GRACE_DAYS past due) and not given → ensure flag active.
   */
  async recordGiven(
    auth: AuthContext,
    dto: LaiGivenCreateDTO,
  ): Promise<LaiGivenResponse> {
    requireClinicalAccessRole(auth);
    const relationshipSchedule = await laiScheduleRepository.findById(dto.laiScheduleId, auth.clinicId);
    if (!relationshipSchedule) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, relationshipSchedule.patient_id);

    // Concurrency: the whole critical section (forUpdate lookup +
    // row insert + schedule advance) MUST run inside a single
    // transaction. Previously the forUpdate() sat outside a
    // db.transaction wrapper and the lock was released immediately
    // after the single SELECT, so two concurrent recordGiven calls
    // could interleave between the read and the subsequent
    // laiGivenRepository.create. CLAUDE.md §1.6 + §2.1.
    const { given, schedule, outcome, nextDueDate, consecutiveRefusalsForRefused } =
      await db.transaction(async (trx) => {
        const sch = await trx('lai_schedules')
          .where({ id: dto.laiScheduleId, clinic_id: auth.clinicId })
          .whereNull('deleted_at')
          .forUpdate()
          .first();
        if (!sch) {
          throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
        }
        if (sch.status !== 'active') {
          throw Object.assign(
            new Error(`Cannot record administration on a ${sch.status} schedule`),
            { status: 409, code: 'SCHEDULE_INACTIVE' },
          );
        }

        const localOutcome = dto.outcome ?? 'given';

        // Compute next due date.
        let nextDue: string | null = null;
        if (localOutcome === 'given' || localOutcome === 'partial') {
          nextDue = addDays(dto.givenDate, sch.frequency_days);
        } else if (localOutcome === 'deferred' && dto.deferredToDate) {
          nextDue = dto.deferredToDate;
        } else {
          nextDue = sch.next_due_date;
        }

        const createdGiven = await laiGivenRepository.create(
          auth.clinicId,
          auth.staffId,
          dto,
          nextDue,
          trx,
        );

        if (localOutcome === 'given' || localOutcome === 'partial') {
          await laiScheduleRepository.advanceSchedule(
            sch.id,
            auth.clinicId,
            dto.givenDate,
            nextDue!,
            trx,
          );
          if (sch.loading_doses_given < sch.loading_doses_required) {
            await laiScheduleRepository.incrementLoadingDose(sch.id, auth.clinicId, trx);
          }
        }

        let consecutiveRefusals = 0;
        if (localOutcome === 'refused') {
          consecutiveRefusals = await laiGivenRepository.countConsecutiveRefusals(
            auth.clinicId,
            sch.id,
            trx,
          );
        }

        return {
          given: createdGiven,
          schedule: sch,
          outcome: localOutcome,
          nextDueDate: nextDue,
          consecutiveRefusalsForRefused: consecutiveRefusals,
        };
      });

    // ── Side effects AFTER commit ───────────────────────────────────────────
    // Flag raising, audit logging and logger writes are deliberately
    // outside the transaction so a flag-service hiccup can't roll
    // back a successful LAI administration. The DB state is already
    // durable at this point.
    if (outcome === 'given' || outcome === 'partial') {
      await resolvePatientFlag(auth.clinicId, schedule.patient_id, 'lai_overdue');
      logger.info(
        { clinicId: auth.clinicId, patientId: schedule.patient_id, scheduleId: schedule.id },
        '[Signacare] LAI given — schedule advanced, overdue flag resolved if present',
      );
    }

    if (outcome === 'refused') {
      const consecutiveRefusals = consecutiveRefusalsForRefused;
      const severity =
        consecutiveRefusals >= CONSECUTIVE_REFUSAL_ESCALATION_THRESHOLD
          ? 'high'
          : 'medium';
      const message =
        consecutiveRefusals >= CONSECUTIVE_REFUSAL_ESCALATION_THRESHOLD
          ? `LAI overdue — ${consecutiveRefusals} consecutive refusals for ${schedule.drug_name}. Urgent clinical review required.`
          : `LAI refused for ${schedule.drug_name}. Due: ${schedule.next_due_date ?? 'unknown'}. Reason: ${dto.refusalReason ?? 'not stated'}.`;
      await raisePatientFlag({
        clinicId: auth.clinicId,
        patientId: schedule.patient_id,
        category: 'lai_overdue',
        severity,
        message,
        raisedByStaffId: auth.staffId,
      });
      logger.warn(
        {
          clinicId: auth.clinicId,
          patientId: schedule.patient_id,
          scheduleId: schedule.id,
          consecutiveRefusals,
        },
        `[Signacare] LAI refused — ${severity} flag raised`,
      );
    }

    // ── Independent overdue guardrail ────────────────────────────────────────
    // Re-check overdue status regardless of this administration's outcome.
    const { isOverdue, daysOverdue } = computeOverdue(schedule);
    if (isOverdue && outcome !== 'given') {
      await raisePatientFlag({
        clinicId: auth.clinicId,
        patientId: schedule.patient_id,
        category: 'lai_overdue',
        severity: (daysOverdue ?? 0) > 14 ? 'high' : 'medium',
        message: `LAI overdue by ${daysOverdue} days for ${schedule.drug_name}.`,
        raisedByStaffId: auth.staffId,
      });
    }

    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'lai_given',
      recordId: given.id,
      newData: {
        scheduleId: schedule.id,
        patientId: schedule.patient_id,
        outcome,
        givenDate: dto.givenDate,
        nextDueDate,
      },
    });

    return toGivenResponse(given);
  },

  async listGiven(
    auth: AuthContext,
    laiScheduleId: string,
  ): Promise<LaiGivenResponse[]> {
    requireClinicalAccessRole(auth);
    const schedule = await laiScheduleRepository.findById(laiScheduleId, auth.clinicId);
    if (!schedule) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, schedule.patient_id);

    const rows = await laiGivenRepository.findBySchedule(auth.clinicId, laiScheduleId);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'lai_given',
      recordId: laiScheduleId,
    });
    return rows.map(toGivenResponse);
  },

  /**
   * Record an AIMS assessment, optionally linked to a specific LAI schedule.
   * After recording, update the schedule's last_aims_date and next_aims_due_date.
   */
  async createAimsAssessment(
    auth: AuthContext,
    dto: AimsAssessmentCreateDTO,
  ): Promise<AimsAssessmentResponse> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, dto.patientId);

    if (dto.laiScheduleId) {
      const schedule = await laiScheduleRepository.findById(dto.laiScheduleId, auth.clinicId);
      if (!schedule) {
        throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
      }
      if (schedule.patient_id !== dto.patientId) {
        throw new AppError(
          'AIMS assessment patient does not match the LAI schedule patient',
          409,
          'SCHEDULE_PATIENT_MISMATCH',
        );
      }
    }

    const totalScore =
      dto.totalScore ??
      Object.values(dto.itemScores).reduce((sum, v) => sum + (v ?? 0), 0);

    const aimsRow = await laiGivenRepository.createAims(auth.clinicId, auth.staffId, {
      ...dto,
      totalScore,
    });

    if (dto.laiScheduleId) {
      const nextAimsDue = addMonths(dto.assessmentDate, AIMS_INTERVAL_MONTHS);
      await laiScheduleRepository.updateAimsTracking(
        dto.laiScheduleId,
        auth.clinicId,
        totalScore,
        dto.assessmentDate,
        nextAimsDue,
      );
    }

    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'aims_assessments',
      recordId: aimsRow.id,
      newData: {
        patientId: dto.patientId,
        totalScore,
        isBaseline: dto.isBaseline,
        laiScheduleId: dto.laiScheduleId ?? null,
      },
    });

    return toAimsResponse(aimsRow);
  },

  async listAimsAssessments(
    auth: AuthContext,
    patientId: string,
    laiScheduleId?: string,
  ): Promise<AimsAssessmentResponse[]> {
    requireClinicalAccessRole(auth);
    await requirePatientRelationship(auth, patientId);
    if (laiScheduleId) {
      const schedule = await laiScheduleRepository.findById(laiScheduleId, auth.clinicId);
      if (!schedule) {
        throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
      }
      if (schedule.patient_id !== patientId) {
        throw new AppError(
          'AIMS assessment patient does not match the LAI schedule patient',
          409,
          'SCHEDULE_PATIENT_MISMATCH',
        );
      }
    }
    const rows = await laiGivenRepository.findAimsByPatient(
      auth.clinicId,
      patientId,
      laiScheduleId,
    );
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'aims_assessments',
      recordId: patientId,
    });
    return rows.map(toAimsResponse);
  },
};
